// Visual smoke-test for the renderer without Electron: serve out/renderer over localhost
// (file:// blanks on crossorigin module CORS), stub the preload bridge, feed fake protocol
// events, drive the shell (dock tabs, ⌘K palette), and screenshot each state.
// Usage: node app/scripts/screenshot-ui.mjs → app/release/ui-{transcript,agents,mind,palette,modal}.png
import puppeteer from 'puppeteer';
import path from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(appDir, 'release');
mkdirSync(outDir, { recursive: true });

const root = path.join(appDir, 'out/renderer');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const p = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    res.setHeader('Content-Type', mime[path.extname(p)] || 'application/octet-stream');
    res.end(readFileSync(p));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 860, deviceScaleFactor: 2 });

await page.evaluateOnNewDocument(() => {
  window.__cbs = { msg: [], state: [], project: [] };
  const FAKE_COMMANDS = [
    { value: '/beast', label: '/beast', desc: 'Mega-pipeline: swarm → heal → self-critic → checkpoint', kind: 'command' },
    { value: '/swarm', label: '/swarm', desc: 'Parallel sub-agents on a shared blackboard', kind: 'command' },
    { value: '/mode', label: '/mode', desc: 'Switch agent mode (general/explore/sketch/code/beast)', kind: 'command' },
    { value: '/model', label: '/model', desc: 'Pick model + tier; key-pool health', kind: 'command' },
    { value: '/index', label: '/index', desc: 'Build the AST codebase map', kind: 'command' },
    { value: '/ledger', label: '/ledger', desc: 'Hash-chained event ledger', kind: 'command' },
  ];
  const FAKE_CONFIG = {
    model: 'stepfun-ai/step-3.7-flash', liteModel: 'stepfun-ai/step-3.7-flash', fallbackModel: '', subagentModel: '',
    temperature: 0.7, topP: 0.95, maxTokens: 4096, reasoningEffort: 'high', contextMode: 'smart',
    contextWindowTokens: 128000, parallelToolCalls: true, maxToolIterations: 50, maxSubAgents: 5,
    notificationBell: true, verbose: false, reducedMotion: false, autoIndex: true,
    gitAutoCommit: false, autoVerify: true, sandboxBash: false, selfCritic: true,
    adversarialVerify: false, diffApproval: true, blastGate: false, showMapPanel: true, showTokenMeter: true,
  };
  window.bimax = {
    send: (m) => {
      if (m && m.t === 'query') {
        setTimeout(() => {
          const q = (m.text || '').toLowerCase();
          const items = FAKE_COMMANDS.filter((c) => c.value.startsWith(q) || q === '/');
          window.__cbs.msg.forEach((cb) => cb({ t: 'queryResult', id: m.id, items }));
        }, 30);
      }
      if (m && m.t === 'configGet') {
        setTimeout(() => window.__cbs.msg.forEach((cb) => cb({ t: 'configResult', id: m.id, config: FAKE_CONFIG })), 30);
      }
      if (m && m.t === 'configSet') {
        Object.assign(FAKE_CONFIG, m.patch || {});
        setTimeout(() => window.__cbs.msg.forEach((cb) => cb({ t: 'configResult', id: m.id, config: FAKE_CONFIG })), 30);
      }
    },
    onMessage: (cb) => { window.__cbs.msg.push(cb); return () => {}; },
    onEngineState: (cb) => { window.__cbs.state.push(cb); return () => {}; },
    onProject: (cb) => { window.__cbs.project.push(cb); return () => {}; },
    pickFolder: async () => null,
    restartEngine: async () => '',
    getProject: async () => '/Users/dev/projects/bimax',
    rendererReady: () => {},
    git: {
      status: async () => ({
        branch: 'feat/retry-backoff', ahead: 2, behind: 0,
        files: [
          { path: 'src/api/client.ts', status: 'M', staged: true, insertions: 14, deletions: 3 },
          { path: 'src/api/retry.ts', status: '?', staged: false, insertions: 0, deletions: 0 },
          { path: 'src/sync/pull.ts', status: 'M', staged: false, insertions: 6, deletions: 2 },
          { path: 'src/legacy/poll.ts', status: 'D', staged: true, insertions: 0, deletions: 41 },
        ],
      }),
      diff: async () => [
        'diff --git a/src/api/client.ts b/src/api/client.ts',
        'index 3f1c2aa..9e4d7b1 100644',
        '--- a/src/api/client.ts',
        '+++ b/src/api/client.ts',
        '@@ -10,9 +10,11 @@ export class ApiClient {',
        '   async get(url: string): Promise<Response> {',
        '-    const res = await fetch(url);',
        '+    const res = await retry(3, () => fetch(url));',
        '     if (!res.ok) throw new ApiError(res);',
        '     return res;',
        '   }',
        '@@ -31,4 +33,12 @@ export class ApiClient {',
        '+  // exponential backoff: 250ms → 500ms → 1s',
        '+  private backoff(attempt: number): number {',
        '+    return 2 ** attempt * 250;',
        '+  }',
        ' }',
      ].join('\n'),
      branches: async () => ({ current: 'feat/retry-backoff', all: ['main', 'feat/retry-backoff', 'fix/pty-resize'] }),
      log: async () => [
        { hash: '3055c4f', subject: 'feat(tui): /keys pool health', when: '2 hours ago' },
        { hash: '4832d1f', subject: 'feat(core): capability-driven request shaping', when: '5 hours ago' },
        { hash: '3243d50', subject: 'feat(context): cache-tiered prompt architecture', when: 'yesterday' },
      ],
    },
    files: {
      list: async (rel) => (rel === ''
        ? [
          { name: 'src', dir: true }, { name: 'tui', dir: true }, { name: 'docs', dir: true },
          { name: 'package.json', dir: false }, { name: 'README.md', dir: false },
        ]
        : rel === 'src'
          ? [{ name: 'api', dir: true }, { name: 'index.ts', dir: false }, { name: 'protocol.ts', dir: false }]
          : [{ name: 'client.ts', dir: false }, { name: 'retry.ts', dir: false }]),
      read: async () => ({
        content: [
          "import { sleep } from './util';",
          '',
          '/** Exponential backoff: 250ms → 500ms → 1s, then rethrow. */',
          'export async function retry<T>(n: number, fn: () => Promise<T>): Promise<T> {',
          '  for (let i = 0; ; i++) {',
          '    try { return await fn(); }',
          '    catch (e) {',
          '      if (i >= n) throw e;',
          '      await sleep(2 ** i * 250);',
          '    }',
          '  }',
          '}',
          '',
          'export const DEFAULT_ATTEMPTS = 3;',
          '',
        ].join('\n'),
        truncated: false, size: 214, binary: false,
      }),
      reveal: async () => {},
      write: async () => {},
      onChanged: () => () => {},
    },
    sessionsMeta: async () => {
      const out = [];
      const titles = [
        'Add retry with backoff to the fetch client', 'Fix pty resize race in terminal panel',
        'Wire word-level diffs into Review', 'Cache-tiered prompt architecture',
        'Sub-agent worktree isolation', 'MCP self-healing layer', 'Beast pipeline on the billing repo',
        'Blueprint compiler artifacts', 'Ledger attribution weights', 'Dream-mode curriculum tuning',
      ];
      for (let i = 0; i < 64; i++) {
        const daysAgo = Math.floor(i * 1.7 + (i % 3));
        out.push({
          id: `2026-0${(i % 6) + 1}-1${i % 9}_10-0${i % 6}-00`,
          title: titles[i % titles.length],
          cwd: '/Users/dev/projects/bimax',
          startedAt: new Date(Date.now() - daysAgo * 86400e3 - (i % 12) * 3600e3).toISOString(),
          messageCount: 8 + ((i * 13) % 90),
          tokenEstimate: 120000 + ((i * 77773) % 700000),
        });
      }
      return out;
    },
    pty: {
      create: async () => {
        setTimeout(() => {
          const write = (s) => (window.__cbs.ptyData || []).forEach((cb) => cb(1, s));
          write('\x1b[38;5;180mdev@mac\x1b[0m \x1b[38;5;173mbimax\x1b[0m % npm test\r\n');
          write('\r\n  \x1b[32m✓\x1b[0m 605 tests passing (12.4s)\r\n\r\n');
          write('\x1b[38;5;180mdev@mac\x1b[0m \x1b[38;5;173mbimax\x1b[0m % ');
        }, 80);
        return 1;
      },
      input: () => {},
      resize: () => {},
      kill: () => {},
      onData: (cb) => { (window.__cbs.ptyData ||= []).push(cb); return () => {}; },
      onExit: () => () => {},
    },
  };
});

page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle0' });

const feed = (msg) => page.evaluate((m) => window.__cbs.msg.forEach((cb) => cb(m)), msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await feed({ t: 'ready', protocol: 3 });
await feed({ t: 'event', name: 'ui_snapshot', args: [{
  models: { coding: 'minimaxai/minimax-m3', lite: 'step-3.7-flash' },
  goalCount: 2,
  mind: {
    weakSpots: 2, driveDeviations: 1, habits: 3,
    weak: [
      { tool: 'Edit', domain: 'go', failRate: 0.31, pWeak: 0.92, n: 26, advice: 'Prefer SymbolEdit for Go receivers — plain Edit misses method bodies.' },
      { tool: 'Bash', domain: 'tests', failRate: 0.22, pWeak: 0.81, n: 41, advice: 'Run jest with --maxWorkers=2; full suite overheats the machine.' },
    ],
    drives: [
      { label: 'Type errors', value: '0 errors', ok: true, spark: [1, 1, 1, 1, 1, 1] },
      { label: 'TODO debt', value: '41 TODOs', ok: false, spark: [1, 1, 0, 0, 1, 0] },
      { label: 'Test health', value: '605 passing', ok: true, spark: [1, 1, 1, 0, 1, 1] },
    ],
    habitNames: ['build-after-edit', 'targeted-jest-only', 'graph-before-grep'],
    ledger: { resolved: 128, open: 4, expired: 9, coveragePct: 0.93, overconfident: 1 },
  },
  graph: {
    nodeCount: 48213, fileCount: 512, aiGraphBuilt: true,
    modules: [
      { name: 'src/core', criticality: 'high' },
      { name: 'src/mind', criticality: 'high' },
      { name: 'src/protocol', criticality: 'med' },
      { name: 'tui', criticality: 'med' },
    ],
    engine: 'codebase-memory',
  },
  contextWindow: 128000, tokensBaseline: 8948, compressionSaved: 12400,
  workspace: { count: 1, names: ['bimax'], writable: 1 },
  sessions: [
    { id: '2026-07-10_14-02-11', title: 'Add retry with backoff to the fetch client', startedAt: new Date(Date.now() - 40 * 60e3).toISOString(), messageCount: 12, cwd: '/Users/dev/projects/bimax', current: true },
    { id: '2026-07-10_09-31-52', title: 'Fix pty resize race in terminal panel', startedAt: new Date(Date.now() - 5 * 3600e3).toISOString(), messageCount: 34, cwd: '/Users/dev/projects/bimax', current: false },
    { id: '2026-07-09_18-20-05', title: 'Wire word-level diffs into Review', startedAt: new Date(Date.now() - 20 * 3600e3).toISOString(), messageCount: 58, cwd: '/Users/dev/projects/bimax', current: false },
    { id: '2026-07-08_11-05-40', title: 'Cache-tiered prompt architecture', startedAt: new Date(Date.now() - 2 * 86400e3).toISOString(), messageCount: 91, cwd: '/Users/dev/projects/bimax', current: false },
  ],
  checkpoints: [
    { id: 'cp-9f2', label: 'before beast run', ts: Date.now() - 8 * 60e3, auto: false },
    { id: 'cp-8a1', label: 'auto: pre-edit src/api/client.ts', ts: Date.now() - 22 * 60e3, auto: true },
    { id: 'cp-77c', label: 'green baseline', ts: Date.now() - 3 * 3600e3, auto: false },
  ],
  git: { branch: 'feat/retry-backoff', dirty: 4, ahead: 2, behind: 0 },
}] });

// Home dashboard — transcript still empty, so the greeting + stats + heatmap render.
await sleep(500);
await page.screenshot({ path: path.join(outDir, 'ui-home.png') });

// Sessions gallery via the sidebar's "view all".
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.title === 'Browse all sessions')?.click();
});
await sleep(450);
await page.screenshot({ path: path.join(outDir, 'ui-gallery.png') });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.title === 'Back to chat')?.click();
});
await sleep(250);

await feed({ t: 'event', name: 'message', args: [{
  id: 'u1', role: 'user', content: 'Add retry with backoff to the fetch client', timestamp: new Date().toISOString(),
}] });
await feed({ t: 'event', name: 'tool_call', args: [{
  id: 't1', toolName: 'GraphQuery', input: 'callers of fetchJson', output: '3 call sites: api/client.ts, sync/pull.ts, auth/session.ts',
  status: 'success', startTime: new Date().toISOString(),
}] });
await feed({ t: 'event', name: 'tool_call', args: [{
  id: 't2', toolName: 'Edit', input: 'src/api/client.ts — wrap fetchJson in retry(3, expBackoff)', output: '',
  status: 'running', startTime: new Date().toISOString(), parentId: 'agent-1', agentLabel: 'coder',
}] });
await feed({ t: 'event', name: 'thinking', args: ['The three call sites share a fetch wrapper, so one retry helper in api/retry.ts covers them all. Exponential backoff starting at 250ms, capped at 3 attempts, keeps worst-case latency under 2s.'] });
// A run of consecutive edits → should fold into one "Edited N files" activity chip.
for (const [i, f] of ['src/api/retry.ts', 'src/api/client.ts', 'src/sync/pull.ts'].entries()) {
  await feed({ t: 'event', name: 'tool_call', args: [{
    id: `e${i}`, toolName: 'Edit', input: `${f} — wire retry()`, output: 'ok',
    status: 'success', startTime: new Date(Date.now() - 5000).toISOString(), endTime: new Date().toISOString(),
  }] });
}
await feed({ t: 'event', name: 'message', args: [{
  id: 'a1', role: 'assistant', thoughtMs: 3400,
  content: 'I found **3 call sites** of `fetchJson`. Added a shared retry helper:\n```ts\nexport async function retry<T>(n: number, fn: () => Promise<T>): Promise<T> {\n  for (let i = 0; ; i++) {\n    try { return await fn(); }\n    catch (e) { if (i >= n) throw e; await sleep(2 ** i * 250); }\n  }\n}\n```\n### What changed\n| File | Change |\n|---|---|\n| `api/retry.ts` | new helper |\n| `api/client.ts` | wraps `fetchJson` |\n| `sync/pull.ts` | wraps `pullOnce` |\n\n- backoff: 250ms → 500ms → 1s\n- errors rethrown after attempt 3\n\nRunning the related tests next.',
  timestamp: new Date().toISOString(),
}] });
await feed({ t: 'event', name: 'message', args: [{
  id: 'd1', role: 'system', uiComponent: 'StatsDashboard', content: '',
  payload: { title: 'Session cost', items: [
    { label: 'Streamed tokens', value: '18,204' },
    { label: 'Tool calls', value: '23' },
    { label: 'Compression saved', value: '12,400 tokens' },
  ] },
  timestamp: new Date().toISOString(),
}] });
await feed({ t: 'event', name: 'spinner_state', args: ['tool', 'editing src/api/client.ts'] });
await feed({ t: 'event', name: 'todo_update', args: [[
  { content: 'Locate fetch call sites', status: 'completed' },
  { content: 'Add retry helper', status: 'in_progress' },
  { content: 'Wire into client', status: 'pending' },
]] });
await feed({ t: 'event', name: 'subagent_update', args: [[
  { taskId: 'sa-1', agentType: 'coder', scope: 'src/api/**', prompt: 'Wrap fetchJson call sites in retry()', status: 'running', startedAt: Date.now() - 42000, toolCalls: 7 },
  { taskId: 'sa-2', agentType: 'tester', scope: 'src/__tests__/**', prompt: 'Add retry/backoff unit tests', status: 'done', startedAt: Date.now() - 90000, endedAt: Date.now() - 8000, toolCalls: 12, result: '4 tests added, all green' },
]] });

await sleep(400);
await page.screenshot({ path: path.join(outDir, 'ui-transcript.png') });

// Composer selectors: open the permission preset dropdown.
await page.evaluate(() => {
  const spans = [...document.querySelectorAll('button span')];
  spans.find((s) => s.textContent.includes('Approve for me'))?.closest('button')?.click();
});
await sleep(250);
await page.screenshot({ path: path.join(outDir, 'ui-composer.png') });
await page.keyboard.press('Escape');
await sleep(150);

// Dock: Agents tab (⌘J opens, default tab agents)
await page.keyboard.down('Meta');
await page.keyboard.press('j');
await page.keyboard.up('Meta');
await sleep(300);
await page.screenshot({ path: path.join(outDir, 'ui-agents.png') });

// Mind tab
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.textContent.trim() === 'Mind')?.click();
});
await sleep(300);
await page.screenshot({ path: path.join(outDir, 'ui-mind.png') });

// Review tab (P3): changed-file list + branch pill, then a file's word-level diff.
const clickTab = (label) => page.evaluate((l) => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.textContent.trim() === l)?.click();
}, label);
await clickTab('Review');
await sleep(350);
await page.screenshot({ path: path.join(outDir, 'ui-review.png') });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.title === 'src/api/client.ts')?.click();
});
await sleep(350);
await page.screenshot({ path: path.join(outDir, 'ui-diff.png') });

// Files tab: tree expanded one level.
await clickTab('Files');
await sleep(300);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[role="button"], button')];
  rows.find((b) => b.getAttribute('title') === 'src')?.click();
});
await sleep(250);
await page.screenshot({ path: path.join(outDir, 'ui-files.png') });

// IDE editor pane: open a file from the tree — CodeMirror takes over the right side.
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[role="button"]')];
  rows.find((b) => (b.getAttribute('title') || '').startsWith('src/index.ts'))?.click();
});
await sleep(600);
await page.screenshot({ path: path.join(outDir, 'ui-editor.png') });
// Back to panels so the remaining dock shots see tabs again.
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => (b.title || '').startsWith('Back to panels'))?.click();
});
await sleep(300);

// Terminal tab (P3): xterm with fake session output.
await clickTab('Terminal');
await sleep(500);
await page.screenshot({ path: path.join(outDir, 'ui-terminal.png') });

// Agents tab (P4): swarm launcher form open over the live cards.
await clickTab('Agents');
await sleep(200);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.textContent.trim() === 'Swarm')?.click();
});
await sleep(250);
await page.screenshot({ path: path.join(outDir, 'ui-agents-launch.png') });
await page.keyboard.press('Escape');

// Map tab (P4): graph stats + index actions + impact query.
await clickTab('Map');
await sleep(250);
await page.screenshot({ path: path.join(outDir, 'ui-map.png') });

// Settings dialog (P6): grouped engine-menu entry points.
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.title === 'Settings')?.click();
});
await sleep(350);
await page.screenshot({ path: path.join(outDir, 'ui-settings.png') });
await page.keyboard.press('Escape');
await sleep(200);

// ⌘K palette
await page.keyboard.down('Meta');
await page.keyboard.press('k');
await page.keyboard.up('Meta');
await sleep(350);
await page.screenshot({ path: path.join(outDir, 'ui-palette.png') });
await page.keyboard.press('Escape');
await sleep(200);

// Approval modal on top of the shell
await feed({ t: 'request', id: 7, kind: 'diff', question: 'Apply this edit to src/api/client.ts?',
  options: ['Approve', 'Reject', 'Always allow edits'],
  body: '@@ -12,6 +12,9 @@\n-  const res = await fetch(url);\n+  const res = await retry(3, () => fetch(url));\n+  // exponential backoff: 250ms, 500ms, 1s\n   if (!res.ok) throw new ApiError(res);' });
await sleep(350);
await page.screenshot({ path: path.join(outDir, 'ui-modal.png') });

await browser.close();
server.close();
console.log('screenshots:', ['ui-home', 'ui-gallery', 'ui-transcript', 'ui-agents', 'ui-agents-launch', 'ui-map', 'ui-mind', 'ui-review', 'ui-diff', 'ui-files', 'ui-editor', 'ui-terminal', 'ui-settings', 'ui-palette', 'ui-modal'].map((n) => `release/${n}.png`).join(', '));
