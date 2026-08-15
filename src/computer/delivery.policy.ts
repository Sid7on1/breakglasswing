/**
 * Delivery policy — who is allowed to take the foreground, and when.
 *
 * PROVENANCE. `isBackgroundDelivery` and `allowsEvidenceFocus` are RECOVERED verbatim from the
 * compiled `native-service/bimax-mac-capability` bundle (the TypeScript original was evicted by
 * iCloud with no git copy). The remaining exports are NOT in that bundle — it predates them — and
 * are reconstructed from `__tests__/computer.delivery.policy.test.ts`, which is their surviving
 * specification. Type annotations throughout are inference, not recovery.
 *
 * The invariant these share: a background policy must never be widened into a foreground one.
 * Evidence capture is the classic leak — capturing "just one screenshot" in the foreground steals
 * focus from the user for a delivery they explicitly asked to stay in the background.
 */

/** The four policies the native service accepts by name. `background`/`foreground` are the generic
 * shorthands callers may also pass; they are honoured but not published as native policies. */
export const BIMAX_CU_DELIVERY_POLICIES = [
  'background_only',
  'background_preferred',
  'foreground_once',
  'foreground_persistent',
] as const;

export type BimaxCuDeliveryPolicy = (typeof BIMAX_CU_DELIVERY_POLICIES)[number];

/** Delivery path a caller wants to use for one operation. */
export type DeliveryPath = 'background' | 'foreground';

var BIMAX_CU_NATIVE_BACKGROUND_POLICY = "background_native";

export function isBackgroundDelivery(delivery: string | undefined | null): boolean {
  return delivery === "background" || delivery === "background_only" || delivery === "background_preferred" || delivery === BIMAX_CU_NATIVE_BACKGROUND_POLICY;
}

export function allowsEvidenceFocus(delivery: string | undefined | null): boolean {
  return !isBackgroundDelivery(delivery);
}

/** May this delivery take a foreground lease at all? Background policies never may. */
export function permitsForegroundLease(delivery: string | undefined | null): boolean {
  return !isBackgroundDelivery(delivery);
}

/**
 * May `path` be used to satisfy `delivery`?
 *
 * A background path is always authorized: it satisfies a background contract exactly and satisfies
 * a foreground one without broadening it. A foreground path is authorized only when the policy
 * actually asked for the foreground.
 */
export function deliveryPathAuthorized(delivery: string | undefined | null, path: DeliveryPath): boolean {
  if (path === 'background') return true;
  return permitsForegroundLease(delivery);
}

/**
 * Does focus STAY with the target after the action completes? Only the persistent policy holds it;
 * `foreground_once` borrows the foreground for a single action and must hand it back.
 */
export function keepsForegroundAfterAction(delivery: string | undefined | null): boolean {
  return delivery === 'foreground_persistent';
}
