import { EmbeddingsGenerator } from './embeddings';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils';
import { Mutex } from 'async-mutex';

export interface VectorDocument {
  id: string;
  embedding: number[];
  metadata: {
    tags: string[];
    content: string;
  };
}

export class VectorStore {
  private store: VectorDocument[] = [];
  private embedder = new EmbeddingsGenerator();
  private readonly STORE_PATH = path.join(process.cwd(), '.breakglass/memory', 'vectors.json');
  private rwMutex = new Mutex();

  constructor() {
    this.loadStore().catch(() => {});
  }

  private async loadStore() {
    await this.rwMutex.runExclusive(async () => {
      try {
        const data = await fs.readFile(this.STORE_PATH, 'utf-8');
        this.store = JSON.parse(data);
        Logger.info(`[VectorStore] Loaded ${this.store.length} memory vectors from disk.`);
      } catch (e) {
        // Missing file is fine
      }
    });
  }

  private async saveStore() {
    try {
      await fs.mkdir(path.dirname(this.STORE_PATH), { recursive: true });
      await fs.writeFile(this.STORE_PATH, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (e) {
      Logger.error(`[VectorStore] Failed to write vectors to disk.`);
    }
  }

  async storeDocument(id: string, text: string, tags: string[]): Promise<void> {
    const embedding = await this.embedder.generateEmbedding(text);
    
    await this.rwMutex.runExclusive(async () => {
      // Replace if exists
      const existingIdx = this.store.findIndex(d => d.id === id);
      const doc: VectorDocument = {
        id,
        embedding,
        metadata: { tags, content: text }
      };

      if (existingIdx >= 0) {
        this.store[existingIdx] = doc;
      } else {
        this.store.push(doc);
      }

      await this.saveStore();
      Logger.info(`[VectorStore] Memorized document '${id}' to physical storage.`);
    });
  }

  async semanticSearch(query: string, limit: number = 3): Promise<VectorDocument[]> {
    Logger.info(`[VectorStore] Running offline semantic search for query: "${query.substring(0, 30)}..."`);
    await this.loadStore(); // This is protected internally
    
    if (this.store.length === 0) return [];

    const queryEmbedding = await this.embedder.generateEmbedding(query);
    
    const scoredDocs = this.store.map(doc => {
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < doc.embedding.length; i++) {
        dotProduct += queryEmbedding[i] * doc.embedding[i];
        normA += queryEmbedding[i] * queryEmbedding[i];
        normB += doc.embedding[i] * doc.embedding[i];
      }
      const denominator = Math.sqrt(normA) * Math.sqrt(normB);
      // Guard against division by zero (zero-magnitude vectors)
      const score = denominator === 0 ? 0 : Math.max(-1, Math.min(1, dotProduct / denominator));
      return { doc, score };
    });

    // Sort by descending score
    scoredDocs.sort((a, b) => b.score - a.score);
    
    scoredDocs.forEach(d => Logger.info(`[VectorStore] Score for ${d.doc.id}: ${d.score.toFixed(3)}`));

    // Filter out terrible matches (Threshold 0.25 for high confidence)
    const topMatches = scoredDocs.filter(item => item.score > 0.25).slice(0, limit);
    
    return topMatches.map(item => item.doc);
  }
}
