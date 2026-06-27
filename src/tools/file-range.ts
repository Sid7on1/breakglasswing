// Shared, pure line-range slicing used by both ReadFileTool (whole-file reads with an
// optional range) and the graph's READ_SYMBOL verb (surgical single-symbol reads). Kept
// in its own module — no fs, no governor — so the slicing contract is unit-tested once and
// both call sites share exactly one implementation (no duplication).

/**
 * Slice `content` to a 1-based, inclusive line range, prefixing each kept line with its
 * absolute line number (`123: ...`). `startLine`/`endLine` are clamped to the file bounds,
 * so out-of-range values are tolerated rather than throwing. Returns `{ error }` only when
 * the (clamped) start is past the (clamped) end — a genuinely empty/invalid range.
 */
export function sliceLineRange(
  content: string,
  startLine?: number,
  endLine?: number
): { text?: string; error?: string } {
  const lines = content.split('\n');
  const start = Math.max(1, startLine || 1);
  const end = Math.min(lines.length, endLine || lines.length);

  if (start > end) {
    return { error: `startLine (${start}) cannot be greater than endLine (${end}).` };
  }

  const text = lines
    .slice(start - 1, end)
    .map((line, idx) => `${start + idx}: ${line}`)
    .join('\n');
  return { text };
}
