import assert from 'node:assert/strict';
import {
  FocusActivationArbiter,
  startFocusActivationBroker,
  type FocusActivationRequest,
} from '../../src/main/focus-broker';

async function main(): Promise<void> {
  let now = 1_000_000;
  let focused = false;
  const activations: string[] = [];
  const token = 'a'.repeat(64);
  const arbiter = new FocusActivationArbiter(token, {
    bimaxPid: 50,
    isBimaxFocused: () => focused,
    activateBundle: async (bundle) => { activations.push(bundle); return true; },
    now: () => now,
  });
  const request = (overrides: Partial<FocusActivationRequest> = {}): FocusActivationRequest => ({
    version: 1,
    token,
    requestId: 'request-1234',
    targetPid: 75,
    targetBundleId: 'com.example.Target',
    expiresAtMs: now + 1_000,
    ...overrides,
  });

  assert.deepEqual(await arbiter.handle(request({ token: 'b'.repeat(64) })), {
    accepted: false, code: 'invalid_request',
  });
  assert.deepEqual(await arbiter.handle(request()), {
    accepted: false, code: 'bimax_not_frontmost',
  });
  focused = true;
  assert.deepEqual(await arbiter.handle(request()), { accepted: true, code: 'accepted' });
  focused = false;
  assert.deepEqual(await arbiter.handle(request({
    requestId: 'request-restore', targetPid: 50, targetBundleId: 'ai.bimax.app',
  })), { accepted: true, code: 'accepted' });
  assert.deepEqual(await arbiter.handle(request({
    requestId: 'request-replay', targetPid: 50, targetBundleId: 'ai.bimax.app',
  })), { accepted: false, code: 'return_grant_required' });
  assert.deepEqual(activations, ['com.example.Target', 'ai.bimax.app']);

  focused = true;
  await arbiter.handle(request({ requestId: 'request-expiring' }));
  focused = false;
  now += 60_001;
  assert.deepEqual(await arbiter.handle(request({
    requestId: 'request-expired-return', targetPid: 50, targetBundleId: 'ai.bimax.app',
    expiresAtMs: now + 1_000,
  })), { accepted: false, code: 'return_grant_required' });

  const liveCalls: string[] = [];
  const broker = await startFocusActivationBroker({
    bimaxPid: process.pid,
    isBimaxFocused: () => true,
    activateBundle: async (bundle) => { liveCalls.push(bundle); return true; },
  });
  try {
    const response = await fetch(broker.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        token: broker.token,
        requestId: 'http-request-1234',
        targetPid: 75,
        targetBundleId: 'com.example.Target',
        expiresAtMs: Date.now() + 1_000,
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, code: 'accepted' });
    assert.deepEqual(liveCalls, ['com.example.Target']);
  } finally {
    await broker.close();
  }

  process.stdout.write('PASS desktop focus broker authorization and HTTP transport\n');
}

void main().catch((error) => {
  process.stderr.write(`FAIL ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
