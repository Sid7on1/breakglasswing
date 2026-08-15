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
  const [chrome, setChrome] = useState<WindowChromeState>({ fullScreen: false, maximized: false });

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

  return { ...chrome, expanded };
}
