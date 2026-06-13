import { IGovernor } from '../core/interfaces';
import { Logger } from '../utils/logger';
import { cliEvents } from '../cli/events';

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

      try {
        cliEvents.emit('spinner_state', 'executing', `${def.name}...`);
        const result = await def.execute(args, context);
        cliEvents.emit('spinner_state', 'idle', 'Awaiting orders...');
        return result;
      } catch (error: any) {
        Logger.error(`[Tool:${def.name}] ❌ ${error.message}`);
        cliEvents.emit('spinner_state', 'idle', 'Awaiting orders...');
        throw error;
      }
    }
  };
}
