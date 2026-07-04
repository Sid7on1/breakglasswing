import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { globalProjectMemory } from '../memory/project.memory';
import { mindSingletonRoot } from './self.model';

/**
 * DogfoodEngine — embodied verification. The agent USES the software it builds,
 * as a user persona, instead of stopping at "tests pass":
 *
 *   - TUI probe   — launches the built Go TUI inside a real PTY (via macOS/BSD
 *                   `script`), lets it render, quits, and inspects the captured
 *                   frames for panics / empty screens / error spew.
 *   - CLI probe   — runs the built CLI's --help/--version as a first-time user
 *                   would and checks it responds sanely.
 *   - Site probe  — loads the built site in headless Chrome (system Chrome — the
 *                   bundled Chromium crashes under Rosetta) and captures console
 *                   errors + a screenshot.
 *
 * Each failed probe becomes a STRUCTURED BUG REPORT in .bimax/dogfood/, plus a
 * project-memory gotcha, so the finding feeds back into the agent's work queue.
 * Probes run strictly sequentially with hard timeouts.
 */

export interface ProbeResult {
  id: string;
  persona: string;
  ran: boolean;
  passed?: boolean;
  summary: string;
  evidence?: string;
}

type Log = (level: 'info' | 'success' | 'error', msg: string) => void;

function sh(cmd: string, cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.trim() });
    });
  });
}

export class DogfoodEngine {
  private outDir: string;

  constructor(private projectRoot: string = process.cwd()) {
    this.outDir = path.join(projectRoot, '.bimax', 'dogfood');
  }

  private has(p: string): boolean {
    try { return fs.existsSync(path.join(this.projectRoot, p)); } catch { return false; }
  }

  /**
   * Launch a terminal app in a REAL pty via `script`, feed it quit keys after a
   * render window, and return everything it drew. Works without a node-pty dep.
   */
  private probeTuiBinary(binRel: string): Promise<ProbeResult> {
    const persona = 'first-time user opening the TUI';
    return new Promise(resolve => {
      const bin = path.join(this.projectRoot, binRel);
      // `script` gives the app a real pty without a node-pty dep — but its CLI differs:
      // BSD/macOS: script -q /dev/null <cmd>   ·   util-linux: script -q -c "<cmd>" /dev/null
      const scriptArgs = process.platform === 'darwin'
        ? ['-q', '/dev/null', bin]
        : ['-q', '-c', bin, '/dev/null'];
      const child = spawn('script', scriptArgs, {
        cwd: path.dirname(bin),
        env: { ...process.env, TERM: 'xterm-256color', COLUMNS: '120', LINES: '35' },
      });
      let out = '';
      let settled = false;
      const finish = (passed: boolean, summary: string) => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
        resolve({ id: 'tui-smoke', persona, ran: true, passed, summary, evidence: out.slice(-1500) });
      };
      child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
      child.stderr?.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
      child.on('error', (e) => finish(false, `could not launch: ${e.message}`));
      // Let it boot + render, then quit like a user would (Ctrl+C twice covers confirm prompts).
      setTimeout(() => { try { child.stdin?.write('\x03'); } catch { /* closed */ } }, 6000);
      setTimeout(() => { try { child.stdin?.write('\x03'); } catch { /* closed */ } }, 6800);
      const deadline = setTimeout(() => finish(
        out.length > 200 && !/panic:|fatal error:/i.test(out),
        out.length > 200 ? 'rendered, but had to be killed (quit did not exit it)' : 'no meaningful render before timeout'
      ), 15000);
      deadline.unref?.();
      child.on('exit', () => {
        const panicked = /panic:|fatal error:/i.test(out);
        const rendered = out.length > 200; // a real TUI frame is far bigger than an error line
        if (panicked) finish(false, 'TUI panicked on launch');
        else if (!rendered) finish(false, 'TUI exited without rendering a frame');
        else finish(true, 'TUI launched, rendered, and quit cleanly');
      });
    });
  }

  /** CLI probe: does the built binary answer --help like a sane tool? */
  private async probeCli(): Promise<ProbeResult | null> {
    const persona = 'new user running --help';
    const entry = this.has('dist/index.js') ? 'node dist/index.js --help'
      : this.has('package.json') && !!this.pkg()?.bin ? 'npx --no-install . --help'
      : null;
    if (!entry) return null;
    const { code, out } = await sh(entry, this.projectRoot, 30_000);
    const passed = code === 0 && out.length > 40 && !/error|exception|traceback/i.test(out.slice(0, 200));
    return { id: 'cli-help', persona, ran: true, passed, summary: passed ? '--help responds with usage' : `--help failed (exit ${code})`, evidence: out.slice(0, 800) };
  }

  private pkg(): any {
    try { return JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf-8')); } catch { return null; }
  }

  /** Site probe: load the built site in headless system Chrome, collect console errors. */
  private async probeSite(): Promise<ProbeResult | null> {
    const persona = 'visitor loading the landing page';
    const distIndex = ['site/dist/index.html', 'dist/index.html', 'build/index.html']
      .find(p => this.has(p));
    if (!distIndex) return null;
    try {
      const puppeteer = await import('puppeteer');
      const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome']
        .find(p => { try { return fs.existsSync(p); } catch { return false; } });
      const browser = await puppeteer.launch({
        headless: true,
        ...(chrome ? { executablePath: chrome } : {}),
        args: ['--no-sandbox', '--disable-gpu'],
      });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e: any) => errors.push(String(e?.message || e)));
        await page.goto(`file://${path.join(this.projectRoot, distIndex)}`, { waitUntil: 'networkidle0', timeout: 45_000 });
        await new Promise(r => setTimeout(r, 2500)); // let animations/3D mount
        fs.mkdirSync(this.outDir, { recursive: true });
        const shot = path.join(this.outDir, `site-${Date.now()}.png`);
        await page.screenshot({ path: shot as `${string}.png` });
        const bodyText = await page.evaluate(() => document.body?.innerText?.length || 0);
        const passed = errors.length === 0 && bodyText > 50;
        return {
          id: 'site-load', persona, ran: true, passed,
          summary: passed ? `page loads clean (screenshot: ${path.relative(this.projectRoot, shot)})`
            : errors.length ? `${errors.length} console error(s) on load` : 'page rendered no visible content',
          evidence: errors.slice(0, 5).join('\n') || undefined,
        };
      } finally {
        await browser.close();
      }
    } catch (e: any) {
      return { id: 'site-load', persona, ran: false, summary: `browser unavailable: ${e?.message}` };
    }
  }

  /** Which probes apply here — used by /dogfood to explain itself before running. */
  applicableProbes(): string[] {
    const probes: string[] = [];
    if (this.has('tui/bimax-tui')) probes.push('tui-smoke');
    if (this.has('dist/index.js') || !!this.pkg()?.bin) probes.push('cli-help');
    if (['site/dist/index.html', 'dist/index.html', 'build/index.html'].some(p => this.has(p))) probes.push('site-load');
    return probes;
  }

  /** Run every applicable probe sequentially; write bug reports for failures. */
  async run(log: Log = () => {}): Promise<{ results: ProbeResult[]; reportPath?: string }> {
    const results: ProbeResult[] = [];

    if (this.has('tui/bimax-tui') && process.platform !== 'win32') {
      log('info', 'Dogfood: opening the TUI as a first-time user…');
      results.push(await this.probeTuiBinary('tui/bimax-tui'));
    }
    const cli = await this.probeCli();
    if (cli) { log('info', 'Dogfood: running --help as a new user…'); results.push(cli); }
    const site = await this.probeSite();
    if (site) { log('info', 'Dogfood: loading the site as a visitor…'); results.push(site); }

    // Failures become durable, structured bug reports the agent can pick up as work.
    const failures = results.filter(r => r.ran && r.passed === false);
    let reportPath: string | undefined;
    if (failures.length > 0) {
      try {
        fs.mkdirSync(this.outDir, { recursive: true });
        reportPath = path.join(this.outDir, `bugs-${Date.now()}.md`);
        const lines = [
          `# Dogfood bug report — ${new Date().toISOString()}`,
          '',
          ...failures.flatMap(f => [
            `## ${f.id}`,
            `- Persona: ${f.persona}`,
            `- Finding: ${f.summary}`,
            f.evidence ? `- Evidence:\n\`\`\`\n${f.evidence}\n\`\`\`` : '',
            '',
          ]),
        ];
        fs.writeFileSync(reportPath, lines.filter(Boolean).join('\n'), 'utf-8');
        for (const f of failures) {
          try {
            await globalProjectMemory.remember(
              `Dogfooding found: ${f.id} — ${f.summary} (see ${path.relative(this.projectRoot, reportPath)})`,
              'gotcha', ['dogfood']
            );
          } catch { /* best-effort */ }
        }
      } catch { /* reporting is best-effort */ }
    }
    return { results, reportPath };
  }
}

let _global: DogfoodEngine | null = null;
export function getDogfoodEngine(): DogfoodEngine {
  if (!_global) _global = new DogfoodEngine(mindSingletonRoot());
  return _global;
}
export function __setDogfoodEngine(e: DogfoodEngine | null): void { _global = e; }
