import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StaticAnalyzer } from '../graph/static.analyzer';
import { GraphStore } from '../graph/graph.store';
import { createGraphQueryTool } from '../tools/implementations/graph.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// The verified ArchMind weaknesses: a bare class name returned "ambiguous", and GET_DEPENDENTS
// counted the owning class/file (structural) + transitive nodes as "dependents" (6 vs 2 real callers).
describe('GraphQueryTool — direct dependents, not owners', () => {
  let proj: string;
  let store: GraphStore;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-graphdep-'));
    fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'CommonJS', strict: false }, include: ['*.ts'],
    }));
    // update() calls bootstrap(); both live on the Analyzer class. The class/file CONTAIN bootstrap
    // but do not depend on it — only update() does.
    const src = [
      'export class Analyzer {',
      '  update(): void {',
      '    this.bootstrap();',
      '  }',
      '  private bootstrap(): void {',
      '    return;',
      '  }',
      '}',
    ].join('\n');
    fs.writeFileSync(path.join(proj, 'sample.ts'), src);
    store = new GraphStore(':memory:');
    new StaticAnalyzer(proj, store).analyzeProject();
  });
  afterEach(() => fs.rmSync(proj, { recursive: true, force: true }));

  it('GET_DEPENDENTS on a bare method lists the caller, not the owning class', async () => {
    const out: string = await createGraphQueryTool(governor, store).execute({ query: 'GET_DEPENDENTS bootstrap' }, { cwd: proj });
    expect(out).toContain('update');          // the real caller
    expect(out).not.toContain('CLASS Analyzer'); // the owning class is NOT a dependent
  });

  it('resolves a bare class name instead of returning "ambiguous"', async () => {
    const out: string = await createGraphQueryTool(governor, store).execute({ query: 'GET_DEPENDENTS Analyzer' }, { cwd: proj });
    expect(out.toLowerCase()).not.toContain('ambiguous'); // exact-name match wins
  });
});
