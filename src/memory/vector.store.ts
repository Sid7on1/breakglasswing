import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils';
import { Mutex } from 'async-mutex';

/**
 * File-backed memory store with LEXICAL relevance search.
 *
 * This used to claim "semantic" search backed by 512-bucket hash "embeddings" and a cosine that
 * divided by the query norm only — collisions conflated unrelated words and the ranking was
 * mathematically wrong. It is now an honest keyword search: real cosine similarity over
 * term-frequency vectors of the actual words. No external model, no API cost, correct math. If true
 * semantic recall (synonyms / meaning) is needed later, swap `relevance()` for a real embedding call.
 *
 * Old on-disk records may still carry a stale `embedding` array — it's simply ignored on load.
 */
export interface VectorDocument {
  id: string;
  metadata: {
    tags: string[];
    content: string;
  };
}

const STOP = new Set(['the', 'is', 'a', 'to', 'it', 'on', 'and', 'in', 'of', 'for', 'with', 'my', 'this', 'that', 'says', 'an', 'be', 'are', 'as', 'at', 'or', 'from']);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function l2norm(tf: Map<string, number>): number {
  let s = 0;
  for (const w of tf.values()) s += w * w;
  return Math.sqrt(s);
}

/** Cosine similarity (0..1) over two term-frequency vectors. Correct normalization: both norms. */
function cosineTF(a: Map<string, number>, aNorm: number, b: Map<string, number>, bNorm: number): number {
  if (aNorm === 0 || bNorm === 0) return 0;
  // Walk the smaller map; only shared terms contribute to the dot product.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const o = big.get(term);
    if (o) dot += w * o;
  }
  return dot / (aNorm * bNorm);
}

/** Lexical relevance (cosine over term frequencies) between a query and a document, in [0,1]. */
export function lexicalRelevance(query: string, text: string): number {
  const q = termFreq(tokenize(query));
  const d = termFreq(tokenize(text));
  return cosineTF(q, l2norm(q), d, l2norm(d));
}

export class VectorStore {
  private store: VectorDocument[] = [];
  private readonly STORE_PATH = path.join(process.cwd(), '.breakglass/memory', 'vectors.json');
  private rwMutex = new Mutex();
  // Hard cap: evict oldest entries once exceeded to prevent unbounded growth & O(N) blowup.
  private readonly MAX_VECTORS = 500;

  constructor() {
    this.loadStore().catch(() => {});
  }

  private async loadStore(alreadyLocked: boolean = false) {
    const load = async () => {
      try {
        const data = await fs.readFile(this.STORE_PATH, 'utf-8');
        this.store = JSON.parse(data);
        Logger.info(`[VectorStore] Loaded ${this.store.length} memories from disk.`);
      } catch (e) {
        // Missing file is fine
      }
    };

    if (alreadyLocked) {
      await load();
    } else {
      await this.rwMutex.runExclusive(load);
    }
  }

  private async saveStore() {
    try {
      await fs.mkdir(path.dirname(this.STORE_PATH), { recursive: true });
      await fs.writeFile(this.STORE_PATH, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (e) {
      Logger.error(`[VectorStore] Failed to write memories to disk.`);
    }
  }

  async storeDocument(id: string, text: string, tags: string[]): Promise<void> {
    await this.rwMutex.runExclusive(async () => {
      const doc: VectorDocument = { id, metadata: { tags, content: text } };
      const existingIdx = this.store.findIndex(d => d.id === id);
      if (existingIdx >= 0) {
        this.store[existingIdx] = doc;
      } else {
        this.store.push(doc);
        // Evict oldest entries once the cap is exceeded (FIFO).
        if (this.store.length > this.MAX_VECTORS) {
          this.store.splice(0, this.store.length - this.MAX_VECTORS);
        }
      }
      await this.saveStore();
      Logger.info(`[VectorStore] Memorized '${id}'.`);
    });
  }

  /** Lexical relevance search. `minScore` is a cosine floor in [0,1]; matches below it are dropped. */
  async semanticSearch(query: string, limit: number = 3, minScore: number = 0.25): Promise<VectorDocument[]> {
    Logger.info(`[VectorStore] Lexical search for: "${query.substring(0, 30)}..."`);

    const queryTF = termFreq(tokenize(query));
    const queryNorm = l2norm(queryTF);
    if (queryNorm === 0) return [];

    return this.rwMutex.runExclusive(async () => {
      await this.loadStore(true); // loads store inside mutex (already locked)
      if (this.store.length === 0) return [];

      const scored = this.store.map(doc => {
        const docTF = termFreq(tokenize(doc.metadata?.content || ''));
        const score = cosineTF(queryTF, queryNorm, docTF, l2norm(docTF));
        return { doc, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.filter(item => item.score > minScore).slice(0, limit).map(item => item.doc);
    });
  }
}
