import { BudgetVeto } from './budget.veto';
import { FileSystemVeto } from './fs.veto';
import { Logger } from '../utils';
import { GovernorVetoError } from '../core/errors';
import { IGovernor, IEventBus } from '../core/interfaces';
import { GlobalPrompter } from '../cli/prompter';
import { YoloClassifier } from '../security/yolo.classifier';
import { cliEvents } from '../cli/events';
import { BashStaticAnalyzer } from './bash.analyzer';
import { taintRestriction } from '../mind/taint';

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
  private _mode: SessionPermissionMode = 'interactive';
  private bashAnalyzer = new BashStaticAnalyzer();
  private readonly analyzerWarmup: Promise<void>;

  // mode is assigned directly in many places (index.ts, /governor, /plan, …). Route those writes
  // through a setter so disabling the governor (bypass) ALSO lifts the budget veto, which the LLM
  // adapter holds directly — otherwise "/governor off" left the daily cap blocking every response.
  public get mode(): SessionPermissionMode { return this._mode; }
  public set mode(m: SessionPermissionMode) {
    this._mode = m;
    if (this.budget) this.budget.enabled = m !== 'bypass';
  }
  public rules: ToolPermissionRule[] = [];

  constructor(private eventBus: IEventBus, private yolo?: YoloClassifier) {
    this.budget = new BudgetVeto();
    this.fs = new FileSystemVeto();
    // Pre-load the grammar in the long-lived application. Unit tests construct many short-lived
    // governors; their fire-and-forget WASM loads can outlive Jest environments, so those tests use
    // the deterministic regex path unless they explicitly await BashStaticAnalyzer.warmUp().
    this.analyzerWarmup = process.env.NODE_ENV === 'test'
      ? Promise.resolve()
      : this.bashAnalyzer.warmUp();
    Logger.info('[Governor] Initialized Multi-Layer Permission Engine.');
  }

  /** Lets lifecycle-aware hosts await the optional AST safety-parser warm-up. */
  public async ready(): Promise<void> { await this.analyzerWarmup; }

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

    // Taint capability narrowing (v2 D3) — computed BEFORE the rule shortcut so a persistent
    // "Always Allow" created in a clean session can never waive it: once untrusted content
    // (web/MCP output) is in the conversation, network-capable commands are hard-blocked in
    // auto mode and always face the human elsewhere.
    const taintCut: { action: 'block' | 'ask'; reason: string } | null =
      taskType === 'OS_COMMAND' ? taintRestriction(payload.command || '', this.mode) : null;
    if (taintCut?.action === 'block') {
      throw new GovernorVetoError(`Blocked: ${taintCut.reason}`);
    }

    // Layer 1: Persistent Rules Check
    const matchingRule = this.rules.find(r => r.tool === taskType); // Simplistic matching
    if (matchingRule) {
      if (matchingRule.effect === 'deny') {
        throw new GovernorVetoError(`Rule explicitly denied task: ${taskType}`);
      }
      if (matchingRule.effect === 'allow' && !taintCut) {
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

        // Taint-narrowed commands (computed above) keep none of the fast paths below —
        // they fall through to the human prompt with the taint source named. Read-only
        // auto-approve is unaffected for untainted-restricted commands (ls can't exfil).
        if (analysis.category === 'read' && analysis.risk === 'none' && this.mode !== 'strict' && !taintCut) {
          // Auto-approve read-only safe commands
          Logger.info(`[Governor] Auto-approved safe read command: ${payload.command}`);
          cliEvents.emit('status', `Approved (Static Analysis): ${taskType}`);
          return;
        }

        // Fallback: Layer 3 ML Classifier (only if auto mode or interactive).
        // Never lets a tainted network command through — that's the human's call.
        if (this.yolo && this.mode === 'auto' && !taintCut) {
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

      // A taint-narrowed command asks with the taint source in view — the human decides knowingly.
      const question = taintCut ? `⚠ TAINTED CONTEXT — ${taintCut.reason}\nAllow anyway? ${label}` : `Allow? ${label}`;
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
