import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteGraphStore, createGraphStore } from '../graph/sqlite.graph.store';
import { GraphNode } from '../graph/models';

const fileNode = (rel: string): GraphNode => ({ id: `file:${rel}`, name: path.basename(rel), type: 'FILE', filePath: rel });
const fnNode = (rel: string, fn: string): GraphNode => ({ id: `function:${fn}:${rel}`, name: fn, type: 'FUNCTION', filePath: rel });

describe('SqliteGraphStore (v2 §3.9) — atomic persistence + per-file staleness', () => {
  let dir: string;
  let store: SqliteGraphStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-graphdb-'));
    store = new SqliteGraphStore(path.join(dir, '.breakglass/graph', 'graph.db'));
    expect(store.isAvailable()).toBe(true);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips nodes and edges through SQLite in one transaction', async () => {
    store.addNode(fileNode('src/a.ts'));
    store.addNode(fnNode('src/a.ts', 'doThing'));
    store.addEdge({ sourceId: 'file:src/a.ts', targetId: 'function:doThing:src/a.ts', type: 'CONTAINS' });
    await store.saveToDisk();

    const fresh = new SqliteGraphStore(path.join(dir, '.breakglass/graph', 'graph.db'));
    await fresh.loadFromDisk();
    expect(fresh.getGraph().nodes.size).toBe(2);
    expect(fresh.getEdgesFrom('file:src/a.ts')).toHaveLength(1);
    expect(fresh.getNode('function:doThing:src/a.ts')?.name).toBe('doThing');
    fresh.close();
  });

  it('staleness: an untouched file is quiet, an edited file is CHANGED, a removed file is DELETED', async () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;', 'utf-8');
    fs.writeFileSync(path.join(dir, 'src/b.ts'), 'export const b = 2;', 'utf-8');
    store.addNode(fileNode('src/a.ts'));
    store.addNode(fileNode('src/b.ts'));
    await store.saveToDisk();
    expect(store.recordFileHashes(dir)).toBe(2);

    expect(store.staleFiles(dir)).toEqual({ changed: [], deleted: [] });

    fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 999;', 'utf-8');
    fs.rmSync(path.join(dir, 'src/b.ts'));
    const stale = store.staleFiles(dir);
    expect(stale.changed).toEqual(['src/a.ts']);
    expect(stale.deleted).toEqual(['src/b.ts']);
  });

  it('a touched-but-identical file re-baselines to the fast path instead of re-flagging', () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const p = path.join(dir, 'src/a.ts');
    fs.writeFileSync(p, 'same content', 'utf-8');
    store.addNode(fileNode('src/a.ts'));
    store.recordFileHashes(dir);
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(p, past, past); // mtime moved, bytes identical
    expect(store.staleFiles(dir).changed).toEqual([]);
    expect(store.staleFiles(dir).changed).toEqual([]); // second pass rides the refreshed stat baseline
  });

  it('removeFileNodes drops a file\'s nodes, their edges, and its hash baseline', async () => {
    store.addNode(fileNode('src/a.ts'));
    store.addNode(fnNode('src/a.ts', 'doThing'));
    store.addNode(fileNode('src/b.ts'));
    store.addEdge({ sourceId: 'file:src/b.ts', targetId: 'function:doThing:src/a.ts', type: 'IMPORTS' });
    const removed = store.removeFileNodes('src/a.ts');
    expect(removed).toBe(2);
    expect(store.getGraph().nodes.size).toBe(1);
    expect(store.getEdgesFrom('file:src/b.ts')).toHaveLength(0); // edge to the dead node went with it
  });

  it('one-time migration: an empty DB imports the legacy playground.json beside it', async () => {
    const gdir = path.join(dir, '.breakglass/graph');
    fs.writeFileSync(path.join(gdir, 'playground.json'), JSON.stringify({
      nodes: [fileNode('src/legacy.ts')], edges: [],
    }), 'utf-8');
    const fresh = new SqliteGraphStore(path.join(gdir, 'graph.db'));
    await fresh.loadFromDisk();
    expect(fresh.getGraph().nodes.size).toBe(1);
    expect(fresh.getNode('file:src/legacy.ts')).toBeDefined();
    // …and it persisted: a THIRD instance reads it from SQLite without the JSON.
    fs.rmSync(path.join(gdir, 'playground.json'));
    const third = new SqliteGraphStore(path.join(gdir, 'graph.db'));
    await third.loadFromDisk();
    expect(third.getGraph().nodes.size).toBe(1);
    fresh.close();
    third.close();
  });

  it('createGraphStore factory prefers SQLite and keeps the IGraphStore contract', async () => {
    const s = createGraphStore(dir);
    expect(s).toBeInstanceOf(SqliteGraphStore);
    s.addNode(fileNode('src/x.ts'));
    await s.saveToDisk();
    await s.loadFromDisk();
    expect(s.getGraph().nodes.size).toBe(1);
    (s as SqliteGraphStore).close();
  });
});
