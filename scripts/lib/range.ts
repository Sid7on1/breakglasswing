/**
 * Pure scoring for the synthetic click-accuracy range (native/BimaxTargetRange.swift).
 *
 * Kept separate from the driver script for one reason: this is the part that decides whether a run
 * passed, and a scorer that is only exercised by live runs is a scorer nobody has ever seen fail
 * correctly. `tsx scripts/smoke-computer-range.ts --selftest` runs these against synthetic fixtures
 * with no desktop involved.
 *
 * The central rule here: a click is only a HIT if the range itself reported that exact target id.
 * Nothing is inferred from pixels, from the runtime's own confidence, or from the absence of an
 * error — those are the things under test, so they cannot also be the evidence.
 */

export interface RangeRect { x: number; y: number; w: number; h: number }

export interface RangeTarget {
  id: string;
  kind: 'labeled' | 'unlabeled' | 'child' | 'sheet' | 'dismiss';
  label: string | null;
  shape: string;
  surface: string;
  rect: RangeRect;
  center: { x: number; y: number };
}

export interface RangeManifest {
  seed: string;
  app: string;
  layout: 'grid' | 'row';
  screen: RangeRect;
  mainWindow: RangeRect;
  /** Window rect per surface ("main", plus each open child window / sheet), in global points.
   *  Required to convert an observation's screenshot-pixel frames into this manifest's space. */
  surfaces: Record<string, RangeRect>;
  openSurfaces: string[];
  targets: RangeTarget[];
}

export type RangeEvent =
  | { event: 'ready'; seed: string; layout: string; t: number }
  | { event: 'reset'; t: number }
  | { event: 'hit'; id: string; kind: string; surface: string; label: string | null;
      point: { x: number; y: number }; rect: RangeRect; offset: { dx: number; dy: number }; t: number }
  | { event: 'miss'; surface: string; point: { x: number; y: number }; t: number }
  | { event: 'child-window-open'; id: string; windowNumber: number; title: string; rect: RangeRect; t: number }
  | { event: 'child-window-close'; id: string; t: number }
  | { event: 'sheet-open'; id: string; windowNumber: number; rect: RangeRect; t: number }
  | { event: 'sheet-close'; id: string; t: number };

/**
 * Parse the JSON-lines event log. The final line is dropped when it does not parse: the harness
 * reads this file while the range is still writing to it, so a torn trailing line is expected and
 * must not be mistaken for corruption.
 */
export function parseEvents(text: string): RangeEvent[] {
  const events: RangeEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as RangeEvent);
    } catch {
      // Torn trailing write — the next poll will see it whole.
    }
  }
  return events;
}

export type ClickOutcome = 'hit' | 'wrong-target' | 'background-miss' | 'no-event';

export interface ClickScore {
  outcome: ClickOutcome;
  expectedId: string;
  /** The id actually struck, when something was struck. */
  actualId?: string;
  /** Distance in screen points from the struck point to the intended target's centre. */
  offsetPx?: number;
  /** Where the click landed, for a failure report that can be diffed against the manifest. */
  point?: { x: number; y: number };
}

/**
 * Score the events a single click produced. `sinceIndex` is the event count observed BEFORE the
 * click was issued, so a slow surface never lets a previous click's hit be counted twice.
 *
 * Only the first hit/miss after the click counts. A spawner legitimately produces further events
 * (child-window-open, and its own targets becoming live) and those must not be scored as clicks.
 */
export function scoreClick(
  expected: RangeTarget,
  events: RangeEvent[],
  sinceIndex: number,
): ClickScore {
  for (const event of events.slice(sinceIndex)) {
    if (event.event === 'hit') {
      const point = event.point;
      const offsetPx = Math.hypot(point.x - expected.center.x, point.y - expected.center.y);
      return event.id === expected.id
        ? { outcome: 'hit', expectedId: expected.id, actualId: event.id, offsetPx, point }
        : { outcome: 'wrong-target', expectedId: expected.id, actualId: event.id, offsetPx, point };
    }
    if (event.event === 'miss') {
      const point = event.point;
      return {
        outcome: 'background-miss',
        expectedId: expected.id,
        offsetPx: Math.hypot(point.x - expected.center.x, point.y - expected.center.y),
        point,
      };
    }
  }
  return { outcome: 'no-event', expectedId: expected.id };
}

export interface OffsetStats { count: number; p50: number; p95: number; worst: number }

/** Precision distribution. Reported even on a fully passing run: hitting the right element while
 *  drifting toward its edge is the state right before a regression starts missing. */
export function offsetStats(offsets: number[]): OffsetStats {
  if (offsets.length === 0) return { count: 0, p50: 0, p95: 0, worst: 0 };
  const sorted = [...offsets].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), worst: sorted[sorted.length - 1] };
}

/**
 * Window ids present after an action that were not present before.
 *
 * CGWindowIDs are monotonically increasing and the window list carries no stacking information, so
 * a set difference on ids is the only sound way to say "this click created a window" — position
 * and ordering prove nothing.
 */
export function newWindowIds(before: number[], after: number[]): number[] {
  const seen = new Set(before);
  return after.filter(id => !seen.has(id)).sort((a, b) => a - b);
}

export interface XOrdinal { target: RangeTarget; ordinal: number; ambiguous: boolean }

/**
 * Order targets left to right and give each its ordinal position ("the third button from the left").
 *
 * The ordinal is the index in the FULL ordering, and `ambiguous` is a separate flag. Keeping those
 * two things apart is the whole point: a target whose x-centre is within `minSeparation` of a
 * neighbour has no defensible ordinal and must not be asked about — but it still OCCUPIES its
 * position, so dropping it from the list would renumber everything to its right and the harness
 * would then score the runtime against an ordinal nobody could have answered.
 */
export function xOrdinals(targets: RangeTarget[], minSeparation = 24): XOrdinal[] {
  const sorted = [...targets].sort((a, b) => a.center.x - b.center.x);
  return sorted.map((target, index) => {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const clearOfPrevious = !previous || Math.abs(target.center.x - previous.center.x) >= minSeparation;
    const clearOfNext = !next || Math.abs(next.center.x - target.center.x) >= minSeparation;
    return { target, ordinal: index, ambiguous: !(clearOfPrevious && clearOfNext) };
  });
}

/** The manifest target whose rect contains a point, if any. Used to attribute an observed AX frame
 *  back to ground truth without trusting the label the observation reported. */
export function targetAt(manifest: RangeManifest, x: number, y: number, surface?: string): RangeTarget | undefined {
  return manifest.targets.find(target =>
    (surface === undefined || target.surface === surface)
    && x >= target.rect.x && x <= target.rect.x + target.rect.w
    && y >= target.rect.y && y <= target.rect.y + target.rect.h);
}

/**
 * Ordinal words the resolver actually understands, in order.
 *
 * Deliberately stops at "fifth": `ordinalFrom` in src/computer/semantic.targeting.ts recognises
 * first–fifth as words and anything higher only in numeric form ("6th"). Asking "sixth button from
 * the left" would score the runtime on a phrase it never claimed to parse, which measures the
 * harness's vocabulary rather than the runtime's aim.
 */
export const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth'];

/** Numeric ordinal phrasing, which the resolver accepts for any position. */
export function ordinalPhrase(index: number): string {
  if (index < ORDINAL_WORDS.length) return ORDINAL_WORDS[index];
  const n = index + 1;
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st'
    : n % 10 === 2 && n % 100 !== 12 ? 'nd'
    : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
