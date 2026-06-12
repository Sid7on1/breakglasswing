import { LLMProvider, Message, ChatEvent } from './llm.provider';
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
        // No tool calls, task complete
        return;
      }
    }
    
    yield `\n[AgentLoop] Reached maximum iterations (${maxIter}).\n`;
  }
}
