import { inspectActionReceipt } from '../../app/src/renderer/src/receipt.inspector';

describe('typed action receipt inspector', () => {
  test('renders the native service receipt without inferring focus or evidence', () => {
    expect(inspectActionReceipt(JSON.stringify({
      op: 'semantic.action.receipt',
      target: { app: 'Fixture', pid: 42, windowId: 7 },
      payload: {
        action: 'invoke', outcome: 'performed', deliveryPolicy: 'background_only',
        deliveryPath: 'ax_action', startedAtMs: 10, completedAtMs: 16,
        element: { pid: 42, windowId: 7, snapshotId: 'snapshot-one' },
        evidence: { outcome: 'satisfied', postconditionMatched: true },
      },
    }))).toEqual({
      source: 'native', action: 'invoke', outcome: 'performed',
      target: 'Fixture · pid 42 · window 7', observation: 'snapshot-one', executor: 'semantic',
      focus: 'background', timing: '6 ms', postcondition: 'matched',
    });
  });

  test('renders a compatibility stop receipt and preserves missing timing as unknown', () => {
    expect(inspectActionReceipt(JSON.stringify({
      ok: false, action: 'click', app: 'Fixture', pid: 42, windowId: 7, frameId: 'frame-one',
      executor: { level: 'stop', mechanism: null },
      actionResult: { delivered: false, observed: 'failed', confidence: 'unknown' },
    }))).toMatchObject({
      source: 'compatibility', action: 'click', outcome: 'refused',
      observation: 'frame-one', executor: 'stop', focus: 'unknown', timing: 'not recorded',
    });
  });

  test('rejects ordinary tool output', () => {
    expect(inspectActionReceipt('{"ok":true,"summary":"done"}')).toBeNull();
    expect(inspectActionReceipt('not json')).toBeNull();
  });
});
