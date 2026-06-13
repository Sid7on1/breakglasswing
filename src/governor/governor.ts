import { BudgetVeto } from './budget.veto';
import { FileSystemVeto } from './fs.veto';
import { Logger } from '../utils';
import { GovernorVetoError } from '../core/errors';
import { IGovernor, IEventBus } from '../core/interfaces';
import { GlobalPrompter } from '../cli/prompter';
import { YoloClassifier } from '../security/yolo.classifier';
import { cliEvents } from '../cli/events';
import { BashStaticAnalyzer } from './bash.analyzer';

export type SessionPermissionMode = 'interactive' | 'plan' | 'auto' | 'strict' | 'bypass';

export interface ToolPermissionRule {
  tool: string;
  pattern?: string;
  effect: 'allow' | 'deny';
  persistent: boolean;
}

export class Governor implements IGovernor {
  public budget: BudgetVeto;
  public fs: FileSystemVeto;
  public mode: SessionPermissionMode = 'interactive';
  private bashAnalyzer = new BashStaticAnalyzer();
  public rules: ToolPermissionRule[] = [];

  constructor(private eventBus: IEventBus, private yolo?: YoloClassifier) {
    this.budget = new BudgetVeto();
    this.fs = new FileSystemVeto();
    Logger.info('[Governor] Initialized Multi-Layer Permission Engine.');
  }

  public addRule(rule: ToolPermissionRule) {
    this.rules.push(rule);
  }

  public async approveTaskExecution(taskType: string, payload: any): Promise<void> {
    if (this.mode === 'bypass') {
      Logger.info(`[Governor] ⚠️ Bypassed completely for task: ${taskType}`);
      cliEvents.emit('status', `Approved (Bypassed): ${taskType}`);
      return;
    }

    // Layer 0: Plan Mode — research only. Block every mutating action so the agent
    // can read, search, and reason but cannot touch the workspace until the plan
    // is approved and the session is switched out of 'plan' mode.
    if (this.mode === 'plan') {
      const blocked =
        taskType === 'FILE_WRITE' ||
        taskType === 'FILE_DELETE' ||
        (taskType === 'OS_COMMAND' && this.bashAnalyzer.analyze(payload.command || '').category !== 'read');

      if (blocked) {
        const label = taskType === 'OS_COMMAND'
          ? `run "${String(payload.command || '').slice(0, 60)}"`
          : taskType === 'FILE_WRITE' ? `write ${payload.targetPath || payload.path || 'a file'}`
          : `delete ${payload.targetPath || payload.path || 'a file'}`;
        throw new GovernorVetoError(
          `Plan mode is active — cannot ${label}. Present your plan to the user; they can approve and exit plan mode (/plan off) to let you execute.`
        );
      }
      // Read-only work is allowed through; fall past the destructive prompt below.
      cliEvents.emit('status', `Approved (Plan/read-only): ${taskType}`);
      return;
    }

    // Layer 1: Persistent Rules Check
    const matchingRule = this.rules.find(r => r.tool === taskType); // Simplistic matching
    if (matchingRule) {
      if (matchingRule.effect === 'deny') {
        throw new GovernorVetoError(`Rule explicitly denied task: ${taskType}`);
      }
      if (matchingRule.effect === 'allow') {
        cliEvents.emit('status', `Approved (Rule): ${taskType}`);
        return;
      }
    }

    try {
      if (taskType === 'FILE_WRITE' || taskType === 'FILE_DELETE') {
        await this.fs.checkVeto(payload.targetPath);
      }
      
      if (taskType === 'API_CALL') {
        await this.budget.checkVeto(payload.estimatedCost);
      }

      // Layer 2: Static Analysis for Bash Commands
      if (taskType === 'OS_COMMAND') {
        const analysis = this.bashAnalyzer.analyze(payload.command);
        
        if (analysis.category === 'read' && analysis.risk === 'none' && this.mode !== 'strict') {
          // Auto-approve read-only safe commands
          Logger.info(`[Governor] Auto-approved safe read command: ${payload.command}`);
          cliEvents.emit('status', `Approved (Static Analysis): ${taskType}`);
          return;
        }

        // Fallback: Layer 3 ML Classifier (only if auto mode or interactive)
        if (this.yolo && this.mode === 'auto') {
          const isSafe = await this.yolo.evaluateAction(payload.command, payload.context);
          if (isSafe) {
             cliEvents.emit('status', `Approved (ML Classifier): ${taskType}`);
             return;
          }
        }
      }
    } catch (e: any) {
      if (e instanceof GovernorVetoError) {
        Logger.error(`[Governor] 🚨 SEVERE VIOLATION DETECTED. BROADCASTING EMERGENCY HALT. 🚨`);
        this.eventBus.emit('EMERGENCY_HALT', { reason: e.message });
      }
      throw e;
    }

    // Layer 4: Interactive Fallback
    const isDestructiveTask = payload.isDestructive !== false && (taskType === 'FILE_WRITE' || taskType === 'OS_COMMAND' || taskType === 'FILE_DELETE');
    const shouldAsk = isDestructiveTask || this.mode === 'strict';

    if (shouldAsk) {
      const label = taskType === 'FILE_WRITE' ? `Write ${payload.targetPath || payload.path || 'file'}`
        : taskType === 'OS_COMMAND' ? `Run: ${(payload.command || '').slice(0, 60)}`
        : `${taskType}`;

      const question = `Allow? ${label}`;
      const answer = await GlobalPrompter.ask(question, ['Yes', 'No', 'Always Allow This Tool']);

      if (answer === 'No') {
        throw new GovernorVetoError("User explicitly denied this action.");
      }

      if (answer === 'Always Allow This Tool') {
        this.addRule({ tool: taskType, effect: 'allow', persistent: true });
        Logger.info(`[Governor] Added persistent allow rule for ${taskType}`);
      }
    }

    Logger.info(`[Governor] ✅ Veto cleared. Task approved.`);
    cliEvents.emit('status', `Approved: ${taskType}`);
  }
}
