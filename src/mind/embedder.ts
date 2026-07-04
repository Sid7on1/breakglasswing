/**
 * Local embeddings (BiMax v2, D2 — the honest zero-dependency tier).
 *
 * Character/token n-gram FEATURE HASHING into a fixed-dimension vector + cosine
 * similarity. Runs everywhere, costs nothing, needs no model download — and is
 * deliberately labeled for what it is: a lexical-similarity kernel, not a semantic
 * model. For the two v2 consumers (diff-taste k-NN, exemplar retrieval) that's the
 * right honesty tradeoff, because BOTH only ever use embeddings as *evidence
 * retrieval with the retrieved items shown* (the plan's own self-critique made that
 * a hard rule).
 *
 * BACKEND SEAM: `embed()` delegates to the active EmbedBackend. A real local encoder
 * (ONNX, reusing the Headroom venv muscle) plugs in via `setEmbedBackend` or the
 * BIMAX_EMBEDDER_MODULE env hook (a module exporting `createBackend()`), and every
 * vector store re-embeds automatically because they persist `embedderInfo().version`
 * alongside their cached vectors — swapping the model can never silently mix vector
 * spaces.
 */

export const EMBED_DIM = 256;

export interface EmbedBackend {
  name: string;
  /** Bump when vectors are incompatible with the previous backend — stores re-embed on mismatch. */
  version: number;
  dim: number;
  embed(text: string): Float32Array;
}

/** FNV-1a 32-bit — fast, stable string hash for feature bucketing. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Embed text: word unigrams+bigrams and char trigrams, hashed into EMBED_DIM buckets
 * with a sign trick (second hash decides ±) to reduce collision bias, L2-normalized.
 */
function hashKernelEmbed(text: string): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  const norm = (text || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 20_000);
  if (!norm) return v;

  const bump = (feat: string, w: number) => {
    const h = fnv1a(feat);
    const sign = (h & 0x80000000) ? -1 : 1;
    v[h % EMBED_DIM] += sign * w;
  };

  const words = norm.split(/[^a-z0-9_$./-]+/).filter(w => w.length > 1);
  for (let i = 0; i < words.length; i++) {
    bump(`w:${words[i]}`, 1);
    if (i + 1 < words.length) bump(`b:${words[i]}|${words[i + 1]}`, 1.5);
  }
  for (let i = 0; i + 3 <= Math.min(norm.length, 4000); i++) {
    bump(`c:${norm.slice(i, i + 3)}`, 0.25);
  }

  let mag = 0;
  for (let i = 0; i < EMBED_DIM; i++) mag += v[i] * v[i];
  mag = Math.sqrt(mag);
  if (mag > 0) for (let i = 0; i < EMBED_DIM; i++) v[i] /= mag;
  return v;
}

const HASH_KERNEL: EmbedBackend = { name: 'hash-kernel', version: 1, dim: EMBED_DIM, embed: hashKernelEmbed };

let _backend: EmbedBackend | null = null;

/**
 * Resolve the active backend: an explicitly-set one wins; otherwise the
 * BIMAX_EMBEDDER_MODULE hook is tried ONCE (a module exporting `createBackend():
 * EmbedBackend` — the ONNX plug point); the hash kernel is the always-works floor.
 */
function activeBackend(): EmbedBackend {
  if (_backend) return _backend;
  const mod = process.env.BIMAX_EMBEDDER_MODULE;
  if (mod) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require(mod);
      const b = loaded?.createBackend?.();
      if (b && typeof b.embed === 'function' && b.version > 1) {
        _backend = b as EmbedBackend;
        return _backend;
      }
    } catch { /* a broken plugin must never take retrieval down — fall through */ }
  }
  _backend = HASH_KERNEL;
  return _backend;
}

/** Swap the encoder (tests, or a real ONNX backend wired at boot). Null restores the default resolution. */
export function setEmbedBackend(b: EmbedBackend | null): void { _backend = b; }

/** What the persisted vector stores stamp next to their cached vectors. */
export function embedderInfo(): { name: string; version: number; dim: number } {
  const b = activeBackend();
  return { name: b.name, version: b.version, dim: b.dim };
}

/** Embed text with the active backend (hash kernel unless a real encoder is plugged in). */
export function embed(text: string): Float32Array {
  return activeBackend().embed(text);
}

/** Cosine similarity of two L2-normalized vectors (plain dot product). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Round-trippable compact form for JSON stores (3 decimals is plenty for cosine). */
export function packEmbedding(v: Float32Array): number[] {
  return Array.from(v, x => Math.round(x * 1000) / 1000);
}

export interface Neighbor<T> { item: T; sim: number }

/** k nearest neighbors by cosine among items carrying packed embeddings. */
export function nearest<T extends { embedding?: number[] }>(
  query: Float32Array, items: T[], k: number, minSim = 0.1
): Neighbor<T>[] {
  const scored: Neighbor<T>[] = [];
  for (const item of items) {
    if (!item.embedding || item.embedding.length === 0) continue;
    const sim = cosine(query, item.embedding);
    if (sim >= minSim) scored.push({ item, sim });
  }
  return scored.sort((a, b) => b.sim - a.sim).slice(0, k);
}
