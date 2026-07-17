// Provider-neutral latency attribution. When a model response stalls, the honest question is
// "whose delay is this?" — and the only honest answer comes from measuring the network path at
// the moment it happens. This module probes the provider ORIGIN (DNS → TCP → TLS, no request
// body, no credentials) and classifies the stall from evidence:
//
//   local path fast + long wait   → the delay happened beyond our connection (provider-side)
//   DNS failed/slow               → this machine's resolver, not the provider
//   TCP/TLS failed/slow           → the network path, not the provider
//
// Nothing in the product is allowed to say "provider cold start" unless an entry here backs it.
// Evidence is kept in a small in-memory ring surfaced by /perf.

import * as dns from 'dns';
import * as net from 'net';
import * as tls from 'tls';

export type WaitAttribution = 'provider-side' | 'local-dns' | 'network-path' | 'network-slow' | 'unknown';

export interface OriginProbe {
  origin: string;
  ok: boolean;
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  totalMs: number;
  failedPhase?: 'dns' | 'tcp' | 'tls';
  error?: string;
}

export interface SlowWaitEvidence {
  at: number;            // wall clock, for the /perf readout
  origin: string;
  waitedMs: number;      // how long the first token / first byte took (or timed out after)
  timedOut: boolean;
  probe: OriginProbe;
  attribution: WaitAttribution;
}

/** A first-token wait longer than this is worth attributing with a probe. */
export const SLOW_WAIT_THRESHOLD_MS = 8_000;
/** Local path (dns+tcp+tls) faster than this at probe time = "the local path is fine". */
const HEALTHY_PATH_MS = 1_500;
const PROBE_PHASE_TIMEOUT_MS = 4_000;
/** At most one probe per origin per window — evidence, not surveillance. */
const PROBE_COOLDOWN_MS = 60_000;
const MAX_EVIDENCE = 20;

const evidence: SlowWaitEvidence[] = [];
const lastProbeAt = new Map<string, number>();

/** Pure classification of a stall from its probe. Exported for tests. */
export function classifyWait(probe: OriginProbe): WaitAttribution {
  if (!probe.ok) {
    if (probe.failedPhase === 'dns') return 'local-dns';
    if (probe.failedPhase === 'tcp' || probe.failedPhase === 'tls') return 'network-path';
    return 'unknown';
  }
  return probe.totalMs <= HEALTHY_PATH_MS ? 'provider-side' : 'network-slow';
}

/** One neutral, evidence-grounded sentence per attribution. */
export function describeAttribution(a: WaitAttribution): string {
  switch (a) {
    case 'provider-side': return 'local network path verified fast — the wait happened on the provider side';
    case 'local-dns': return 'DNS resolution failed on this machine — the provider was never reached';
    case 'network-path': return 'the network path to the provider failed — not a provider delay';
    case 'network-slow': return 'the network path itself was slow — attribution split between network and provider';
    case 'unknown': return 'attribution inconclusive — no phase produced usable evidence';
  }
}

function timed<T>(work: (done: (err: Error | null, value?: T) => void) => void, timeoutMs: number): Promise<{ ms: number; value?: T }> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    work((err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve({ ms: performance.now() - start, value });
    });
  });
}

/**
 * Measure DNS → TCP → TLS to an origin. No HTTP request is made and no credentials are involved:
 * this is purely "can this machine reach that host, and how fast is each phase right now".
 */
export async function probeOrigin(originUrl: string): Promise<OriginProbe> {
  let url: URL;
  try { url = new URL(originUrl); }
  catch {
    return { origin: originUrl, ok: false, dnsMs: 0, tcpMs: 0, tlsMs: 0, totalMs: 0, failedPhase: 'dns', error: 'invalid origin URL' };
  }
  const origin = url.origin;
  const host = url.hostname;
  const port = Number(url.port) || (url.protocol === 'http:' ? 80 : 443);
  const result: OriginProbe = { origin, ok: false, dnsMs: 0, tcpMs: 0, tlsMs: 0, totalMs: 0 };

  let address: string;
  try {
    const r = await timed<string>(done => {
      dns.lookup(host, (err, addr) => done(err, addr));
    }, PROBE_PHASE_TIMEOUT_MS);
    result.dnsMs = Math.round(r.ms);
    address = r.value!;
  } catch (err: any) {
    result.failedPhase = 'dns';
    result.error = String(err?.message || err).slice(0, 200);
    result.totalMs = result.dnsMs;
    return result;
  }

  let socket: net.Socket;
  try {
    const r = await timed<net.Socket>(done => {
      const s = net.connect({ host: address, port });
      s.once('connect', () => done(null, s));
      s.once('error', e => done(e));
    }, PROBE_PHASE_TIMEOUT_MS);
    result.tcpMs = Math.round(r.ms);
    socket = r.value!;
  } catch (err: any) {
    result.failedPhase = 'tcp';
    result.error = String(err?.message || err).slice(0, 200);
    result.totalMs = result.dnsMs + result.tcpMs;
    return result;
  }

  if (url.protocol === 'https:') {
    try {
      const r = await timed<tls.TLSSocket>(done => {
        const t = tls.connect({ socket, servername: host }, () => done(null, t));
        t.once('error', e => done(e));
      }, PROBE_PHASE_TIMEOUT_MS);
      result.tlsMs = Math.round(r.ms);
      r.value!.destroy();
    } catch (err: any) {
      socket.destroy();
      result.failedPhase = 'tls';
      result.error = String(err?.message || err).slice(0, 200);
      result.totalMs = result.dnsMs + result.tcpMs + result.tlsMs;
      return result;
    }
  } else {
    socket.destroy();
  }

  result.ok = true;
  result.totalMs = result.dnsMs + result.tcpMs + result.tlsMs;
  return result;
}

/**
 * Fire-and-forget attribution of one slow first-token wait. Rate-limited per origin; records an
 * evidence entry the /perf readout renders. Never throws, never blocks the turn.
 */
export function attributeSlowWait(baseURL: string, waitedMs: number, timedOut: boolean): void {
  let origin: string;
  try { origin = new URL(baseURL).origin; } catch { return; }
  const now = Date.now();
  const last = lastProbeAt.get(origin) || 0;
  if (now - last < PROBE_COOLDOWN_MS) return;
  lastProbeAt.set(origin, now);
  void probeOrigin(origin)
    .then(probe => {
      evidence.push({ at: now, origin, waitedMs: Math.round(waitedMs), timedOut, probe, attribution: classifyWait(probe) });
      if (evidence.length > MAX_EVIDENCE) evidence.shift();
    })
    .catch(() => { /* evidence is best-effort */ });
}

/** Most-recent-first evidence for the /perf readout. */
export function slowWaitEvidence(): SlowWaitEvidence[] {
  return evidence.slice().reverse();
}

/** Test seam. */
export function __resetNetprobe(): void {
  evidence.length = 0;
  lastProbeAt.clear();
}
