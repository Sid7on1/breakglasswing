import { StaticAnalyzer } from '../graph/static.analyzer';
import { GraphStore } from '../graph/graph.store';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// G1: the analyzer must record 1-based, inclusive line ranges + a signature on each
// symbol node, so the agent can read just that symbol instead of the whole file.
describe('StaticAnalyzer — symbol line ranges (G1)', () => {
  let proj: string;
  let store: GraphStore;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-graph-'));
    fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'CommonJS', strict: false },
      include: ['*.ts'],
    }));
    // Line 1 is blank so the function does not start at line 1 — proves 1-based offset.
    const src = [
      '',                                            // 1
      'export function greet(name: string): string {', // 2
      '  return `hi ${name}`;',                       // 3
      '}',                                            // 4
      '',                                             // 5
      'export class Widget {',                        // 6
      '  render(): void {',                           // 7
      '    /* draw */',                               // 8
      '  }',                                          // 9
      '}',                                            // 10
    ].join('\n');
    fs.writeFileSync(path.join(proj, 'sample.ts'), src);

    store = new GraphStore(':memory:');
    new StaticAnalyzer(proj, store).analyzeProject();
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('records the line range and signature of a top-level function', () => {
    const fn = store.getNode('func:sample.ts:greet');
    expect(fn).toBeDefined();
    expect(fn!.startLine).toBe(2);
    expect(fn!.endLine).toBe(4);
    expect(fn!.signature).toBe('export function greet(name: string): string {');
  });

  it('records the line range of a class and its method', () => {
    const cls = store.getNode('class:sample.ts:Widget');
    expect(cls).toBeDefined();
    expect(cls!.startLine).toBe(6);
    expect(cls!.endLine).toBe(10);

    const method = store.getNode('func:sample.ts:Widget.render');
    expect(method).toBeDefined();
    expect(method!.startLine).toBe(7);
    expect(method!.endLine).toBe(9);
  });
});
