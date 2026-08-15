import { useEffect, useState } from 'react';
import type { WindowChromeState } from './global';

/**
 * Whether the window owns the whole screen, published to CSS as `:root[data-chrome]`.
 *
 * Liquid glass is a *windowed* treatment. A floating window sits over the user's desktop, so a
 * translucent panel samples real depth behind it. Full screen and a zoomed window sit against
 * nothing but the app's own opaque body — there the blur samples our own background, which reads as
 * grey haze, costs a compositor pass per frame, and lowers text contrast for no gain. So the shell
 * goes solid when it expands.
 *
 * The attribute lives on `<html>` rather than in a prop so that portalled surfaces (dialogs, the
 * command palette, dropdowns) inherit the same treatment without threading state through them —
 * exactly how `appearance.ts` publishes the theme.
 */
export function useWindowChrome(): WindowChromeState & { expanded: boolean } {
  // Optimistic defaults: a window that has not reported yet is assumed key and un-accented, because
  // the alternative — starting subdued and brightening a frame later — is a visible flinch on every
  // launch, and it would be wrong on the overwhelmingly common path.
  const [chrome, setChrome] = useState<WindowChromeState>({
    fullScreen: false, maximized: false, active: true, accent: null,
  });

  useEffect(() => {
    // The listener is attached before the first read so no state change is missed, and a live event
    // that lands while the read is still in flight wins — the awaited value is the older fact.
    let live = false;
    const stop = window.bimax.windowChrome.onState((state) => { live = true; setChrome(state); });
    void window.bimax.windowChrome.get().then((state) => { if (!live) setChrome(state); });
    return stop;
  }, []);

  const expanded = chrome.fullScreen || chrome.maximized;

  useEffect(() => {
    document.documentElement.dataset.chrome = expanded ? 'expanded' : 'windowed';
  }, [expanded]);

  /*
    Key-window state, as an attribute rather than a prop (Prompt 2 §15).

    Same reasoning as the chrome attribute above and the theme in `appearance.ts`: every portalled
    surface — dialogs, the command palette, every morph shell — is outside the React tree that would
    carry a prop, and a title bar that dims while the popover it opened stays bright is worse than
    not dimming at all.

    Only ever written as "false"; the active state is the absence of the attribute, so nothing has to
    be un-styled and a stylesheet that has not opted in behaves exactly as it did before.
  */
  useEffect(() => {
    if (chrome.active) delete document.documentElement.dataset.windowActive;
    else document.documentElement.dataset.windowActive = 'false';
  }, [chrome.active]);

  /*
    The user's accent colour.

    Published as a variable the theme *may* use, not as a replacement for the palette. BiMAX's
    identity colours are its own (§102: identity does not come from the system accent), so this
    feeds the places where macOS convention says the accent belongs — selection, the active
    workspace, meaningful state (§14) — and nothing else.
  */
  useEffect(() => {
    const root = document.documentElement;
    if (chrome.accent) root.style.setProperty('--accent-system', chrome.accent);
    else root.style.removeProperty('--accent-system');
  }, [chrome.accent]);

  return { ...chrome, expanded };
}
