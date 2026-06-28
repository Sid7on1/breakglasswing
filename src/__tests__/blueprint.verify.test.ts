import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { autoConnectBrowser, agentVerifyChecklist, McpConnector } from '../tools/implementations/blueprint.tool';
import { BlueprintEngine } from '../blueprints/blueprint.engine';
import { IGovernor } from '../core/interfaces';

const governor = {} as IGovernor;

describe('autoConnectBrowser (website Verify)', () => {
  it('returns the existing browser tool without connecting anything', async () => {
    const registry = { getToolNames: () => ['EditFileTool', 'mcp__playwright__browser_navigate'] };
    const manager: McpConnector = {
      addToConfig: jest.fn(),
      connectSpec: jest.fn(),
      lastError: null,
    };
    const r = await autoConnectBrowser(registry, governor, manager);
    expect(r.connected).toBe(true);
    expect(r.tool).toBe('mcp__playwright__browser_navigate');
    expect(r.added).toBeUndefined();
    expect(manager.addToConfig).not.toHaveBeenCalled();
    expect(manager.connectSpec).not.toHaveBeenCalled();
  });

  it('auto-connects Playwright from the catalog when none is wired', async () => {
    const names = ['EditFileTool'];
    const manager: McpConnector = {
      addToConfig: jest.fn(),
      connectSpec: jest.fn(async () => {
        names.push('mcp__playwright__browser_navigate', 'mcp__playwright__browser_take_screenshot');
        return { name: 'playwright', toolNames: ['mcp__playwright__browser_navigate', 'mcp__playwright__browser_take_screenshot'] };
      }),
      lastError: null,
    };
    const registry = { getToolNames: () => names };
    const r = await autoConnectBrowser(registry, governor, manager);
    expect(r.connected).toBe(true);
    expect(r.tool).toMatch(/playwright/);
    expect(r.added).toHaveLength(2);
    // It added the catalog's playwright command and connected it.
    expect(manager.addToConfig).toHaveBeenCalledWith(expect.objectContaining({ name: 'playwright', command: 'npx' }));
    expect(manager.connectSpec).toHaveBeenCalled();
  });

  it('reports the connect error when Playwright fails to start', async () => {
    const manager: McpConnector = {
      addToConfig: jest.fn(),
      connectSpec: jest.fn(async () => null),
      lastError: 'npx exited before connecting',
    };
    const registry = { getToolNames: () => ['EditFileTool'] };
    const r = await autoConnectBrowser(registry, governor, manager);
    expect(r.connected).toBe(false);
    expect(r.error).toMatch(/exited before connecting/);
  });
});

describe('agentVerifyChecklist (agent Verify)', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmx-agentv-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('flags a required browser MCP as ✗ when none is connected', () => {
    const eng = new BlueprintEngine(root);
    const bp = eng.create('an agent that drives web pages', 'agent');
    eng.select(bp.slug, 'tools', 'browser');
    const out = agentVerifyChecklist(eng.load(bp.slug)!, ['EditFileTool', 'ReadFileTool']);
    expect(out).toMatch(/\[✗\] Tools\/MCP/);
    expect(out).toMatch(/NOT connected/);
    expect(out).toMatch(/Resolve the ✗/);
  });

  it('marks the browser MCP ✓ when it is connected', () => {
    const eng = new BlueprintEngine(root);
    const bp = eng.create('an agent that drives web pages', 'agent');
    eng.select(bp.slug, 'tools', 'browser');
    const out = agentVerifyChecklist(eng.load(bp.slug)!, ['mcp__playwright__browser_navigate']);
    expect(out).toMatch(/\[✓\] Tools\/MCP/);
    expect(out).not.toMatch(/Resolve the ✗/);
  });

  it('lists every wiring concern as a checklist item', () => {
    const eng = new BlueprintEngine(root);
    const bp = eng.create('a research agent', 'agent');
    const out = agentVerifyChecklist(eng.load(bp.slug)!, []);
    for (const k of ['Model:', 'Tools/MCP:', 'Memory:', 'Orchestration:', 'Guardrails:', 'Eval:']) {
      expect(out).toContain(k);
    }
  });
});
