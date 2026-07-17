import { IGovernor } from '../core/interfaces';
import { Logger } from '../utils/logger';
import { cliEvents } from '../cli/events';
import { runPreHooks, runPostHooks } from './hooks';
import { isTypedOutcome, outcomeBlocked, TypedOutcome } from './outcome';
import { recordGuard } from './guard.timing';

export interface ToolDef<TArgs = any> {
  name: string;
  description: string;
  schema: any;
  isDestructive?: boolean;
  isConcurrencySafe?: boolean;
  execute: (args: TArgs, context?: any) => Promise<any>;
}

export interface BuiltTool {
  name: string;
  description: string;
  schema: any;
  isDestructive: boolean;
  isConcurrencySafe: boolean;
  execute: (args: any, context?: any) => Promise<any>;
}

const TASK_TYPE_MAP: Record<string, string> = {
  BashTool: 'OS_COMMAND',
  WriteFileTool: 'FILE_WRITE',
  // Edits are writes: they must pass the same workspace/path vetting.
  EditFileTool: 'FILE_WRITE',
  // SymbolEditTool is a single-file write that previously called the governor NOWHERE (it relied on
  // its own workspaceWriteBlock + opt-in diff approval), so in interactive mode it wrote without the
  // permission prompt EditFileTool gets. Map it to FILE_WRITE so buildTool gives it the same
  // fs-veto + interactive gate; its internal checks become belt-and-braces. (WS5 step 3.)
  SymbolEditTool: 'FILE_WRITE',
  // Deletes were previously unmapped (generic TOOL_EXECUTION), which skipped
  // both the filesystem veto and the interactive permission prompt.
  DeleteTool: 'FILE_DELETE',
  // NOTE: MultiEditTool is intentionally ABSENT — it is multi-FILE, so buildTool's single
  // args.path can't gate it. It calls governor.approveTaskExecution('FILE_WRITE') per distinct
  // file itself (multiedit.tool.ts), before any write, keeping the batch atomic.
};

/**
 * Factory that enforces fail-closed defaults, Governor permission checks,
 * and automatic telemetry without boilerplate inside the tool logic.
 */
export function buildTool(def: ToolDef, governor: IGovernor): BuiltTool {
  const isDestructive = def.isDestructive ?? true;
  const isConcurrencySafe = def.isConcurrencySafe ?? false;
  // Desktop-control MCP tools (the pinned open-computer-use companion) are COMPUTER_CONTROL, not
  // generic TOOL_EXECUTION: they get the sensitive-app hard deny, per-app session grants, and the
  // computer-control prompt label instead of an opaque "Run mcp__…".
  const isDesktopControl = def.name.startsWith('mcp__open-computer-use__');
  const taskType = TASK_TYPE_MAP[def.name] || (isDesktopControl ? 'COMPUTER_CONTROL' : 'TOOL_EXECUTION');

  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    isDestructive,
    isConcurrencySafe,
    execute: async (args: any, context?: any) => {
      const payload = taskType === 'OS_COMMAND'
        ? { tool: def.name, command: args.command, context, isDestructive }
        : isDesktopControl
          ? {
              tool: def.name,
              action: def.name.slice('mcp__open-computer-use__'.length),
              // The companion's tools address apps by name/bundle in one of these args; surface it
              // for grant scoping and the sensitive-app deny. Absent → prompt without a scope.
              app: args?.app || args?.application || args?.bundle_id || args?.window || undefined,
              ...args, isDestructive,
            }
          : { tool: def.name, ...args, targetPath: args.path, isDestructive };

      // WS5 step 3: time each guard phase so a slow guard is visible before it's blamed (see /perf).
      const tApprove = Date.now();
      await governor.approveTaskExecution(taskType, payload);
      recordGuard('governor:approve', Date.now() - tApprove);

      // PreToolUse hooks (A2): may block the call, surfaced to the model like a veto.
      const tPre = Date.now();
      const pre = await runPreHooks(def.name, args, context);
      recordGuard('hooks:pre', Date.now() - tPre);
      if (pre && pre.block) {
        const reason = pre.reason || 'declined by a PreToolUse hook';
        Logger.warn(`[Tool:${def.name}] ⛔ blocked by hook: ${reason}`);
        const text = `${def.name} was blocked before running: ${reason}`;
        context?.reportOutcome?.(outcomeBlocked(text));
        return text;
      }

      try {
        // Show which tool is running, but do NOT emit 'idle' when it finishes — the TURN is still
        // active (more tools / more text may follow, and tools run in parallel). Only runTurn's
        // finally emits 'idle'. Emitting idle per-tool flipped the front-end's busy flag off between
        // tools, which killed the "working" indicator AND the esc-to-interrupt gate mid-turn.
        cliEvents.emit('spinner_state', 'executing', `${def.name}...`);
        const raw = await def.execute(args, context);
        // Typed outcome (v2 Phase 0): a tool that declares what happened reports it on the
        // context side-channel; every caller keeps receiving the plain text it always did.
        let result: any = raw;
        if (isTypedOutcome(raw)) {
          context?.reportOutcome?.(raw as TypedOutcome);
          result = raw.text;
        }
        // PostToolUse hooks (A2): react to the result and optionally append to it (e.g. the
        // B2 verify loop feeds typecheck errors back so the model self-corrects). Non-fatal.
        const tPost = Date.now();
        const appended = await runPostHooks(def.name, args, result, context);
        recordGuard('hooks:post', Date.now() - tPost);
        if (appended && typeof result === 'string') return `${result}\n\n${appended}`;
        return result;
      } catch (error: any) {
        Logger.error(`[Tool:${def.name}] ❌ ${error.message}`);
        throw error;
      }
    }
  };
}
