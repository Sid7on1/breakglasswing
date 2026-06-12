import { Logger } from '../utils/logger';
import { IEventBus, IDatabase, IGovernor } from './interfaces';
import { ActionRouter } from '../actions/action.router';
import { ContextEngine } from '../memory/context.engine';
import { GovernorVetoError } from './errors';
import { withCorrelation } from './correlation';
import { LlmAdapter } from './llm.adapter';
import { ToolRegistry } from '../tools/tool.registry';
import { AgentLoop } from './agent.loop';

export class WorkerAgent {
  constructor(
    private router: ActionRouter,
    private db: IDatabase,
    private contextEngine: ContextEngine,
    private governor: IGovernor,
    private eventBus: IEventBus,
    private llmAdapter: LlmAdapter,
    private toolRegistry: ToolRegistry
  ) {}

  public start() {
    Logger.info(`[WorkerAgent] Listening for WORKER_DISPATCH events...`);
    
    this.eventBus.on('WORKER_DISPATCH', async (payload: any) => {
      const execution = withCorrelation(() => this.execute(payload));
      if (execution instanceof Promise) {
        execution.catch(e => {
          Logger.error(`[WorkerAgent] Critical unhandled error: ${e.message}`);
        });
      }
    });
  }

  public async execute(payload: any) {
    Logger.info(`\n=== 🛠️ WORKER SPAWNED: ${payload.id || 'unknown'} ===`);
    
    try {
      Logger.info(`[WorkerAgent ${payload.id}] Injecting memory context...`);
      await this.contextEngine.buildContextAwarePrompt(JSON.stringify(payload));

      Logger.info(`[WorkerAgent ${payload.id}] Requesting Governor safety approval for start...`);
      await this.governor.approveTaskExecution(payload.category || 'WORKER_START', payload.data || {});
      
      await this.db.saveEvent({ action: 'WORKER_APPROVED', taskId: payload.id, payload });

      const tools = this.toolRegistry.getAllSchemas();
      const systemPrompt = `You are a BreakGlassWing WorkerAgent, the primary execution engine of this autonomous architecture.
Your goal is to execute the user's task using the provided tools.

## Execution Philosophy
- **Precision:** Your outputs must be highly structured. Avoid preamble. State decisions and actions clearly.
- **Fail Fast:** If an approach fails, do not blindly retry. Bubble up context so the user or the Governor can intervene.
- **Tool Discipline:** Use the absolute most specific tool available for a task. Do not rely on generic shell commands for operations that have dedicated tools (e.g., AST querying, file writing, memory retrieval).

## Architecture & Governor Constraints
- **The Governor:** All destructive actions (writing files, running bash commands) pass through the \`GlobalPrompter\` Governor. The user may intercept, veto, or modify your actions.
- **Vetoes:** If a tool call throws an error indicating a Governor veto, you MUST respect the user's feedback injected into that error. Do not argue; adjust your strategy immediately.
- **Sandbox Compliance:** You operate in a live workspace. Respect lockfiles, do not delete un-tracked dependencies without permission, and never rewrite entire files if you only need a localized change.

## AST Graph Awareness
- BreakGlassWing tracks code dependencies topologically. Before modifying heavily-depended-upon core files, ensure you understand the blast radius of your changes.
- If you alter an interface or an abstract class, you are responsible for updating all concrete implementations downstream.

You operate in an Agent Loop using Native Tool Calling.
When you are completely finished with the task, you can simply stop calling tools and summarize your actions in your final assistant message.
`;

      const messages: any[] = [{ role: 'user', content: JSON.stringify(payload) }];
      const loop = new AgentLoop(this.llmAdapter, this.toolRegistry, this.governor);
      const generator = loop.execute(messages, systemPrompt, { maxIterations: 15 });

      for await (const msg of generator) {
        // We can just log the streaming text if we want, or do nothing
        if (msg.startsWith('\\n[')) {
          Logger.info(msg.trim());
        }
      }

      this.eventBus.emit('WORKER_COMPLETED', {
        id: payload.id,
        parentId: payload.parentId,
        status: 'completed',
        result: `Worker successfully completed task ${payload.id}`
      });
    } catch (e: any) {
      if (e instanceof GovernorVetoError) {
        Logger.error(`[WorkerAgent] Task VETOED by Governor: ${e.message}`);
      } else {
        Logger.error(`[WorkerAgent] Unexpected Error: ${e.message}`);
      }
      
      this.eventBus.emit('WORKER_FAILED', {
        id: payload.id,
        parentId: payload.parentId,
        reason: e.message
      });
    }
  }
}
