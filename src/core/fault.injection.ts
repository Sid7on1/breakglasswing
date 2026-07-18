// ─── Fault-injection harness (mandate §12) ──────────────────────────────────────────────────────
// Deliberate, named failure points so the recovery paths (ledger resilience, config atomicity,
// task failure states, retry budgets) can be exercised by tests and manual chaos runs — WITHOUT
// leaking into production behaviour:
//   • Disarmed (the default, BIMAX_FAULT unset) every faultPoint() is a single falsy env check.
//   • Arming requires the BIMAX_FAULT env var — never a config key, never persisted, so a normal
//     install cannot end up permanently armed; a process restart disarms it.
//   • Arming is LOUD: the first armed hit logs a warning naming every armed site.
//
// Spec: BIMAX_FAULT="site[:count][,site[:count]…]"
//   site  — one of the FAULT_SITES below
//   count — fire the first N hits, then pass (default: fire every hit)
// Example: BIMAX_FAULT="ledger.append:2,config.write" — first two ledger appends fail with EIO,
// every config write fails.

export const FAULT_SITES = [
  'ledger.append',    // journal write fails (disk full / EIO)
  'ledger.rewrite',   // compaction/clear rewrite fails mid-flight
  'config.write',     // config file write fails
  'shell.spawn',      // background task process fails to start
] as const;
export type FaultSite = typeof FAULT_SITES[number];

export class FaultInjected extends Error {
  readonly site: string;
  constructor(site: string) {
    super(`EIO: injected fault at ${site} (BIMAX_FAULT)`);
    this.name = 'FaultInjected';
    this.site = site;
  }
}

let parsedFor: string | undefined;
let counters: Map<string, number> | null = null;
let announced = false;

function arm(): Map<string, number> | null {
  const spec = process.env.BIMAX_FAULT;
  if (!spec) { parsedFor = undefined; counters = null; return null; }
  if (spec === parsedFor && counters) return counters;
  parsedFor = spec;
  counters = new Map();
  for (const part of spec.split(',')) {
    const [site, count] = part.trim().split(':');
    if (!site) continue;
    counters.set(site, count ? Math.max(1, parseInt(count, 10) || 1) : Infinity);
  }
  if (!announced) {
    announced = true;
    console.warn(`[FaultInjection] ARMED via BIMAX_FAULT — sites: ${[...counters.keys()].join(', ')}. This must never be set in normal use.`);
  }
  return counters;
}

/** Throws FaultInjected when this site is armed with hits remaining; no-op otherwise. */
export function faultPoint(site: FaultSite): void {
  const c = arm();
  if (!c) return;
  const left = c.get(site);
  if (left === undefined || left <= 0) return;
  c.set(site, left - 1);
  throw new FaultInjected(site);
}

/** Test seam: reset parse/announce state between cases. */
export function __resetFaultInjectionForTests(): void {
  parsedFor = undefined;
  counters = null;
  announced = false;
}
