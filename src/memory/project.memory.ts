import { VectorStore } from './vector.store';

/**
 * Self-writing project memory. A thin, file-backed layer over the VectorStore that
 * stores durable project knowledge — conventions, decisions, gotchas — and recalls
 * the most relevant entries for a given prompt so they can be injected into context
 * each turn. Embeddings are local (no API cost), so recall is cheap to run per turn.
 */
export class ProjectMemory {
  constructor(private store = new VectorStore()) {}

  async remember(content: string, kind: 'convention' | 'decision' | 'gotcha' | 'note' = 'note', tags: string[] = []): Promise<string> {
    const trimmed = content.trim();
    if (!trimmed) return '';
    // Stable-ish id from kind + content hash so re-remembering the same fact updates it.
    let hash = 0;
    for (let i = 0; i < trimmed.length; i++) { hash = ((hash << 5) - hash + trimmed.charCodeAt(i)) | 0; }
    const id = `pmem-${kind}-${Math.abs(hash).toString(36)}`;
    await this.store.storeDocument(id, trimmed, ['project-memory', kind, ...tags]);
    return id;
  }

  async recall(query: string, limit = 3): Promise<string[]> {
    // Lower confidence threshold than the default store search: project memories are
    // short and the local bag-of-words embedding produces modest cosine scores, so a
    // strict cutoff would suppress genuinely relevant conventions.
    const docs = await this.store.semanticSearch(query, limit * 2, 0.08);
    return docs
      .filter(d => d.metadata.tags.includes('project-memory'))
      .map(d => d.metadata.content)
      .slice(0, limit);
  }

  /** A compact context block for injection into the system prompt, or '' if nothing relevant. */
  async recallBlock(query: string, limit = 3): Promise<string> {
    const hits = await this.recall(query, limit);
    if (hits.length === 0) return '';
    const bullets = hits.map(h => `- ${h.replace(/\n+/g, ' ').slice(0, 240)}`).join('\n');
    return `### PROJECT MEMORY (learned conventions & decisions — apply them)\n${bullets}`;
  }
}

export const globalProjectMemory = new ProjectMemory();
