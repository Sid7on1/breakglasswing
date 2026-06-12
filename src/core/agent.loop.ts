import { LLMProvider, Message, ChatEvent } from './llm.provider';
import { ToolRegistry } from '../tools/tool.registry';
import { IGovernor } from './interfaces';
import { Logger } from '../utils';
import { ContextManager } from '../memory/context.manager';

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

      let toolCalls: { id: string; name: string; args: string }[] = [];
      let currentContent = '';

      for await (const event of generator) {
        if (event.type === 'token') {
          currentContent += event.text;
          yield event.text;
        } else if (event.type === 'tool_call') {
          toolCalls.push(event);
        } else if (event.type === 'usage') {
          this.contextManager.updateTokens(event.prompt);
        } else if (event.type === 'error') {
          if (event.recoverable) {
            yield `\n[AgentLoop] Recoverable API Error: ${event.message}. Attempting reactive compaction...\n`;
            this.messages = await this.contextManager.reactiveCompact(this.messages, new Error(event.message));
            // Break out of the generator loop, but don't return. The outer `for` loop will retry.
            break;
          } else {
            yield `\n[AgentLoop] API Error: ${event.message}\n`;
            return;
          }
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
          let argsObj: any = {};
          try {
            argsObj = JSON.parse(tc.args || '{}');
          } catch (e) {
            return { id: tc.id, result: `Failed to parse arguments: ${tc.args}` };
          }
          
          const tool = this.tools.getTool(tc.name);
          if (!tool) {
            return { id: tc.id, result: `Tool ${tc.name} not found.` };
          }

          try {
            const toolContext = context || { cwd: process.cwd() };
            const result = await tool.execute(argsObj, toolContext);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            return { id: tc.id, result: resultStr };
          } catch (e: any) {
            return { id: tc.id, result: `Tool Error: ${e.message}` };
          }
        };

        const parallelPromises = parallel.map(tc => executeTool(tc));
        const parallelResults = await Promise.all(parallelPromises);

        for (const res of parallelResults) {
          this.messages.push({ role: 'tool', tool_call_id: res.id, content: res.result });
          yield `\n[Tool Executed Parallel: ${res.id}]\n`;
        }

        for (const tc of sequential) {
          const res = await executeTool(tc);
          this.messages.push({ role: 'tool', tool_call_id: res.id, content: res.result });
          yield `\n[Tool Executed Sequential: ${res.id}]\n`;
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
