import { OutcomeContract, OutcomeScheduleSnapshot, OutcomeTask } from './outcome.model';

const terminal = (task?: OutcomeTask): boolean =>
  !!task && (task.status === 'verified' || (task.status === 'completed' && !task.owner));

const failed = (task?: OutcomeTask): boolean =>
  !!task && (task.status === 'failed' || task.status === 'blocked');

function scopeTokens(scope = ''): string[] {
  return scope.split(/[\s,;]+/)
    .map(s => s.trim().replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
}

export function taskScopesOverlap(a: OutcomeTask, b: OutcomeTask): boolean {
  if (!a.mutates || !b.mutates) return false;
  if (a.isolation === 'worktree' || b.isolation === 'worktree') return false;
  const left = scopeTokens(a.scope), right = scopeTokens(b.scope);
  // Two unscoped mutating assignments are unsafe: the coordinator cannot prove disjointness.
  if (left.length === 0 || right.length === 0) return true;
  return left.some(x => right.some(y => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
}

/**
 * Engine-owned scheduling facts. This does not trust a model's "these can run in parallel" claim:
 * dependencies, capacity, edit scopes, and worktree isolation determine the dispatch set.
 */
export function computeAdaptiveSchedule(contract: OutcomeContract, maxParallel = 4): OutcomeScheduleSnapshot {
  const limit = Math.max(1, Math.min(8, Math.floor(maxParallel) || 1));
  const byId = new Map(contract.tasks.map(task => [task.id, task]));
  const running = contract.tasks.filter(task => task.status === 'in_progress');
  const awaitingParent = contract.tasks.filter(task => task.status === 'completed' && !!task.owner);
  const pending = contract.tasks.filter(task => task.status === 'pending');
  const ready = pending.filter(task => task.dependsOn.every(id => terminal(byId.get(id))));
  const blocked = pending.filter(task => task.dependsOn.some(id => failed(byId.get(id))));
  const waiting = pending.filter(task => !ready.includes(task) && !blocked.includes(task));

  const dependents = new Map<string, string[]>();
  for (const task of contract.tasks) {
    for (const dependency of task.dependsOn) {
      const list = dependents.get(dependency) || [];
      list.push(task.id);
      dependents.set(dependency, list);
    }
  }

  const memo = new Map<string, { cost: number; path: string[] }>();
  const downstream = (id: string): { cost: number; path: string[] } => {
    const cached = memo.get(id);
    if (cached) return cached;
    const task = byId.get(id);
    if (!task || terminal(task) || failed(task)) return { cost: 0, path: [] };
    const children = (dependents.get(id) || []).map(downstream);
    const tail = children.sort((a, b) => b.cost - a.cost)[0] || { cost: 0, path: [] };
    const value = { cost: Math.max(1, task.estimateMs) + tail.cost, path: [id, ...tail.path] };
    memo.set(id, value);
    return value;
  };

  const candidates = [...running, ...awaitingParent, ...ready];
  const critical = candidates
    .map(task => ({ task, ...downstream(task.id) }))
    .sort((a, b) => b.cost - a.cost || b.task.priority - a.task.priority || a.task.id.localeCompare(b.task.id))[0];

  const capacity = Math.max(0, limit - running.length);
  const ranked = ready.filter(task => task.execution !== 'local')
    .map(task => ({ task, score: downstream(task.id).cost }))
    .sort((a, b) => b.score - a.score || b.task.priority - a.task.priority || a.task.id.localeCompare(b.task.id));
  const selected: OutcomeTask[] = [];
  for (const { task } of ranked) {
    if (selected.length >= capacity) break;
    if (running.some(active => taskScopesOverlap(active, task))) continue;
    if (selected.some(other => taskScopesOverlap(other, task))) continue;
    selected.push(task);
  }

  const remaining = contract.tasks.filter(task => !terminal(task) && !failed(task));
  const estimatedSequentialMs = remaining.reduce((sum, task) => sum + Math.max(1, task.estimateMs), 0);
  const remainingRoots = remaining.filter(task => task.dependsOn.every(id => terminal(byId.get(id)) || !byId.has(id)));
  const estimatedCriticalPathMs = remainingRoots.reduce((max, task) => Math.max(max, downstream(task.id).cost), 0);

  return {
    maxParallel: limit,
    activeAgents: running.filter(task => !!task.owner).length,
    readyTasks: ready.length,
    waitingTasks: waiting.length,
    blockedTasks: blocked.length + contract.tasks.filter(task => task.status === 'blocked').length,
    parallelTasks: selected.length,
    criticalTaskId: critical?.task.id,
    criticalTaskTitle: critical?.task.title,
    criticalPath: critical?.path || [],
    dispatchTaskIds: selected.map(task => task.id),
    estimatedSequentialMs,
    estimatedCriticalPathMs,
    estimatedParallelSavingsMs: Math.max(0, estimatedSequentialMs - estimatedCriticalPathMs),
  };
}
