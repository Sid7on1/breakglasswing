/** Canonicalize tool-call arguments and conservatively repair common quote-boundary damage.
 *
 * Some OpenAI-compatible tool models emit the right object but displace one quote at a field
 * boundary, for example `{"action":"click, "query":""Search"}`. Rejecting that forever leaves a
 * capable desktop runtime unreachable. Repair is deliberately narrow: it runs only after strict
 * JSON parsing fails, makes only lexical quote-boundary corrections, and succeeds only when the
 * final value is a plain object. Tool schema and safety validation still run afterwards.
 */

export interface CanonicalToolArgs {
  json: string;
  value: Record<string, unknown>;
  repaired: boolean;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parsed(candidate: string, repaired: boolean): CanonicalToolArgs | null {
  try {
    const value = JSON.parse(candidate);
    return plainObject(value) ? { json: JSON.stringify(value), value, repaired } : null;
  } catch {
    return null;
  }
}

/** Recover a corrected JSON object appended after a damaged draft. If the prefix is also a valid
 * object, the two calls are ambiguous and neither is selected. */
function trailingCorrectedObject(source: string): CanonicalToolArgs | null {
  for (let index = source.lastIndexOf('{'); index > 0; index = source.lastIndexOf('{', index - 1)) {
    const suffix = parsed(source.slice(index).trim(), true);
    if (!suffix) continue;
    const prefix = source.slice(0, index).trim();
    if (!prefix || parsed(prefix, false)) return null;
    return suffix;
  }
  return null;
}

/** Return canonical JSON, a conservatively repaired object, or null when intent is ambiguous. */
export function canonicalToolArgs(raw: unknown): CanonicalToolArgs | null {
  if (plainObject(raw)) {
    try { return { json: JSON.stringify(raw), value: raw, repaired: false }; }
    catch { return null; }
  }
  if (raw == null) return { json: '{}', value: {}, repaired: false };
  const source = String(raw).trim();
  if (!source) return { json: '{}', value: {}, repaired: false };
  const strict = parsed(source, false);
  if (strict) return strict;

  // Live decoder pattern: a malformed draft is immediately followed by its complete correction.
  // Extracting only a uniquely valid suffix avoids trying to lexically repair a concatenation.
  const correctedSuffix = trailingCorrectedObject(source);
  if (correctedSuffix) return correctedSuffix;

  let candidate = source;
  // Extra opening quote: `"query":""Search"` -> `"query":"Search"`.
  candidate = candidate.replace(/(:\s*)""([^"\\\r\n]+)"/g, '$1"$2"');
  // Lost closing quote immediately before the next object key:
  // `"action":"click, "x":20` -> `"action":"click", "x":20`.
  // Repeat because one call can contain several damaged enum/string fields.
  const missingTerminator = /("(?:\\.|[^"\\])*"\s*:\s*")((?:\\.|[^"\\])*?)(,\s*"[^"\r\n]+"\s*:)/g;
  for (let pass = 0; pass < 4; pass++) {
    const next = candidate.replace(missingTerminator, '$1$2"$3');
    if (next === candidate) break;
    candidate = next;
  }
  // Split array token seen from tool-tuned models: `[""]cmd` -> `["cmd"]`.
  candidate = candidate.replace(/\[\s*""\]\s*([A-Za-z][A-Za-z0-9_+.-]*)(?=\s*[,}])/g, '["$1"]');

  if (candidate === source) return null;
  return parsed(candidate, true);
}
