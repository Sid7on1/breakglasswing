import { DesktopCommand } from './desktop.runtime';

export type ComputerSerialization = 'concurrent-read' | 'machine-exclusive';

export interface ComputerExecutionRecipe {
  serialization: ComputerSerialization;
  mutatesDesktop: boolean;
  observeAfter: boolean;
}

const READ_ONLY_ACTIONS = new Set<DesktopCommand['action']>([
  'status', 'apps', 'windows', 'observe', 'screenshot', 'cursor', 'frontmost', 'wait',
  'record_status',
]);

const NO_AUTOMATIC_OBSERVATION = new Set<DesktopCommand['action']>([
  'status', 'request_access', 'apps', 'windows', 'screenshot', 'cursor', 'frontmost', 'move',
  'clipboard', 'desktop', 'record_start', 'record_status', 'record_stop', 'mouse_down',
]);

/**
 * Coordinator policy for one command. Keeping it pure and backend-neutral prevents action policy
 * from spreading through session routing, transports and model adapters as the native backend lands.
 */
export function computerExecutionRecipe(cmd: Pick<DesktopCommand, 'action'>): ComputerExecutionRecipe {
  const readOnly = READ_ONLY_ACTIONS.has(cmd.action);
  return {
    serialization: readOnly ? 'concurrent-read' : 'machine-exclusive',
    mutatesDesktop: !readOnly,
    observeAfter: !NO_AUTOMATIC_OBSERVATION.has(cmd.action),
  };
}
