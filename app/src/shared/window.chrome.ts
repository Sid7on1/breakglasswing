/**
 * What the window and the platform look like right now.
 *
 * One message, three consumers — main publishes it, preload forwards it, the renderer styles
 * itself against it — so it lives where all three can import the same declaration rather than each
 * restating the shape and drifting. (They had already drifted: preload described it inline in three
 * places, so widening it meant widening it three times or silently narrowing the payload.)
 *
 * Everything here is an *observation*, never an instruction. The renderer decides what a
 * non-key window or a user's accent colour should look like; this only reports the facts.
 */
export interface WindowChromeState {
  fullScreen: boolean;
  maximized: boolean;
  /**
   * AppKit's `appearsActive` — is this the key window?
   *
   * Prompt 2 §15: when BiMAX is not key, sidebar labels, secondary icons, selection intensity and
   * decorative glass response all ease off, the way every Mac app's chrome does. Explicitly *not*
   * greying the app out: the user reading a diff in an unfocused window must not have to click it
   * first.
   *
   * Chromium has no CSS for this (`:window-inactive` is WebKit-only), so it has to be plumbed.
   */
  active: boolean;
  /**
   * The user's accent colour as `#rrggbb`, or null where the platform has none.
   *
   * Prompt 2 §14 and §89. Null means "keep the design's own token" — a fallback hex here would
   * quietly become the design on every machine where the query failed.
   */
  accent: string | null;
}
