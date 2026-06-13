import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StaticAnalyzer } from '../graph/static.analyzer';
import { GraphStore } from '../graph/graph.store';
import { planContext, estimateTokens } from '../graph/context.planner';

// G3 — Graph-Guided Context Pack. The pack must include the target's body and its
// neighbors' signatures, EXCLUDE unrelated code, and cost far fewer tokens than reading
// the whole file (the core "stop injecting whole files" win).
describe('planContext (G3)', () => {
  let proj: string;
  let store: GraphStore;
  let wholeFile: string;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-ctxpack-'));
    fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'CommonJS', strict: false },
      include: ['*.ts'],
    }));

    // `target` is small and calls `helper`; the file is padded with many unrelated
    // functions so a whole-file read is much larger than a focused pack.
    const noise = Array.from({ length: 40 }, (_, i) =>
      `export function noise${i}(): number {\n  return ${i} * 2 + Math.random();\n}`
    ).join('\n\n');
    const src = [
      'export function helper(n: number): number {',
      '  return n + 1;',
      '}',
      '',
      'export function target(n: number): number {',
      '  return helper(n) * 2;',
      '}',
      '',
      noise,
      '',
    ].join('\n');
    wholeFile = src;
    fs.writeFileSync(path.join(proj, 'sample.ts'), src);

    store = new GraphStore(':memory:');
    new StaticAnalyzer(proj, store).analyzeProject();
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('includes the target body and excludes unrelated functions', async () => {
    const pack = await planContext(store, 'func:sample.ts:target', { cwd: proj });
    expect('error' in pack).toBe(false);
    if ('error' in pack) return;

    expect(pack.text).toContain('return helper(n) * 2;'); // target body
    expect(pack.text).not.toContain('noise0');             // unrelated code excluded
    expect(pack.targetId).toBe('func:sample.ts:target');
  });

  it('lists the callee (helper) as a neighbor signature', async () => {
    const pack = await planContext(store, 'target', { cwd: proj });
    if ('error' in pack) throw new Error(pack.error);
    const helperEntry = pack.entries.find(e => e.nodeId === 'func:sample.ts:helper');
    expect(helperEntry).toBeDefined();
    expect(helperEntry!.role).toBe('callee');
  });

  it('costs far fewer tokens than reading the whole file', async () => {
    const pack = await planContext(store, 'func:sample.ts:target', { cwd: proj });
    if ('error' in pack) throw new Error(pack.error);
    const wholeFileTokens = estimateTokens(wholeFile);
    expect(pack.tokenEstimate).toBeLessThan(wholeFileTokens / 2);
  });

  it('returns an error for an unknown target', async () => {
    const pack = await planContext(store, 'doesNotExist', { cwd: proj });
    expect('error' in pack).toBe(true);
  });
});
