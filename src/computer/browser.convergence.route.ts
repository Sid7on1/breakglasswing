/**
 * RECOVERED from the compiled `native-service/bimax-mac-capability` bundle on 2026-08-10.
 *
 * The TypeScript original was evicted by iCloud (storage full) with no git copy — this
 * directory has never been committed. Bun's `--compile` embeds the bundled JavaScript with
 * its source-path comments intact, so this is the REAL logic, not a reconstruction from
 * call sites. What the compiler erased is gone: type annotations, interfaces, and the
 * original comments. Types below were re-derived from usage and are the only part of this
 * file that is inference rather than recovery.
 *
 * Bundler artefacts to expect: identifiers may carry numeric suffixes (`crypto3`,
 * `resolve4`) from module-scope deduplication, and imports were hoisted out of this file.
 */
/**
 * A target on one of the converged surfaces. Fields beyond `surface` are per-surface: a browser
 * page carries its document authority, a native window carries its generation-bound identity, and
 * a visual-only target carries only a display.
 */
export interface ConvergedComputerTargetRef {
  surface: 'browser_page' | 'browser_chrome' | 'visual_only' | string;
  pid?: number;
  windowId?: number;
  windowGeneration?: number;
  displayId?: number;
  /** Browser-page authority — the exact document a route receipt is bound to. */
  url?: string;
  tabRef?: string;
  documentRef?: string;
  elementRef?: string;
}

/** Which routes are actually live right now, as measured — never as advertised. */
export interface ConvergedRouteAvailability {
  browserCdp?: boolean;
  nativeAX?: boolean;
  nativeCapture?: boolean;
  compatibilityAX?: boolean;
}

var retainedHandoffs = new Map<string, any>();
export function resolveConvergedComputerRoute(target: ConvergedComputerTargetRef, available: ConvergedRouteAvailability): any {
  if (target.surface === "browser_page") {
    if (available.browserCdp)
      return {
        eligible: true,
        receipt: {
          surface: target.surface,
          backend: "browser_cdp",
          deliveryPath: "browser_semantic",
          reason: "page content is owned by the browser DOM/CDP route"
        },
        blockers: []
      };
    if (!Number.isInteger(target.pid) || (target.pid ?? 0) <= 0) {
      return {
        eligible: false,
        blockers: ["browser_cdp_unavailable", "native_target_unresolved"]
      };
    }
    if (available.nativeAX)
      return {
        eligible: true,
        receipt: {
          surface: target.surface,
          backend: "native_service",
          deliveryPath: "native_ax_scrape",
          reason: "CDP is unavailable; read-only page structure falls back to the browser WebArea accessibility tree"
        },
        blockers: []
      };
    if (available.compatibilityAX)
      return {
        eligible: true,
        receipt: {
          surface: target.surface,
          backend: "computer_compat",
          deliveryPath: "native_ax_scrape",
          reason: "CDP is unavailable; ComputerTool performs a read-only browser WebArea accessibility scrape"
        },
        blockers: []
      };
    return { eligible: false, blockers: ["browser_cdp_unavailable", "native_ax_unavailable"] };
  }
  if (target.surface === "visual_only") {
    return available.nativeCapture ? {
      eligible: true,
      receipt: {
        surface: target.surface,
        backend: "native_service",
        deliveryPath: "native_capture",
        reason: "target has no semantic route and native capture is live-verified"
      },
      blockers: []
    } : { eligible: false, blockers: ["native_capture_unavailable"] };
  }
  return available.nativeAX ? {
    eligible: true,
    receipt: {
      surface: target.surface,
      backend: "native_service",
      deliveryPath: "native_semantic",
      reason: target.surface === "browser_chrome" ? "browser chrome is outside the page DOM and belongs to macOS AX" : "target belongs to the macOS accessibility route"
    },
    blockers: []
  } : available.compatibilityAX ? {
    eligible: true,
    receipt: {
      surface: target.surface,
      backend: "computer_compat",
      deliveryPath: "compatibility_desktop",
      reason: target.surface === "browser_chrome" ? "browser chrome is outside page DOM and hands off to ComputerTool AX/desktop control" : "system UI hands off to ComputerTool AX/desktop control"
    },
    blockers: []
  } : { eligible: false, blockers: ["native_ax_unavailable"] };
}

/**
 * Handoff authority.
 *
 * PROVENANCE: `retainedHandoffs` above is recovered from the compiled bundle, but the functions
 * that use it were tree-shaken out of that bundle (the provider entry never reaches them), so the
 * four below are reconstructed from `__tests__/browser.convergence.route.test.ts`, their only
 * surviving specification.
 *
 * A handoff is a capability, not a hint: it names ONE task and one target, and it expires. A route
 * receipt proves which backend owns a surface; the handoff proves who is allowed to act on it, so
 * neither a different task nor a stale reference may reuse it.
 */
export const CONVERGED_HANDOFF_TTL_MS = 60_000;

export interface ConvergedHandoffAuthority {
  handoffRef: string;
  taskId: string;
  target: ConvergedComputerTargetRef;
  issuedAtMs: number;
  expiresAtMs: number;
}

/**
 * `target` is surfaced alongside the authority because callers act on it directly — they compare
 * every argument the model supplied against the target the handoff was minted for, and a handoff
 * whose target had to be dug out of a nested object invites acting on the model's arguments
 * instead of on the proven ones.
 */
export type ConvergedHandoffValidation =
  | { ok: true; authority: ConvergedHandoffAuthority; target: ConvergedComputerTargetRef }
  | { ok: false; error: string };

/** Drop every retained handoff. Used between tasks and by tests for isolation. */
export function clearConvergedHandoffs(): void {
  retainedHandoffs.clear();
}

/** Issue a handoff bound to one task, one target, and a bounded lifetime. */
export function mintConvergedHandoff(
  taskId: string,
  target: ConvergedComputerTargetRef,
  nowMs: number = Date.now(),
  ttlMs: number = CONVERGED_HANDOFF_TTL_MS,
): ConvergedHandoffAuthority {
  const handoffRef = `handoff-${taskId}-${nowMs}-${retainedHandoffs.size + 1}`;
  const authority: ConvergedHandoffAuthority = {
    handoffRef,
    taskId,
    target: { ...target },
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
  retainedHandoffs.set(handoffRef, authority);
  return authority;
}

/**
 * Validate a handoff for a specific task at a specific instant. Task binding is checked before
 * expiry so a cross-task reuse is always reported as the authority violation it is, rather than
 * being masked as a stale reference.
 */
export function validateConvergedHandoff(
  handoffRef: string,
  taskId: string,
  nowMs: number = Date.now(),
): ConvergedHandoffValidation {
  const authority: ConvergedHandoffAuthority | undefined = retainedHandoffs.get(handoffRef);
  if (!authority) return { ok: false, error: 'handoff reference is unknown or was already released' };
  if (authority.taskId !== taskId) {
    return { ok: false, error: `handoff was issued to a different task (${authority.taskId})` };
  }
  if (nowMs > authority.expiresAtMs) {
    return { ok: false, error: 'handoff has expired and must be re-minted from a fresh route' };
  }
  return { ok: true, authority, target: authority.target };
}

/** The exact browser authority a page route carries — preserved verbatim, never re-derived. */
export function browserPageRouteReceipt(
  url: string,
  authority: { tabRef: string; documentRef: string },
): { target: { surface: 'browser_page'; url: string; tabRef: string; documentRef: string } } {
  return {
    target: {
      surface: 'browser_page',
      url,
      tabRef: authority.tabRef,
      documentRef: authority.documentRef,
    },
  };
}
