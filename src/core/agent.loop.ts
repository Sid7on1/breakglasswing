import { LLMProvider, Message, ChatEvent } from './llm.provider';
import { responseSanitizer } from './response.sanitizer';
import { extractTextToolCalls } from './tool.call.parser';
import { ToolRegistry } from '../tools/tool.registry';
import { IGovernor } from './interfaces';
import { Logger } from '../utils';
import { ContextManager } from '../memory/context.manager';
import { cliEvents, ToolCallEntry } from '../cli/events';

export class AgentLoop {
  private contextManager: ContextManager;
  public messages: Message[] = [];

  constructor(
    private llm: LLMProvider,
    private tools: ToolRegistry,
    private governor: IGovernor
  ) {
    this.contextManager = new ContextManager(llm);
  }

  async *execute(
    initialMessages: Message[],
    systemPrompt: string,
    options?: { maxIterations?: number },
    context?: any
  ): AsyncGenerator<string> {
    this.messages = [...initialMessages];
    const maxIter = options?.maxIterations ?? 30;
    // Bounds the regenerate-on-empty correction below to a single retry, so a model
    // that keeps emitting pure filler can never spin the loop.
    let pureFillerRetried = false;

    for (let i = 0; i < maxIter; i++) {
      // 1. Auto-Compact if reaching capacity
      this.messages = await this.contextManager.checkAndCompact(this.messages);
      const generator = this.llm.chat(this.messages, {
        system: systemPrompt,
        tools: this.tools.getAllSchemas() as any,
      });

      const toolCalls: { id: string; name: string; args: string }[] = [];
      let currentContent = '';
      let retryAfterCompaction = false;

      for await (const event of generator) {
        if (event.type === 'token') {
          currentContent += event.text;
          yield event.text;
        } else if (event.type === 'thinking') {
          // Internal reasoning: surface to the UI status area, never into the reply
          cliEvents.emit('thinking', event.text);
        } else if (event.type === 'tool_call') {
          toolCalls.push(event);
        } else if (event.type === 'usage') {
          this.contextManager.updateTokens(event.prompt);
        } else if (event.type === 'error') {
          if (event.recoverable) {
            yield `\n[AgentLoop] Recoverable API Error: ${event.message}. Attempting reactive compaction...\n`;
            this.messages = await this.contextManager.reactiveCompact(this.messages, new Error(event.message));
            retryAfterCompaction = true;
            break;
          } else {
            yield `\n[AgentLoop] API Error: ${event.message}\n`;
            return;
          }
        }
      }

      // Discard the partial turn and let the outer loop re-ask with compacted context
      if (retryAfterCompaction) continue;

      // Enforce the output contract: strip leaked tool-meta filler before it can
      // land in the reply or the history, and learn whether the turn was nothing but.
      const sanitized = responseSanitizer.sanitize(currentContent);
      currentContent = sanitized.text;

      // Recover any tool call the model wrote as plain-text JSON instead of via the
      // function-calling API. Gated on real tool names, so user JSON is never run.
      if (toolCalls.length === 0 && currentContent) {
        const recovered = extractTextToolCalls(currentContent, (n) => !!this.tools.getTool(n));
        if (recovered.toolCalls.length > 0) {
          toolCalls.push(...recovered.toolCalls);
          // The visible text was just a malformed invocation wrapper ("The final
          // answer is {json}"); drop it — the real prose answer arrives after the
          // tool returns and the loop runs again.
          currentContent = '';
          Logger.warn(`[AgentLoop] Recovered ${toolCalls.length} tool call(s) the model emitted as text.`);
        }
      }

      if (currentContent) {
        this.messages.push({ role: 'assistant', content: currentContent });
      }

      if (toolCalls.length > 0) {
        // Build the tool_calls payload for the assistant message
        const asstMsg: Message = { role: 'assistant', tool_calls: [] };
        if (currentContent) asstMsg.content = currentContent;
        
        for (const tc of toolCalls) {
          asstMsg.tool_calls!.push({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args }
          });
        }
        
        // Replace the plain assistant message with the one containing tool_calls
        if (currentContent) {
            this.messages.pop(); 
        }
        this.messages.push(asstMsg);

        // Execute tools
        // Partition into parallel (safe) and sequential (destructive)
        const parallel = toolCalls.filter(tc => this.tools.getTool(tc.name)?.isConcurrencySafe);
        const sequential = toolCalls.filter(tc => !this.tools.getTool(tc.name)?.isConcurrencySafe);

        const executeTool = async (tc: { id: string, name: string, args: string }) => {
          // Announce the call so the UI can render live tool activity
          const entry: ToolCallEntry = {
            id: tc.id,
            toolName: tc.name,
            input: tc.args || '{}',
            output: '',
            status: 'running',
            startTime: new Date(),
          };
          cliEvents.emit('tool_call', entry);

          const finish = (result: string, isError: boolean) => {
            cliEvents.emit('tool_call_result', {
              ...entry,
              output: result,
              status: isError ? 'error' : 'success',
              endTime: new Date(),
            } as ToolCallEntry);
            return { id: tc.id, result };
          };

          let argsObj: any;
          try {
            argsObj = JSON.parse(tc.args || '{}');
          } catch (e) {
            return finish(`Failed to parse arguments: ${tc.args}`, true);
          }

          const tool = this.tools.getTool(tc.name);
          if (!tool) {
            return finish(`Tool ${tc.name} not found.`, true);
          }

          try {
            const toolContext = context || { cwd: process.cwd() };
            const result = await tool.execute(argsObj, toolContext);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            return finish(resultStr, false);
          } catch (e: any) {
            return finish(`Tool Error: ${e.message}`, true);
          }
        };

        const parallelPromises = parallel.map(tc => executeTool(tc));
        const parallelResults = await Promise.all(parallelPromises);

        for (const res of parallelResults) {
          this.messages.push({ role: 'tool', tool_call_id: res.id, content: res.result });
        }

        for (const tc of sequential) {
          const res = await executeTool(tc);
          this.messages.push({ role: 'tool', tool_call_id: res.id, content: res.result });
        }
        
        // Loop continues so LLM can react to tool results
      } else {
        // A turn with no tool call that collapsed to pure filler gave the user
        // nothing. Rather than silently ending on an empty reply, nudge the model
        // once to answer directly and let the loop run again. Guarded against spin.
        if (sanitized.wasPureFiller && !pureFillerRetried) {
          pureFillerRetried = true;
          this.messages.push({
            role: 'user',
            content:
              'Your previous reply contained no answer — only a remark about tool usage. ' +
              'Respond now with the actual answer to the request. If no tool is needed, ' +
              'give the answer directly; do not mention tools or function calls.',
          });
          continue;
        }
        // No tool calls, task complete
        return;
      }
    }
    
    yield `\n[AgentLoop] Reached maximum iterations (${maxIter}).\n`;
  }
}
