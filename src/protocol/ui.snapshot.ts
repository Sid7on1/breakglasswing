import { cliEvents } from '../cli/events';

// Footer state that the Ink UI reads directly from engine singletons (getConfig, getGoalManager)
// rather than from events. An out-of-process front-end can't reach those, so we snapshot them into
// a `ui_snapshot` event the ProtocolHost forwards. Emitted once at startup and again whenever the
// underlying state changes (config / goals), so the Go footer stays live without polling.

export interface UiSnapshot {
  models: { coding: string; lite: string };
  goalCount: number;
}

function snapshot(): UiSnapshot {
  let models = { coding: '', lite: '' };
  let goalCount = 0;
  try {
    const { getConfig } = require('../cli/config');
    const c = getConfig();
    models = { coding: c.model, lite: c.liteModel };
  } catch { /* config not ready */ }
  try {
    const { getGoalManager } = require('../memory/goal.manager');
    goalCount = getGoalManager().getActiveGoals().length;
  } catch { /* goal manager not initialized */ }
  return { models, goalCount };
}

/** Begin emitting `ui_snapshot` (immediately + on config/goal changes). Call after the host attaches. */
export function startUiSnapshot(): void {
  const emit = () => cliEvents.emit('ui_snapshot', snapshot());
  emit();
  cliEvents.on('config_changed', emit);
  cliEvents.on('goals_changed', emit);
}
