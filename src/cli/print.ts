import { ToolRegistry } from '../tools/tool.registry';
import { LlmAdapter } from '../core/llm.adapter';
import { Governor } from '../governor/governor';
import { TaskPipeline } from '../task';
import { CodebaseIndexer } from '../graph/indexer';
import { GraphStore } from '../graph/graph.store';

export async function executePrintMode(prompt: string, options: {
  agent: string;
  model?: string;
  theme: string;
  verbose: boolean;
  outputFormat: string;
  printWithTools?: boolean;
  toolRegistry: ToolRegistry;
  llmAdapter: LlmAdapter;
  governor: Governor;
  taskPipeline: TaskPipeline;
  codebaseIndexer: CodebaseIndexer;
  graphStore: GraphStore;
}) {
  const { agent, toolRegistry, llmAdapter } = options;

  const { BiMaxPersona, HermesPersona, OpenCodePersona, OpenClawPersona } = await import('./personas/implementations');

  const personaMap: Record<string, any> = {
    hermes: HermesPersona,
    opencode: OpenCodePersona,
    openclaw: OpenClawPersona,
  };
  const PersonaClass = personaMap[agent] || BiMaxPersona;
  const persona = new PersonaClass(toolRegistry, llmAdapter);

  const originalLog = console.log;
  console.log = (...args) => {
    process.stdout.write(args.join(' ') + '\n');
  };
  const output = await persona.execute(prompt, (token: string) => {
    process.stdout.write(token);
  });
  console.log = originalLog;
}
