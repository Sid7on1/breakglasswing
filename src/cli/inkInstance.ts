// Holder for the live Ink render instance so code outside repl.ts (e.g. the resize handler in
// FullScreen) can reach Ink's own clear()/rerender(). Resetting Ink's internal frame tracking on
// resize is what stops the ghost/overlay: a raw screen-clear alone leaves Ink thinking the old
// frame is still on screen, so its next paint erases lines using the pre-resize width.
type InkInstance = { clear: () => void; rerender: (node: any) => void; unmount: () => void };

let current: InkInstance | null = null;

export function setInkInstance(instance: InkInstance): void {
  current = instance;
}

export function getInkInstance(): InkInstance | null {
  return current;
}
