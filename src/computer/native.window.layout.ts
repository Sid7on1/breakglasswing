/**
 * Window layout presets (master-plan §10.5: halves, thirds, quadrants, center, maximize).
 *
 * Pure geometry over a display's *usable* bounds — the menu-bar/Dock-free rectangle the native
 * workspace snapshot measures. A preset is computed here and delivered as an ordinary
 * `set_window_frame`, so tiling adds no new native authority and no new approval path.
 *
 * A display that reported no usable bounds produces no layout. The full display rectangle is not
 * substituted: a window "maximized" under the menu bar is not what the caller asked for.
 */
export type WindowTilePreset =
  | 'left_half' | 'right_half' | 'top_half' | 'bottom_half'
  | 'left_third' | 'center_third' | 'right_third'
  | 'left_two_thirds' | 'right_two_thirds'
  | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'
  | 'center' | 'maximize';

export interface LayoutRect { x: number; y: number; width: number; height: number }

export const WINDOW_TILE_PRESETS: WindowTilePreset[] = [
  'left_half', 'right_half', 'top_half', 'bottom_half',
  'left_third', 'center_third', 'right_third', 'left_two_thirds', 'right_two_thirds',
  'top_left', 'top_right', 'bottom_left', 'bottom_right', 'center', 'maximize',
];

function round(rect: LayoutRect): LayoutRect {
  // Whole points only: a fractional window origin is rounded by the window server anyway, and the
  // receipt's honored check compares against what was asked for.
  return {
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
  };
}

export function computeWindowTile(
  preset: WindowTilePreset,
  usableBounds: LayoutRect | undefined,
): LayoutRect | null {
  if (!usableBounds) return null;
  const { x, y, width: w, height: h } = usableBounds;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  const third = w / 3;
  const half = { w: w / 2, h: h / 2 };
  switch (preset) {
    case 'left_half': return round({ x, y, width: half.w, height: h });
    case 'right_half': return round({ x: x + half.w, y, width: half.w, height: h });
    case 'top_half': return round({ x, y, width: w, height: half.h });
    case 'bottom_half': return round({ x, y: y + half.h, width: w, height: half.h });
    case 'left_third': return round({ x, y, width: third, height: h });
    case 'center_third': return round({ x: x + third, y, width: third, height: h });
    case 'right_third': return round({ x: x + third * 2, y, width: third, height: h });
    case 'left_two_thirds': return round({ x, y, width: third * 2, height: h });
    case 'right_two_thirds': return round({ x: x + third, y, width: third * 2, height: h });
    case 'top_left': return round({ x, y, width: half.w, height: half.h });
    case 'top_right': return round({ x: x + half.w, y, width: half.w, height: half.h });
    case 'bottom_left': return round({ x, y: y + half.h, width: half.w, height: half.h });
    case 'bottom_right': return round({ x: x + half.w, y: y + half.h, width: half.w, height: half.h });
    case 'center': return round({ x: x + w / 4, y: y + h / 4, width: half.w, height: half.h });
    case 'maximize': return round({ x, y, width: w, height: h });
    default: return null;
  }
}

/** The display whose usable area contains the window's center, else the one it overlaps most. */
export function displayForWindow(
  window: LayoutRect,
  displays: Array<{ displayId: number; bounds: LayoutRect; usableBounds?: LayoutRect }>,
): { displayId: number; bounds: LayoutRect; usableBounds?: LayoutRect } | null {
  if (!displays.length) return null;
  const centerX = window.x + window.width / 2;
  const centerY = window.y + window.height / 2;
  const containing = displays.find(display => centerX >= display.bounds.x
    && centerX <= display.bounds.x + display.bounds.width
    && centerY >= display.bounds.y && centerY <= display.bounds.y + display.bounds.height);
  if (containing) return containing;
  let best: { display: typeof displays[number]; area: number } | null = null;
  for (const display of displays) {
    const overlapWidth = Math.max(0, Math.min(window.x + window.width, display.bounds.x + display.bounds.width) - Math.max(window.x, display.bounds.x));
    const overlapHeight = Math.max(0, Math.min(window.y + window.height, display.bounds.y + display.bounds.height) - Math.max(window.y, display.bounds.y));
    const area = overlapWidth * overlapHeight;
    if (area > 0 && (!best || area > best.area)) best = { display, area };
  }
  return best?.display ?? null;
}
