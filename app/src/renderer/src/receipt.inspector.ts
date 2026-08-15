export type ReceiptExecutorLevel = 'semantic' | 'physical' | 'visual' | 'stop';

export interface ActionReceiptView {
  source: 'native' | 'compatibility';
  action: string;
  outcome: string;
  target: string;
  observation: string;
  executor: ReceiptExecutorLevel | 'unattributed';
  focus: 'background' | 'foreground' | 'none' | 'unknown';
  timing: string;
  postcondition: string;
}

const object = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;

function nativeExecutor(path: unknown): ReceiptExecutorLevel | 'unattributed' {
  switch (path) {
    case 'browser_semantic':
    case 'ax_attribute':
    case 'ax_action':
    case 'foreground_semantic': return 'semantic';
    case 'targeted_event':
    case 'foreground_targeted_event':
    case 'physical_cgevent': return 'physical';
    default: return 'unattributed';
  }
}

function duration(start: unknown, end: unknown): string {
  const a = Number(start), b = Number(end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? `${b - a} ms` : 'not recorded';
}

/** Parse either native-service or compatibility Computer Use output without guessing absent facts. */
export function inspectActionReceipt(output: string): ActionReceiptView | null {
  let root: Record<string, any> | null;
  try { root = object(JSON.parse(output)); } catch { return null; }
  if (!root) return null;

  if (root.op === 'semantic.action.receipt') {
    const receipt = object(root.payload);
    if (!receipt) return null;
    const element = object(receipt.element) || {};
    const target = object(root.target) || {};
    const evidence = object(receipt.evidence);
    const policy = String(receipt.deliveryPolicy || '');
    const focus = policy.startsWith('background') ? 'background'
      : receipt.focusLease ? 'foreground' : policy ? 'none' : 'unknown';
    const postcondition = evidence?.postconditionMatched === true ? 'matched'
      : evidence?.postconditionMatched === false ? `missed (${evidence.outcome || 'unsatisfied'})`
        : evidence ? String(evidence.outcome || 'recorded') : 'not requested';
    return {
      source: 'native',
      action: String(receipt.action || 'action'),
      outcome: String(receipt.outcome || 'unknown'),
      target: `${target.app || 'app unknown'} · pid ${target.pid ?? element.pid ?? '?'} · window ${target.windowId ?? element.windowId ?? '?'}`,
      observation: String(element.snapshotId || 'not recorded'),
      executor: nativeExecutor(receipt.deliveryPath),
      focus,
      timing: duration(receipt.startedAtMs, receipt.completedAtMs),
      postcondition,
    };
  }

  if (!root.actionResult && !root.executor && !root.actionReceipt) return null;
  const executor = object(root.executor);
  const result = object(root.actionResult);
  const physical = object(root.actionReceipt);
  const target = object(physical?.target);
  const postcondition = object(result?.postcondition) || object(physical?.postcondition);
  const mechanism = String(executor?.mechanism || '');
  return {
    source: 'compatibility',
    action: String(root.action || 'action'),
    outcome: result?.delivered === false ? 'refused' : String(result?.observed || (root.ok ? 'delivered' : 'failed')),
    target: `${target?.app || root.app || 'app unknown'} · pid ${target?.pid ?? root.pid ?? '?'} · window ${target?.windowId ?? root.windowId ?? '?'}`,
    observation: String(root.frameId || 'not recorded'),
    executor: ['semantic', 'physical', 'visual', 'stop'].includes(executor?.level)
      ? executor!.level as ReceiptExecutorLevel : 'unattributed',
    focus: mechanism === 'sidecar-background' ? 'background'
      : mechanism === 'physical-foreground' ? 'foreground' : mechanism ? 'none' : 'unknown',
    timing: 'not recorded',
    postcondition: postcondition
      ? `${postcondition.matched ? 'matched' : 'missed'} · ${postcondition.query || 'declared condition'}`
      : 'not requested',
  };
}
