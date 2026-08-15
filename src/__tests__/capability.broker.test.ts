// Phase 8 completion — the isolated capability broker (V29B, S29-C step 1).
//
// Journeys from docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §26:
//   S29-05 extension requests undeclared file/network/process → broker denies it and the causal
//          receipt names the manifest mismatch
//   S29-11 extension crashes repeatedly → host remains responsive; bounded restart then quarantine
// plus §16's own list: protocol version, signed identity, opaque path handles, budgets,
// cancellation, output caps and taint propagation.

import { CAPABILITY_SCHEMA, CapabilityManifest, parseManifest } from '../capability/manifest';
import {
  BROKER_PROTOCOL, CRASH_QUARANTINE_THRESHOLD, CapabilityBroker, CapabilityWorker, PathHandle,
  findRawPath,
} from '../capability/broker';

const PROJECT = '/Users/dev/work/app';
const DIGEST = `sha256:${'d'.repeat(64)}`;

const manifest = (over: Record<string, unknown> = {}): CapabilityManifest => {
  const { manifest: parsed, problems } = parseManifest({
    schema: CAPABILITY_SCHEMA,
    id: 'org.example.files',
    version: '1.0.0',
    kind: 'mcp-service',
    platforms: ['macos-arm64'],
    minimum_macos: '13.0',
    content_digest: DIGEST,
    publisher_identity: 'Example Inc.',
    permissions: {
      filesystem_read: [`${PROJECT}/src`],
      filesystem_write: [`${PROJECT}/build`],
      network: ['api.example.com'],
      process: ['rg'],
    },
    dependencies: [], conflicts: [], scripts: [],
    rollback: { previous_version_supported: true },
    ...over,
  }, 'catalog');
  if (!parsed) throw new Error(`fixture invalid: ${problems.join('; ')}`);
  return parsed;
};

const worker = (over: Partial<CapabilityWorker> = {}): CapabilityWorker => ({
  protocol: BROKER_PROTOCOL,
  contentDigest: DIGEST,
  invoke: async () => ({ output: 'ok' }),
  ...over,
});

let counter = 0;
const brokerWith = (w: CapabilityWorker = worker(), m: CapabilityManifest = manifest()) => {
  counter = 0;
  const broker = new CapabilityBroker({ randomId: () => `id${counter++}`, now: () => 1_000 });
  const registration = broker.register(m, w, 'activated');
  return { broker, registration, manifest: m };
};

const request = (over: Record<string, unknown> = {}) => ({
  capabilityId: 'org.example.files',
  action: 'read',
  args: {},
  handles: [] as PathHandle[],
  hosts: [] as string[],
  processes: [] as string[],
  taskIntentId: 'task_1',
  ...over,
});

describe('registration checks protocol and signed identity before anything can run', () => {
  it('registers a matching worker', () => {
    expect(brokerWith().registration.ok).toBe(true);
  });

  it('refuses a worker speaking another protocol version', () => {
    const { registration } = brokerWith(worker({ protocol: 'bimax-capability/2' }));
    expect(registration.denial).toBe('protocol-mismatch');
  });

  it('refuses a worker running code other than what was verified', () => {
    const { registration } = brokerWith(worker({ contentDigest: `sha256:${'e'.repeat(64)}` }));
    expect(registration.denial).toBe('identity-drift');
    expect(registration.detail).toContain('the verified manifest declares');
  });

  it('refuses to register a capability that is not activated', () => {
    const broker = new CapabilityBroker();
    expect(broker.register(manifest(), worker(), 'permitted').denial).toBe('not-activated');
  });
});

describe('paths are addressed by opaque handle, never by string', () => {
  it('mints a handle only for a path inside the manifest authority', () => {
    const { broker } = brokerWith();
    expect(broker.grantHandle('org.example.files', `${PROJECT}/src/a.ts`, 'task_1')).toBe('h_id0');
    expect(broker.grantHandle('org.example.files', `${PROJECT}/secrets.env`, 'task_1')).toBeNull();
    expect(broker.grantHandle('org.example.files', '/Users/dev/.ssh/id_rsa', 'task_1')).toBeNull();
  });

  it('mints a writable handle only inside filesystem_write', () => {
    const { broker } = brokerWith();
    expect(broker.grantHandle('org.example.files', `${PROJECT}/build/out.js`, 'task_1', { writable: true })).toBe('h_id0');
    expect(broker.grantHandle('org.example.files', `${PROJECT}/src/a.ts`, 'task_1', { writable: true })).toBeNull();
  });

  it('does not resolve a handle for another capability or another task', () => {
    const { broker } = brokerWith();
    const handle = broker.grantHandle('org.example.files', `${PROJECT}/src/a.ts`, 'task_1') as PathHandle;
    expect(broker.resolveHandle('org.example.files', 'task_2', handle).denial).toBe('handle-unknown');
    expect(broker.resolveHandle('org.other', 'task_1', handle).denial).toBe('handle-unknown');
    expect(broker.resolveHandle('org.example.files', 'task_1', handle).path).toBe(`${PROJECT}/src/a.ts`);
  });

  it('does not resolve a forged handle', () => {
    const { broker } = brokerWith();
    expect(broker.resolveHandle('org.example.files', 'task_1', 'h_guessed' as PathHandle).denial).toBe('handle-unknown');
  });

  it('expires a handle with a TTL', () => {
    let clock = 1_000;
    const broker = new CapabilityBroker({ randomId: () => 'x', now: () => clock });
    broker.register(manifest(), worker(), 'activated');
    const handle = broker.grantHandle('org.example.files', `${PROJECT}/src/a.ts`, 'task_1', { ttlMs: 10 }) as PathHandle;
    expect(broker.resolveHandle('org.example.files', 'task_1', handle).path).not.toBeNull();
    clock = 1_100;
    expect(broker.resolveHandle('org.example.files', 'task_1', handle).denial).toBe('expired-authority');
  });

  it('refuses a raw path smuggled through the arguments instead of a handle', async () => {
    const { broker } = brokerWith();
    const result = await broker.call(request({ args: { path: '/Users/dev/.ssh/id_rsa' } }));
    expect(result.denial).toBe('undeclared-path');
    expect(result.detail).toContain('capabilities address files by handle');
  });

  it('spots a raw path nested inside the arguments', () => {
    expect(findRawPath({ options: { targets: ['ok', '../../etc/passwd'] } })).toBe('../../etc/passwd');
    expect(findRawPath({ options: { targets: ['ok', 'h_abc'] } })).toBeNull();
  });
});

describe('S29-05 — a capability that exceeds its manifest is denied and the denial names the field', () => {
  it('denies an undeclared host', async () => {
    const { broker } = brokerWith();
    const result = await broker.call(request({ hosts: ['evil.example'] }));
    expect(result.denial).toBe('undeclared-host');
    expect(result.detail).toContain('network allowlist');
  });

  it('denies an undeclared subprocess', async () => {
    const { broker } = brokerWith();
    const result = await broker.call(request({ processes: ['/bin/curl'] }));
    expect(result.denial).toBe('undeclared-process');
    expect(result.detail).toContain('curl');
  });

  it('denies a call whose worker reports touching an undeclared path afterwards', async () => {
    const { broker } = brokerWith(worker({
      invoke: async () => ({ output: 'done', observed: { writes: ['/Users/dev/.ssh/authorized_keys'] } }),
    }));
    const result = await broker.call(request());
    expect(result.ok).toBe(false);
    expect(result.denial).toBe('undeclared-path');
    expect(result.detail).toContain('outside filesystem_write');
  });

  it('denies a write inside the read root, which is not the write root', async () => {
    const { broker } = brokerWith(worker({
      invoke: async () => ({ output: 'done', observed: { writes: [`${PROJECT}/src/a.ts`] } }),
    }));
    expect((await broker.call(request())).denial).toBe('undeclared-path');
  });

  it('allows a call that stays inside every declared bound', async () => {
    const { broker } = brokerWith(worker({
      invoke: async () => ({ output: 'done', observed: { writes: [`${PROJECT}/build/out.js`], hosts: ['api.example.com'], processes: ['rg'] } }),
    }));
    const result = await broker.call(request({ hosts: ['api.example.com'], processes: ['rg'] }));
    expect(result.ok).toBe(true);
    expect(result.observed.writes).toEqual([`${PROJECT}/build/out.js`]);
  });
});

describe('budgets, cancellation and taint', () => {
  it('cancels a call that exceeds its deadline', async () => {
    const broker = new CapabilityBroker({ budget: { deadlineMs: 10 }, now: () => 1_000 });
    broker.register(manifest(), worker({
      invoke: (_action, _args, signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ output: 'late' }), 1_000);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); });
      }),
    }), 'activated');
    const result = await broker.call(request());
    expect(result.denial).toBe('deadline-exceeded');
    expect(result.detail).toContain('10ms budget');
  });

  it('reports an external cancellation as cancelled, not as a deadline', async () => {
    const broker = new CapabilityBroker({ budget: { deadlineMs: 5_000 }, now: () => 1_000 });
    broker.register(manifest(), worker({
      invoke: (_a, _b, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    }), 'activated');
    const controller = new AbortController();
    const pending = broker.call(request(), controller.signal);
    controller.abort();
    expect((await pending).denial).toBe('cancelled');
  });

  it('refuses output past the cap instead of silently truncating it', async () => {
    const broker = new CapabilityBroker({ budget: { maxOutputBytes: 16 }, now: () => 1_000 });
    broker.register(manifest(), worker({ invoke: async () => ({ output: 'x'.repeat(64) }) }), 'activated');
    const result = await broker.call(request());
    expect(result.denial).toBe('output-limit-exceeded');
    expect(result.output).toBeNull();
  });

  it('taints every output with the capability that produced it', async () => {
    const { broker } = brokerWith(worker({ invoke: async () => ({ output: 'page text', taint: ['web'] }) }));
    const result = await broker.call(request());
    expect(result.taint.sort()).toEqual(['capability:org.example.files', 'web']);
  });

  it('a capability cannot mark its own output clean', async () => {
    const { broker } = brokerWith(worker({ invoke: async () => ({ output: 'trust me', taint: [] }) }));
    expect((await broker.call(request())).taint).toEqual(['capability:org.example.files']);
  });
});

describe('S29-11 — repeated crashes lead to bounded restart then quarantine', () => {
  const crashing = () => worker({ invoke: async () => { throw new Error('segfault'); } });

  it('survives a crash and keeps serving', async () => {
    const { broker } = brokerWith(crashing());
    const result = await broker.call(request());
    expect(result.denial).toBe('worker-crashed');
    expect(broker.healthOf('org.example.files')?.quarantined).toBe(false);
    expect(broker.healthOf('org.example.files')?.consecutiveCrashes).toBe(1);
  });

  it('quarantines after the threshold rather than restarting forever', async () => {
    const { broker } = brokerWith(crashing());
    for (let i = 0; i < CRASH_QUARANTINE_THRESHOLD; i += 1) await broker.call(request());
    const health = broker.healthOf('org.example.files')!;
    expect(health.quarantined).toBe(true);
    expect(health.quarantineReason).toContain('consecutive crashes');
    const afterQuarantine = await broker.call(request());
    expect(afterQuarantine.denial).toBe('quarantined');
  });

  it('disposes the worker when it quarantines', async () => {
    let disposed = false;
    const { broker } = brokerWith(worker({
      invoke: async () => { throw new Error('boom'); },
      dispose: () => { disposed = true; },
    }));
    for (let i = 0; i < CRASH_QUARANTINE_THRESHOLD; i += 1) await broker.call(request());
    expect(disposed).toBe(true);
  });

  it('resets the crash count after a healthy call', async () => {
    let calls = 0;
    const { broker } = brokerWith(worker({
      invoke: async () => {
        calls += 1;
        if (calls === 1) throw new Error('transient');
        return { output: 'recovered' };
      },
    }));
    await broker.call(request());
    await broker.call(request());
    expect(broker.healthOf('org.example.files')?.consecutiveCrashes).toBe(0);
    expect(broker.healthOf('org.example.files')?.quarantined).toBe(false);
  });
});

describe('revocation takes effect on handles that were already minted', () => {
  it('withdraws every handle and stops the capability being callable', async () => {
    const { broker } = brokerWith();
    const handle = broker.grantHandle('org.example.files', `${PROJECT}/src/a.ts`, 'task_1') as PathHandle;
    broker.revokeCapability('org.example.files', 'the publisher key was compromised');
    expect(broker.resolveHandle('org.example.files', 'task_1', handle).denial).toBe('handle-unknown');
    const result = await broker.call(request());
    expect(result.denial).toBe('quarantined');
    expect(broker.healthOf('org.example.files')?.quarantineReason).toContain('revoked');
  });

  it('withdraws one handle without withdrawing the rest', () => {
    const { broker } = brokerWith();
    const first = broker.grantHandle('org.example.files', `${PROJECT}/src/a.ts`, 'task_1') as PathHandle;
    const second = broker.grantHandle('org.example.files', `${PROJECT}/src/b.ts`, 'task_1') as PathHandle;
    expect(broker.revokeHandle(first)).toBe(true);
    expect(broker.resolveHandle('org.example.files', 'task_1', first).denial).toBe('handle-unknown');
    expect(broker.resolveHandle('org.example.files', 'task_1', second).path).toBe(`${PROJECT}/src/b.ts`);
  });

  it('describes a handle without revealing it', () => {
    const described = CapabilityBroker.describeHandle('h_secret' as PathHandle);
    expect(described).toMatch(/^handle:[0-9a-f]{12}$/);
    expect(described).not.toContain('secret');
  });
});

describe('partial revocation takes effect on handles that were already minted', () => {
  it('refuses a handle whose path left the narrowed authority', () => {
    const { broker } = brokerWith();
    const handle = broker.grantHandle('org.example.files', `${PROJECT}/src/a.ts`, 'task_1') as PathHandle;
    expect(broker.resolveHandle('org.example.files', 'task_1', handle).path).toBe(`${PROJECT}/src/a.ts`);

    // The user drops read access in the Trust Center while the handle is still outstanding.
    expect(broker.narrowAuthority('org.example.files', { filesystemRead: [] })).toBe(true);

    expect(broker.resolveHandle('org.example.files', 'task_1', handle).denial).toBe('handle-escape');
  });

  it('denies a call using a handle that the narrowing invalidated', async () => {
    const { broker } = brokerWith();
    const handle = broker.grantHandle('org.example.files', `${PROJECT}/src/a.ts`, 'task_1') as PathHandle;
    broker.narrowAuthority('org.example.files', { filesystemRead: [] });
    const result = await broker.call(request({ handles: [handle] }));
    expect(result.ok).toBe(false);
    expect(result.denial).toBe('handle-escape');
  });

  it('leaves an unaffected handle working', () => {
    const { broker } = brokerWith();
    const writeHandle = broker.grantHandle('org.example.files', `${PROJECT}/build/out.js`, 'task_1', { writable: true }) as PathHandle;
    broker.narrowAuthority('org.example.files', { filesystemRead: [] });
    expect(broker.resolveHandle('org.example.files', 'task_1', writeHandle).path).toBe(`${PROJECT}/build/out.js`);
  });

  it('refuses to widen authority — that is an upgrade, not a revoke', async () => {
    const { broker } = brokerWith();
    broker.narrowAuthority('org.example.files', { network: ['evil.example', 'api.example.com'] });
    const denied = await broker.call(request({ hosts: ['evil.example'] }));
    expect(denied.denial).toBe('undeclared-host');
    const allowed = await broker.call(request({ hosts: ['api.example.com'] }));
    expect(allowed.ok).toBe(true);
  });

  it('does nothing for a capability it does not know', () => {
    const { broker } = brokerWith();
    expect(broker.narrowAuthority('org.unknown', { network: [] })).toBe(false);
  });
});
