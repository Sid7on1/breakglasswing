/**
 * Detects a corrupt write/edit before it touches disk.
 *
 * Weaker models (notably the default NVIDIA llama-70b) mangle existing multi-line files in two
 * observed ways when asked to modify them:
 *   1. Flattening  — they rewrite the whole file but strip the newlines, collapsing dozens of
 *      lines onto one giant line (the code is "there" but the syntax is broken).
 *   2. Truncation  — they overwrite the file with just the first line or two (the rest is lost),
 *      often emitting a literal "\n" (backslash-n) as text instead of a real line break.
 * Both leave the file with far fewer real lines than it started with. We refuse such writes and
 * steer the model to a surgical edit instead.
 *
 * The rule is deliberately conservative so it never blocks an ordinary change: it only fires when
 * a genuinely structured file (>= 6 lines) is being replaced by a one/two-line blob, or when the
 * content carries escaped newlines as text with no real line breaks at all.
 *
 * @returns a human-readable reason string when the write looks corrupt, or `null` when it's fine.
 */
export function detectCorruptWrite(prior: string, next: string, filePath: string): string | null {
  // Minified bundles are legitimately single-line — never flag them.
  if (/\.min\.[a-z0-9]+$/i.test(filePath)) return null;

  const priorLines = prior.split('\n').length;
  const realNewlines = (next.match(/\n/g) || []).length;
  const nextLines = realNewlines + 1;
  const literalEscapes = (next.match(/\\n/g) || []).length;

  // (a) A multi-line file collapsed to one or two lines. Whatever the intent, the agent
  // replacing a structured file with a one-liner is overwhelmingly a corrupt write
  // (flattened or truncated) — catch it regardless of byte length.
  if (priorLines >= 6 && nextLines <= 2) {
    return `the existing file has ${priorLines} lines but the new content has ${nextLines} line(s) ` +
      `— replacing a multi-line file with a one-liner looks like a corrupt write (flattened or truncated)`;
  }

  // (b) Escaped newlines written as text with no real line breaks at all — the model emitted
  // "\n" literally instead of pressing enter. Unambiguous corruption at any prior size.
  if (literalEscapes >= 2 && realNewlines === 0) {
    return `the new content has ${literalEscapes} literal "\\n" sequences but no real line breaks ` +
      `— the model wrote escaped newlines as text instead of real ones, which corrupts the file`;
  }

  return null;
}
