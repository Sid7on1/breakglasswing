import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExemplarStore, Exemplar } from '../mind/exemplar.store';
import { embed, cosine, packEmbedding, nearest, setEmbedBackend, embedderInfo, EmbedBackend, EMBED_DIM } from '../mind/embedder';

describe('experience retrieval (v2 §9.3) — verified exemplars into the prompt', () => {
  let dir: string;
  let store: ExemplarStore;

  const seed = (items: Partial<Exemplar>[]) => {
    fs.mkdirSync(path.join(dir, '.bimax'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.bimax', 'exemplars.json'),
      JSON.stringify(items.map(e => ({ at: new Date().toISOString(), kind: 'mutation-fix', outcome: 'exact', ...e })), null, 2),
      'utf-8'
    );
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-exemplar-'));
    store = new ExemplarStore(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('retrieves the verified win most similar to the task, with its verification named', () => {
    seed([
      { op: 'negate-condition', file: 'src/auth/session.ts', testFile: 'src/__tests__/session.test.ts', defect: 'inverted token expiry check in validateSession' },
      { op: 'off-by-one', file: 'src/render/pager.go', testFile: 'pager_test.go', defect: 'pager scroll boundary off by one' },
    ]);
    const block = store.getPromptBlock('fix the session token expiry validation bug in src/auth/session.ts');
    expect(block).toContain('VERIFIED EXPERIENCE');
    expect(block).toContain('src/auth/session.ts');
    expect(block).toContain('session.test.ts'); // the receipts: every line names its verification
  });

  it('returns an EMPTY block when nothing is similar enough — no vibes injection', () => {
    seed([{ op: 'off-by-one', file: 'src/render/pager.go', testFile: 'pager_test.go', defect: 'pager scroll boundary' }]);
    expect(store.getPromptBlock('rewrite the marketing landing page hero copy')).toBe('');
  });

  it('returns empty on an empty corpus and blank context', () => {
    expect(store.getPromptBlock('anything at all')).toBe('');
    seed([{ op: 'x', file: 'a.ts', testFile: 'a.test.ts' }]);
    expect(store.getPromptBlock('')).toBe('');
  });

  it('backfills missing embeddings on first retrieval and caches them to disk', () => {
    seed([{ op: 'negate-condition', file: 'src/auth/session.ts', testFile: 'session.test.ts', defect: 'session expiry inverted' }]);
    let onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.bimax', 'exemplars.json'), 'utf-8'));
    expect(onDisk[0].embedding).toBeUndefined();

    store.retrieve('session expiry bug in src/auth/session.ts');

    onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.bimax', 'exemplars.json'), 'utf-8'));
    expect(Array.isArray(onDisk[0].embedding)).toBe(true);
    expect(onDisk[0].embedderV).toBe(1);
  });

  it('history-replay exemplars render with their task and recorded evidence', () => {
    seed([{ kind: 'history-replay', outcome: 'verified', task: 'add retry with backoff to the mcp client reconnect path', evidence: 'npx jest mcp.client.test.ts' }]);
    const block = store.getPromptBlock('mcp client reconnect should retry with backoff');
    expect(block).toContain('re-solved');
    expect(block).toContain('npx jest mcp.client.test.ts');
  });
});

describe('local embedder — the honest lexical kernel under retrieval', () => {
  it('similar code-task texts score far above unrelated ones', () => {
    const a = embed('fix the token expiry check in src/auth/session.ts validateSession');
    const b = embed('token expiry validation broken in src/auth/session.ts');
    const c = embed('paint the bikeshed a warmer shade of terracotta');
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c) + 0.2);
  });

  it('vectors are L2-normalized and survive the packed round-trip', () => {
    const v = embed('some representative input text');
    let mag = 0;
    for (let i = 0; i < v.length; i++) mag += v[i] * v[i];
    expect(Math.sqrt(mag)).toBeCloseTo(1, 5);
    const packed = packEmbedding(v);
    expect(cosine(v, packed)).toBeGreaterThan(0.999);
  });

  it('backend seam: a swapped encoder takes over embed() and bumps embedderInfo().version', () => {
    const fake: EmbedBackend = {
      name: 'fake-onnx', version: 2, dim: EMBED_DIM,
      embed: () => { const v = new Float32Array(EMBED_DIM); v[0] = 1; return v; },
    };
    try {
      setEmbedBackend(fake);
      expect(embedderInfo()).toEqual({ name: 'fake-onnx', version: 2, dim: EMBED_DIM });
      expect(embed('anything')[0]).toBe(1);
    } finally {
      setEmbedBackend(null);
    }
    expect(embedderInfo().name).toBe('hash-kernel'); // the floor is back
    expect(embedderInfo().version).toBe(1);
  });

  it('backend swap re-embeds a cached exemplar corpus — vector spaces never mix', () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-exswap-'));
    try {
      fs.mkdirSync(path.join(dir2, '.bimax'), { recursive: true });
      fs.writeFileSync(path.join(dir2, '.bimax', 'exemplars.json'), JSON.stringify([
        { at: new Date().toISOString(), kind: 'mutation-fix', outcome: 'exact', op: 'boundary', file: 'src/a.ts', testFile: 'a.test.ts', defect: 'x' },
      ]), 'utf-8');
      const s = new ExemplarStore(dir2);
      s.retrieve('src/a.ts boundary'); // caches v1 vectors
      expect(JSON.parse(fs.readFileSync(path.join(dir2, '.bimax', 'exemplars.json'), 'utf-8'))[0].embedderV).toBe(1);

      const fake: EmbedBackend = {
        name: 'fake-onnx', version: 2, dim: EMBED_DIM,
        embed: () => { const v = new Float32Array(EMBED_DIM); v.fill(1 / Math.sqrt(EMBED_DIM)); return v; },
      };
      setEmbedBackend(fake);
      try {
        s.retrieve('anything at all');
        expect(JSON.parse(fs.readFileSync(path.join(dir2, '.bimax', 'exemplars.json'), 'utf-8'))[0].embedderV).toBe(2);
      } finally {
        setEmbedBackend(null);
      }
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('nearest() ranks by cosine, honors k and the similarity floor', () => {
    const q = embed('session token expiry');
    const items = [
      { id: 1, embedding: packEmbedding(embed('session token expiry check')) },
      { id: 2, embedding: packEmbedding(embed('token session lifetime expiry')) },
      { id: 3, embedding: packEmbedding(embed('completely unrelated three.js gyroscope hero')) },
      { id: 4 }, // no embedding — skipped, never crashes
    ];
    const hits = nearest(q, items, 2, 0.2);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits[0].item.id).toBe(1);
    expect(hits.every(h => h.sim >= 0.2)).toBe(true);
    expect(hits.some(h => (h.item as any).id === 3)).toBe(false);
  });
});
