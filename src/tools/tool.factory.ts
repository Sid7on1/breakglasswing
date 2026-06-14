import { IGovernor } from '../core/interfaces';
import { Logger } from '../utils/logger';
import { cliEvents } from '../cli/events';
import { runPreHooks, runPostHooks } from './hooks';

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
  // Deletes were previously unmapped (generic TOOL_EXECUTION), which skipped
  // both the filesystem veto and the interactive permission prompt.
  DeleteTool: 'FILE_DELETE',
};

/**
 * Factory that enforces fail-closed defaults, Governor permission checks,
 * and automatic telemetry without boilerplate inside the tool logic.
 */
export function buildTool(def: ToolDef, governor: IGovernor): BuiltTool {
  const isDestructive = def.isDestructive ?? true;
  const isConcurrencySafe = def.isConcurrencySafe ?? false;
  const taskType = TASK_TYPE_MAP[def.name] || 'TOOL_EXECUTION';

  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    isDestructive,
    isConcurrencySafe,
    execute: async (args: any, context?: any) => {
      const payload = taskType === 'OS_COMMAND'
        ? { command: args.command, context, isDestructive }
        : { ...args, targetPath: args.path, isDestructive };

      await governor.approveTaskExecution(taskType, payload);

      // PreToolUse hooks (A2): may block the call, surfaced to the model like a veto.
      const pre = await runPreHooks(def.name, args, context);
      if (pre && pre.block) {
        const reason = pre.reason || 'declined by a PreToolUse hook';
        Logger.warn(`[Tool:${def.name}] ⛔ blocked by hook: ${reason}`);
        return `${def.name} was blocked before running: ${reason}`;
      }

      try {
        cliEvents.emit('spinner_state', 'executing', `${def.name}...`);
        const result = await def.execute(args, context);
        cliEvents.emit('spinner_state', 'idle', 'Awaiting orders...');
        // PostToolUse hooks (A2): react to the result and optionally append to it (e.g. the
        // B2 verify loop feeds typecheck errors back so the model self-corrects). Non-fatal.
        const appended = await runPostHooks(def.name, args, result, context);
        if (appended && typeof result === 'string') return `${result}\n\n${appended}`;
        return result;
      } catch (error: any) {
        Logger.error(`[Tool:${def.name}] ❌ ${error.message}`);
        cliEvents.emit('spinner_state', 'idle', 'Awaiting orders...');
        throw error;
      }
    }
  };
}
