import type { AutomationMechanism } from './surface';

/**
 * The one product fallback ladder, named.
 *
 * `05_TARGET_ARCHITECTURE.md` defines exactly four executor levels and forbids the overlapping
 * recovery vocabulary that grew around them:
 *
 *   1. semantic native action — AX press / set value / select / scroll / window operation.
 *   2. physical native input  — a real pointer or keyboard event; foreground lease is explicit.
 *   3. visual recovery        — screenshot + OCR/vision, only when semantic data is absent or stale.
 *   4. stop and ask           — fresh observation cannot prove a target or a postcondition.
 *
 * and: "Every action binds target app, target window, observation/frame ID, executor level,
 * start/end time, and postcondition."
 *
 * This module is deliberately a MAPPING, not a new mechanism. The runtime already has a routing
 * brain (`chooseMechanism` in surface.ts, returning `AutomationMechanism`) and already records the
 * choice it made. What did not exist was the product-level name for what happened — so a receipt
 * could say `accessibility` or `sidecar-background` but nothing said "this was the semantic level".
 * Adding a second routing implementation would create exactly the ambiguity the architecture is
 * trying to remove, so the level is DERIVED from the mechanism the runtime actually used.
 */

export type ExecutorLevel = 'semantic' | 'physical' | 'visual' | 'stop';

/** Ladder order. Lower is preferred; the runtime should never climb without a recorded reason. */
export const EXECUTOR_ORDER: readonly ExecutorLevel[] = ['semantic', 'physical', 'visual', 'stop'];

export function executorRank(level: ExecutorLevel): number {
  return EXECUTOR_ORDER.indexOf(level);
}

export const EXECUTOR_LABELS: Record<ExecutorLevel, string> = {
  semantic: 'semantic native action',
  physical: 'physical native input',
  visual: 'visual recovery',
  stop: 'stop and ask',
};

/**
 * Map the mechanism the runtime actually used onto its ladder level.
 *
 * The two non-obvious rows, stated so they are not "corrected" later by someone reading the names
 * rather than the behaviour:
 *
 *  - `sidecar-background` is **physical**, not semantic. It does not move the visible cursor and
 *    does not need foreground, which makes it *feel* like the background/AX path — but it posts a
 *    synthetic event rather than performing an accessibility action, and surface.ts already records
 *    that "some accessibility frameworks can ignore synthetic events". Classifying it as semantic
 *    would let a receipt claim a semantic action for input that no AX action ever performed.
 *  - `browser-automation` is **semantic**. It is structured, addresses elements by identity and
 *    never touches the physical cursor, which is the property the semantic level actually names.
 */
export function levelForMechanism(mechanism: AutomationMechanism): ExecutorLevel {
  switch (mechanism) {
    case 'accessibility':
    case 'browser-automation':
      return 'semantic';
    case 'physical-foreground':
    case 'sidecar-background':
      return 'physical';
    case 'unsupported':
      return 'stop';
  }
  // A mechanism added without a ladder row must not silently become 'semantic' — the most
  // flattering answer. Unknown means we cannot say which level acted.
  return 'stop';
}

export interface LevelEvidence {
  /** The mechanism the runtime routed through, when it recorded one. */
  mechanism?: AutomationMechanism | null;
  /**
   * True when the target was resolved from recognised on-screen text rather than the accessibility
   * tree. The runtime marks these elements `visualOnly` / role `VisualText`.
   */
  visualOnlyTarget?: boolean;
  /** True when the runtime refused to act at all (no safe target, stale frame, blocked). */
  refused?: boolean;
}

/**
 * Classify one completed action.
 *
 * Order matters and encodes the architecture's rule that visual recovery "must produce a new target
 * bound to the current frame before acting":
 *
 *  - a refusal is `stop`, whatever mechanism was contemplated;
 *  - otherwise, a target that came from recognised pixels is `visual` even if the delivery itself
 *    was an AX action, because the *grounding* was visual and that is the weaker claim. Reporting
 *    it as semantic is how an OCR-derived target ends up looking like a tree-verified one.
 *  - otherwise the mechanism decides.
 */
export function classifyExecutorLevel(evidence: LevelEvidence): ExecutorLevel {
  if (evidence.refused) return 'stop';
  if (evidence.visualOnlyTarget) return 'visual';
  if (!evidence.mechanism) return 'stop';
  return levelForMechanism(evidence.mechanism);
}

/**
 * Is moving from `from` to `to` a legal transition?
 *
 * The ladder is a descent under evidence: you may fall back to a weaker executor, and you may stop
 * at any point. You may not silently climb back to a stronger claim within one action, because the
 * stronger level's evidence was already found insufficient. A new action may of course start at
 * `semantic` again — this governs one action's own escalation, not the next one's start.
 */
export function isLegalDescent(from: ExecutorLevel, to: ExecutorLevel): boolean {
  return executorRank(to) >= executorRank(from);
}

/** A human-readable, non-flattering description for receipts and traces. */
export function describeLevel(level: ExecutorLevel, evidence: LevelEvidence = {}): string {
  const base = EXECUTOR_LABELS[level];
  if (level === 'visual') {
    return `${base} — the target was grounded in recognised on-screen text, not the accessibility tree`;
  }
  if (level === 'stop') {
    if (evidence.refused) {
      return `${base} — the runtime refused the action before delivery`;
    }
    return evidence.mechanism === 'unsupported'
      ? `${base} — no safe mechanism exists for this surface and delivery combination`
      : `${base} — no executor could be attributed to this action`;
  }
  return `${base} (${evidence.mechanism ?? 'unrecorded mechanism'})`;
}
