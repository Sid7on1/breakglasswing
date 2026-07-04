import { EventLedger, getEventLedger } from './event.ledger';
import { SelfModel, getSelfModel, mindSingletonRoot } from './self.model';

/**
 * Materialized views over the event ledger (BiMax v2, D1).
 *
 * The v2 property being delivered here: learned state is not a mutable database you have
 * to trust — it is a FOLD over the append-only event log, reproducible by construction.
 * The JSON files the mind engines read stay exactly as they are (fast, sync, prompt-time
 * friendly); what changes is their status: they become caches that can be dropped and
 * rebuilt from the ledger at any time, audited against it, or re-derived with better
 * math later without losing a single observation.
 *
 * The self-model is the flagship view (it feeds routing, claim confidence, and the
 * ledger's own escalations). Habit/epistemic views can follow the same pattern — their
 * raw events (boundary, claim, evidence) are already being recorded.
 */

export interface RebuildReport {
  events: number;        // tool_outcome events replayed
  skipped: number;       // rejected/blocked events (never failure-rate samples)
  cells: number;         // resulting cells
  cellsBefore: number;   // cells in the live model before the swap
  agreed: boolean;       // live totals ⊆ rebuilt totals matched exactly (where comparable)
}

/** Fold tool_outcome events into a fresh SelfModel instance (no disk writes). */
export function foldSelfModel(events: { payload: any }[], root: string): { model: SelfModel; replayed: number; skipped: number } {
  const model = new SelfModel(root);
  let replayed = 0;
  let skipped = 0;
  for (const e of events) {
    const p = e.payload || {};
    const status = String(p.status || '');
    // Same policy as the live loop: rejections and policy blocks are preference/policy
    // data — they never count toward a tool's failure rate.
    if (status === 'rejected' || status === 'blocked') { skipped++; continue; }
    const ok = status === 'ok';
    model.record(String(p.tool || '-'), String(p.domain || '-'), ok, ok ? undefined : p.errSample, String(p.model || '-'));
    replayed++;
  }
  return { model, replayed, skipped };
}

/**
 * Rebuild the self-model from the ledger and swap it in atomically: fold events into a
 * fresh model, compare against the live one, write, and make the singleton reload.
 * Returns null when the ledger is unavailable or empty (nothing to rebuild from).
 */
export function rebuildSelfModel(ledger: EventLedger = getEventLedger(), root: string = mindSingletonRoot()): RebuildReport | null {
  const events = ledger.byType('tool_outcome');
  if (events.length === 0) return null;

  const { model, replayed, skipped } = foldSelfModel(events, root);

  // Agreement check (advisory, shown to the human): for every cell in the rebuilt view,
  // the live model — which may hold MORE history than the ledger (it predates it) —
  // should have at least as many samples. A live count BELOW the rebuilt one means the
  // JSON lost observations the ledger kept: exactly the drift views exist to expose.
  const live = getSelfModel().cellTotals();
  const rebuilt = model.cellTotals();
  let agreed = true;
  for (const [k, r] of Object.entries(rebuilt)) {
    const l = live[k];
    if (!l || l.ok < r.ok || l.err < r.err) { agreed = false; break; }
  }

  model.saveNow();
  getSelfModel().reload();

  return { events: replayed + skipped, skipped, cells: Object.keys(rebuilt).length, cellsBefore: Object.keys(live).length, agreed };
}
