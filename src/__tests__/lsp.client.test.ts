import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LspClient } from '../lsp/client';
import { lspSpecFor, isServerAvailable } from '../lsp/registry';
import { createLspQueryTool } from '../tools/implementations/lsp.tool';
import { StaticAnalyzer } from '../graph/static.analyzer';
import { GraphStore } from '../graph/graph.store';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;
const FIXTURE = path.join(__dirname, 'fixtures', 'lsp-fake-server.js');

describe('lsp/registry (C1)', () => {
  it('maps TS/JS to typescript-language-server and Python to pyright', () => {
    expect(lspSpecFor('a.ts')?.command).toBe('typescript-language-server');
    expect(lspSpecFor('a.py')?.command).toBe('pyright-langserver');
    expect(lspSpecFor('a.txt')).toBeNull();
  });
});

describe('LspClient against a fake server (C1)', () => {
  let dir: string;
  let client: LspClient;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-lsp-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'const x: number = "oops";\n');
    client = new LspClient({ command: 'node', args: [FIXTURE] }, dir);
  });
  afterEach(() => { client.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('receives published diagnostics after opening a document', async () => {
    const diags = await client.diagnose(path.join(dir, 'a.ts'), 6000);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toMatch(/fixture diagnostic/);
  }, 15000);

  it('returns reference locations', async () => {
    const refs = await client.references(path.join(dir, 'a.ts'), 0, 6, 6000);
    expect(refs.length).toBe(2);
    expect(refs[0].line).toBe(5);
  }, 15000);
});

describe('LspQueryTool graceful degradation (C1)', () => {
  let dir: string;
  let store: GraphStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-lsptool-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'CommonJS' }, include: ['*.ts'] }));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function foo(): void {}\n');
    store = new GraphStore(':memory:');
    new StaticAnalyzer(dir, store).analyzeProject();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reports clearly when the language server is not installed', async () => {
    const tool = createLspQueryTool(governor, store);
    const res = await tool.execute({ query: 'DIAGNOSTICS a.ts' }, { cwd: dir });
    // typescript-language-server isn't installed in CI/dev here → graceful message;
    // if it *is* installed, we instead get a diagnostics summary. Accept either.
    const installed = isServerAvailable(lspSpecFor('a.ts')!);
    if (installed) {
      expect(res).toMatch(/diagnostic|No diagnostics/);
    } else {
      expect(res).toMatch(/not installed/);
    }
  });

  it('rejects an unknown verb', async () => {
    const tool = createLspQueryTool(governor, store);
    expect(await tool.execute({ query: 'FROBNICATE x' }, { cwd: dir })).toMatch(/Usage:/);
  });
});
