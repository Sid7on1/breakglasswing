import {
  classifyWait, describeAttribution, probeOrigin, attributeSlowWait, slowWaitEvidence,
  __resetNetprobe, OriginProbe, WaitAttribution,
} from '../telemetry/netprobe';

// Latency attribution contracts: a stall may only be called "provider-side" when the local
// network path was measured fast at the time. Everything else must be attributed to the phase
// that actually failed or slowed — never to the provider by default.

const probe = (over: Partial<OriginProbe>): OriginProbe => ({
  origin: 'https://api.example.test', ok: true, dnsMs: 20, tcpMs: 30, tlsMs: 60, totalMs: 110, ...over,
});

describe('classifyWait', () => {
  it('fast local path + long wait → the delay was provider-side (evidence, not assumption)', () => {
    expect(classifyWait(probe({}))).toBe('provider-side');
  });

  it('DNS failure is attributed to this machine, not the provider', () => {
    expect(classifyWait(probe({ ok: false, failedPhase: 'dns', error: 'ENOTFOUND' }))).toBe('local-dns');
  });

  it('TCP/TLS failure is attributed to the network path, not the provider', () => {
    expect(classifyWait(probe({ ok: false, failedPhase: 'tcp', error: 'ECONNREFUSED' }))).toBe('network-path');
    expect(classifyWait(probe({ ok: false, failedPhase: 'tls', error: 'handshake timeout' }))).toBe('network-path');
  });

  it('slow-but-working path is attributed as network-slow, split verdict', () => {
    expect(classifyWait(probe({ dnsMs: 900, tcpMs: 800, tlsMs: 400, totalMs: 2100 }))).toBe('network-slow');
  });

  it('a probe with no usable phases is honestly unknown', () => {
    expect(classifyWait(probe({ ok: false }))).toBe('unknown');
  });

  it('every attribution has neutral human copy', () => {
    const all: WaitAttribution[] = ['provider-side', 'local-dns', 'network-path', 'network-slow', 'unknown'];
    for (const a of all) {
      const copy = describeAttribution(a);
      expect(copy.length).toBeGreaterThan(10);
      expect(copy.toLowerCase()).not.toContain('cold start');
    }
  });
});

describe('probeOrigin', () => {
  it('classifies an unresolvable host as a DNS failure', async () => {
    const p = await probeOrigin('https://definitely-not-a-real-host.bimax.invalid');
    expect(p.ok).toBe(false);
    expect(p.failedPhase).toBe('dns');
  });

  it('rejects a malformed origin without throwing', async () => {
    const p = await probeOrigin('not a url');
    expect(p.ok).toBe(false);
    expect(p.failedPhase).toBe('dns');
  });

  it('measures a refused local port as a TCP failure (DNS succeeded)', async () => {
    // Port 1 on localhost: resolution succeeds, connection is refused.
    const p = await probeOrigin('http://127.0.0.1:1');
    expect(p.ok).toBe(false);
    expect(p.failedPhase).toBe('tcp');
    expect(p.dnsMs).toBeGreaterThanOrEqual(0);
  });
});

describe('attributeSlowWait evidence ring', () => {
  beforeEach(() => __resetNetprobe());

  it('records evidence for a slow wait and rate-limits repeat probes of the same origin', async () => {
    attributeSlowWait('http://127.0.0.1:1/v1', 12_000, false);
    attributeSlowWait('http://127.0.0.1:1/v1', 15_000, true); // inside cooldown — dropped
    await new Promise(r => setTimeout(r, 300));
    const all = slowWaitEvidence();
    expect(all).toHaveLength(1);
    expect(all[0].waitedMs).toBe(12_000);
    expect(all[0].attribution).toBe('network-path');
  });

  it('ignores malformed base URLs silently', () => {
    expect(() => attributeSlowWait('::::', 9_000, false)).not.toThrow();
    expect(slowWaitEvidence()).toHaveLength(0);
  });
});
