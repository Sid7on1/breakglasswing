import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Browser, Page } from 'puppeteer';

export type BrowserWaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';

export interface BrowserAssertion {
  selector?: string;
  exists?: boolean;
  textIncludes?: string;
  urlIncludes?: string;
  titleIncludes?: string;
  noConsoleErrors?: boolean;
  noFailedRequests?: boolean;
  statusBelow?: number;
}

export interface BrowserCommand {
  action: 'navigate' | 'click' | 'type' | 'scroll' | 'wait' | 'inspect' | 'screenshot' | 'compare'
    | 'assert' | 'viewport' | 'upload' | 'back' | 'reload' | 'status' | 'close';
  url?: string;
  selector?: string;
  text?: string;
  path?: string;
  baseline?: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
  pixels?: number;
  timeout?: number;
  retries?: number;
  waitUntil?: BrowserWaitUntil;
  clear?: boolean;
  allowPrivate?: boolean;
  assertion?: BrowserAssertion;
}

export interface BrowserCommandResult {
  ok: boolean;
  action: BrowserCommand['action'];
  url?: string;
  title?: string;
  status?: number;
  summary: string;
  data?: unknown;
  screenshot?: string;
  consoleErrors: string[];
  failedRequests: string[];
  attempts: number;
  durationMs: number;
}

export interface BrowserRuntimePort {
  run(command: BrowserCommand, context?: { cwd?: string; signal?: AbortSignal }): Promise<BrowserCommandResult>;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_DIAGNOSTICS = 100;

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function validateBrowserUrl(raw: string, allowPrivate = false): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(raw); }
  catch { return { ok: false, reason: `Invalid URL: ${raw}` }; }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, reason: `Only http/https browser URLs are allowed (got ${url.protocol})` };
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1' || /^127\./.test(host);
  const privateHost = /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host) || host.endsWith('.local') || host.endsWith('.internal');
  // Localhost is a first-class target for UI verification. Other private-network targets require
  // an explicit per-call acknowledgement so a webpage cannot silently turn the browser into SSRF.
  if (privateHost && !loopback && !allowPrivate) {
    return { ok: false, reason: `Private-network host requires allowPrivate=true: ${host}` };
  }
  return { ok: true, url };
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'page';
}

export function findBrowserExecutable(): string | undefined {
  const configured = process.env.BIMAX_BROWSER_EXECUTABLE || process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  const candidates = [
    configured,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
  ].filter((value): value is string => !!value);
  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Browser action interrupted.');
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); cleanup(); reject(new Error('Browser action interrupted.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * One persistent browser profile per project. Cookies, local storage, downloads, and Chromium
 * session data survive CLI restarts through userDataDir; lightweight navigation metadata is also
 * checkpointed so recovery can explain where the previous run stopped.
 */
export class BrowserRuntime implements BrowserRuntimePort {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private consoleErrors: string[] = [];
  private failedRequests: string[] = [];
  private lastStatus?: number;
  private projectRoot = '';

  private roots(cwd: string) {
    const root = path.resolve(cwd);
    return {
      root,
      profile: path.join(root, '.bimax', 'browser', 'profile'),
      state: path.join(root, '.bimax', 'browser', 'state.json'),
      evidence: path.join(root, '.bimax', 'evidence', 'browser'),
    };
  }

  private checkpoint(cwd: string): void {
    if (!this.page) return;
    const roots = this.roots(cwd);
    try {
      fs.mkdirSync(path.dirname(roots.state), { recursive: true });
      fs.writeFileSync(roots.state, JSON.stringify({
        version: 1,
        url: this.page.url(),
        lastStatus: this.lastStatus,
        consoleErrors: this.consoleErrors.slice(-20),
        failedRequests: this.failedRequests.slice(-20),
        updatedAt: Date.now(),
      }, null, 2));
    } catch { /* browser evidence must never crash the turn */ }
  }

  private async ensure(cwd: string): Promise<Page> {
    const roots = this.roots(cwd);
    if (this.page && this.projectRoot === roots.root && !this.page.isClosed()) return this.page;
    if (this.browser) await this.close();
    fs.mkdirSync(roots.profile, { recursive: true });
    fs.mkdirSync(roots.evidence, { recursive: true });
    const puppeteer = await import('puppeteer');
    const args = process.env.BIMAX_BROWSER_NO_SANDBOX === '1'
      ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
    const executablePath = findBrowserExecutable();
    this.browser = await puppeteer.launch({
      headless: process.env.BIMAX_BROWSER_HEADFUL === '1' ? false : 'new',
      userDataDir: roots.profile,
      args,
      ...(executablePath ? { executablePath } : {}),
    });
    this.projectRoot = roots.root;
    this.page = (await this.browser.pages())[0] || await this.browser.newPage();
    this.page.on('console', message => {
      if (message.type() === 'error') this.consoleErrors.push(message.text().slice(0, 2000));
      if (this.consoleErrors.length > MAX_DIAGNOSTICS) this.consoleErrors.shift();
    });
    this.page.on('pageerror', error => {
      this.consoleErrors.push(String(error).slice(0, 2000));
      if (this.consoleErrors.length > MAX_DIAGNOSTICS) this.consoleErrors.shift();
    });
    this.page.on('requestfailed', request => {
      this.failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || 'failed'}`.slice(0, 2500));
      if (this.failedRequests.length > MAX_DIAGNOSTICS) this.failedRequests.shift();
    });
    this.page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    return this.page;
  }

  private async retry<T>(attempts: number, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<{ value: T; attempts: number }> {
    let error: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try { return { value: await fn(), attempts: attempt }; }
      catch (caught) {
        error = caught;
        if (attempt === attempts || signal?.aborted) break;
        await delay(Math.min(2500, 300 * (2 ** (attempt - 1))), signal);
      }
    }
    throw error;
  }

  async run(command: BrowserCommand, context: { cwd?: string; signal?: AbortSignal } = {}): Promise<BrowserCommandResult> {
    const started = Date.now();
    const cwd = path.resolve(context.cwd || process.cwd());
    const timeout = boundedInt(command.timeout, DEFAULT_TIMEOUT_MS, 100, MAX_TIMEOUT_MS);
    const maxAttempts = boundedInt(command.retries, 2, 1, 4);
    let attempts = 1;
    const base = (ok: boolean, summary: string, data?: unknown): BrowserCommandResult => ({
      ok, action: command.action, url: this.page?.url(), status: this.lastStatus,
      summary, data, consoleErrors: this.consoleErrors.slice(-20), failedRequests: this.failedRequests.slice(-20),
      attempts, durationMs: Date.now() - started,
    });

    try {
      if (command.action === 'close') {
        await this.close();
        return base(true, 'Persistent browser closed cleanly.');
      }
      const page = await this.ensure(cwd);
      page.setDefaultTimeout(timeout);
      if (context.signal?.aborted) throw new Error('Browser action interrupted.');

      switch (command.action) {
        case 'navigate': {
          const check = validateBrowserUrl(String(command.url || ''), command.allowPrivate === true);
          if (!check.ok) return base(false, check.reason);
          const run = await this.retry(maxAttempts, context.signal, async () => {
            const result = await page.goto(check.url.toString(), { waitUntil: command.waitUntil || 'networkidle2', timeout });
            if (!result) throw new Error('Navigation returned no response.');
            return result;
          });
          const response = run.value; attempts = run.attempts; this.lastStatus = response.status();
          const title = await page.title();
          this.checkpoint(cwd);
          return { ...base(response.ok(), `Loaded ${page.url()} (${response.status()})`), title };
        }
        case 'click': {
          if (!command.selector) return base(false, 'click requires selector.');
          const run = await this.retry(maxAttempts, context.signal, async () => {
            await page.waitForSelector(command.selector!, { visible: true, timeout });
            await page.click(command.selector!);
          });
          attempts = run.attempts; this.checkpoint(cwd);
          return base(true, `Clicked ${command.selector}.`);
        }
        case 'type': {
          if (!command.selector) return base(false, 'type requires selector.');
          const run = await this.retry(maxAttempts, context.signal, async () => {
            await page.waitForSelector(command.selector!, { visible: true, timeout });
            if (command.clear !== false) {
              await page.focus(command.selector!);
              await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
              await page.keyboard.press('A');
              await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
              await page.keyboard.press('Backspace');
            }
            await page.type(command.selector!, String(command.text || ''));
          });
          attempts = run.attempts; this.checkpoint(cwd);
          return base(true, `Typed ${String(command.text || '').length} character(s) into ${command.selector}.`);
        }
        case 'scroll': {
          const pixels = boundedInt(command.pixels, 700, -20_000, 20_000);
          await page.evaluate(value => window.scrollBy(0, value), pixels);
          return base(true, `Scrolled ${pixels}px.`);
        }
        case 'wait': {
          if (command.selector) await page.waitForSelector(command.selector, { timeout });
          else await delay(timeout, context.signal);
          return base(true, command.selector ? `Found ${command.selector}.` : `Waited ${timeout}ms.`);
        }
        case 'viewport': {
          const width = boundedInt(command.width, 1440, 320, 7680);
          const height = boundedInt(command.height, 900, 240, 4320);
          await page.setViewport({ width, height, deviceScaleFactor: 1 });
          return base(true, `Viewport set to ${width}×${height}.`);
        }
        case 'upload': {
          if (!command.selector || !command.path) return base(false, 'upload requires selector and path.');
          const target = path.resolve(cwd, command.path);
          if (!within(cwd, target)) return base(false, 'Upload path must stay inside the active workspace.');
          if (!fs.statSync(target).isFile()) return base(false, `Upload file not found: ${target}`);
          const input = await page.waitForSelector(command.selector, { timeout });
          const handle = input?.asElement();
          if (!handle) return base(false, `Upload selector is not an element: ${command.selector}`);
          await (handle as any).uploadFile(target);
          return base(true, `Uploaded ${path.relative(cwd, target)} through ${command.selector}.`);
        }
        case 'back': {
          const response = await page.goBack({ waitUntil: command.waitUntil || 'networkidle2', timeout });
          this.lastStatus = response?.status(); this.checkpoint(cwd);
          return base(!!response?.ok(), `Navigated back to ${page.url()}.`);
        }
        case 'reload': {
          const response = await page.reload({ waitUntil: command.waitUntil || 'networkidle2', timeout });
          this.lastStatus = response?.status(); this.checkpoint(cwd);
          return base(!!response?.ok(), `Reloaded ${page.url()}.`);
        }
        case 'inspect': {
          const selector = command.selector || 'body';
          const data = await page.$eval(selector, element => ({
            tag: element.tagName.toLowerCase(),
            text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20_000),
            html: element.outerHTML.slice(0, 20_000),
          }));
          return { ...base(true, `Inspected ${selector}.`, data), title: await page.title() };
        }
        case 'screenshot': {
          const roots = this.roots(cwd);
          const requested = command.path ? path.resolve(cwd, command.path) : path.join(
            roots.evidence, `${Date.now()}-${safeName(await page.title())}.png`,
          );
          if (!within(cwd, requested)) return base(false, 'Screenshot path must stay inside the active workspace.');
          fs.mkdirSync(path.dirname(requested), { recursive: true });
          await page.screenshot({ path: requested, fullPage: command.fullPage !== false });
          this.checkpoint(cwd);
          return { ...base(true, `Captured screenshot ${path.relative(cwd, requested)}.`), screenshot: requested, title: await page.title() };
        }
        case 'compare': {
          if (!command.baseline) return base(false, 'compare requires a baseline path.');
          const roots = this.roots(cwd);
          const baseline = path.resolve(cwd, command.baseline);
          if (!within(cwd, baseline)) return base(false, 'Baseline path must stay inside the active workspace.');
          if (!fs.existsSync(baseline)) return base(false, `Baseline does not exist: ${path.relative(cwd, baseline)}`);
          const actual = path.join(roots.evidence, `${Date.now()}-${safeName(await page.title())}-comparison.png`);
          fs.mkdirSync(path.dirname(actual), { recursive: true });
          const bytes = Buffer.from(await page.screenshot({ path: actual, fullPage: command.fullPage !== false }));
          const expectedBytes = fs.readFileSync(baseline);
          const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
          const baselineSha256 = crypto.createHash('sha256').update(expectedBytes).digest('hex');
          const identical = bytes.equals(expectedBytes);
          this.checkpoint(cwd);
          return {
            ...base(identical, identical ? 'Screenshot exactly matches the visual baseline.' : 'Screenshot differs from the visual baseline.', {
              baseline: path.relative(cwd, baseline), actual: path.relative(cwd, actual),
              baselineSha256, actualSha256, exactMatch: identical,
            }),
            screenshot: actual,
            title: await page.title(),
          };
        }
        case 'assert': {
          const assertion = command.assertion || {};
          const checks: Array<{ check: string; ok: boolean; actual?: unknown }> = [];
          if (assertion.selector) {
            const element = await page.$(assertion.selector);
            const exists = !!element;
            checks.push({ check: `${assertion.selector} ${assertion.exists === false ? 'absent' : 'exists'}`, ok: assertion.exists === false ? !exists : exists, actual: exists });
            if (assertion.textIncludes !== undefined) {
              const text = element ? await page.$eval(assertion.selector, node => (node.textContent || '').replace(/\s+/g, ' ').trim()) : '';
              checks.push({ check: `${assertion.selector} text includes ${JSON.stringify(assertion.textIncludes)}`, ok: text.includes(assertion.textIncludes), actual: text.slice(0, 1000) });
            }
          } else if (assertion.textIncludes !== undefined) {
            const text = await page.$eval('body', node => (node.textContent || '').replace(/\s+/g, ' ').trim());
            checks.push({ check: `body text includes ${JSON.stringify(assertion.textIncludes)}`, ok: text.includes(assertion.textIncludes), actual: text.slice(0, 1000) });
          }
          if (assertion.urlIncludes !== undefined) checks.push({ check: `URL includes ${assertion.urlIncludes}`, ok: page.url().includes(assertion.urlIncludes), actual: page.url() });
          if (assertion.titleIncludes !== undefined) {
            const title = await page.title();
            checks.push({ check: `title includes ${assertion.titleIncludes}`, ok: title.includes(assertion.titleIncludes), actual: title });
          }
          if (assertion.noConsoleErrors) checks.push({ check: 'no console errors', ok: this.consoleErrors.length === 0, actual: this.consoleErrors.slice(-10) });
          if (assertion.noFailedRequests) checks.push({ check: 'no failed requests', ok: this.failedRequests.length === 0, actual: this.failedRequests.slice(-10) });
          if (assertion.statusBelow !== undefined) checks.push({ check: `status below ${assertion.statusBelow}`, ok: this.lastStatus !== undefined && this.lastStatus < assertion.statusBelow, actual: this.lastStatus });
          if (checks.length === 0) return base(false, 'assert requires at least one concrete assertion.');
          const ok = checks.every(check => check.ok);
          return { ...base(ok, `${checks.filter(check => check.ok).length}/${checks.length} browser assertion(s) passed.`, checks), title: await page.title() };
        }
        case 'status': {
          return { ...base(true, `Browser is open at ${page.url()}.`, {
            viewport: page.viewport(), stateFile: this.roots(cwd).state,
          }), title: await page.title() };
        }
      }
      return base(false, `Unsupported browser action: ${String((command as { action?: unknown }).action)}.`);
    } catch (error: any) {
      this.checkpoint(cwd);
      return base(false, error?.message || String(error));
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.page = null; this.browser = null; this.projectRoot = '';
    if (browser) await browser.close().catch(() => {});
  }
}

export const globalBrowserRuntime = new BrowserRuntime();
