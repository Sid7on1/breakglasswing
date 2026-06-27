/**
 * Bound a live (non-<Static>) text block to the terminal viewport by keeping only its
 * tail. Ink redraws the dynamic region in place by erasing the previous frame; if that
 * region ever grows taller than the terminal it can no longer erase it, and every
 * subsequent frame is re-appended to scrollback — which is how a long streamed answer
 * balloons into hundreds of duplicated lines. Completed turns are committed to <Static>
 * (rendered once, with full markdown), so only the in-progress tail needs bounding.
 *
 * Truncation is by estimated *visual* rows (accounting for soft-wrap at the given width),
 * not raw newlines, so a single long paragraph can't blow past the budget.
 */
export function tailToHeight(text: string, maxRows: number, width: number): { text: string; truncated: boolean } {
  if (maxRows <= 0) return { text: '', truncated: text.length > 0 };
  const cols = Math.max(1, width);
  const lines = text.split('\n');
  const kept: string[] = [];
  let rows = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineRows = Math.max(1, Math.ceil(lines[i].length / cols));
    if (rows + lineRows > maxRows && kept.length > 0) {
      return { text: kept.join('\n'), truncated: true };
    }
    rows += lineRows;
    kept.unshift(lines[i]);
  }
  return { text: kept.join('\n'), truncated: false };
}
