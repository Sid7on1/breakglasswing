import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Browser, ElementHandle, HTTPResponse, Page } from 'puppeteer';

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
  action: 'navigate' | 'snapshot' | 'click' | 'type' | 'press' | 'select' | 'hover'
    | 'scroll' | 'wait' | 'inspect' | 'screenshot' | 'compare'
    | 'assert' | 'viewport' | 'upload' | 'back' | 'reload' | 'status' | 'close';
  url?: string;
  selector?: string;
  elementIndex?: number | string;
  text?: string;
  key?: string;
  values?: string[];
  x?: number;
  y?: number;
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
  maxElements?: number;
  /** snapshot: only index elements whose name/role/tag/value matches this substring (progressive
   * query — ask for "submit" instead of paging through 200 rows; borrowed from Pi's search_ui). */
  filter?: string;
  /** Mutating actions: how long to let the page react before the automatic fresh observation
   * (0–5000 ms, default 800). The wait ends at the FIRST DOM mutation — it never sleeps blind. */
  settleMs?: number;
  /** click: interpret x/y in the 0–1000 normalized space VLMs emit (Gemini computer-use
   * convention) and scale to the live viewport before dispatching. */
  normalized?: boolean;
  /** wait: resolve when the DOM mutates (or the timeout elapses) instead of sleeping blind —
   * change detection à la Pi's wait_for. */
  forChange?: boolean;
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
  /** URL of the live page WITHOUT launching a browser — null when no page is open. Optional so
   * lightweight test doubles only need run/close. */
  currentUrl?(): string | null;
  /** Value-safe metadata of one element from the CURRENT observation (null when the index is not
   * part of it). Lets the tool layer classify impact before acting. Optional for test doubles. */
  indexedElementInfo?(index: number | string | undefined): SnapshotElementInfo | null;
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

/** The observation-stable identity of one indexed element (tag/role/name/state, not position). */
export interface SnapshotElementInfo {
  tag: string;
  role: string;
  type?: string;
  name: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
}

/** Stable per-element signature for successor diffs. Deliberately excludes rect: scrolling or a
 * layout shift must not read as "the UI changed". */
export function elementSignature(info: SnapshotElementInfo): string {
  return [info.tag, info.role, info.type || '', info.name, info.value ?? '', info.checked ?? '', info.disabled ? 'disabled' : '']
    .join('|');
}

export interface SnapshotDiff {
  /** Sample of appeared/disappeared signatures (capped at 20 each for readability). */
  added: string[];
  removed: string[];
  /** TRUE totals — never understated by the sample caps. */
  addedCount: number;
  removedCount: number;
  changed: boolean;
}

/** Successor diff between two consecutive snapshots (Pi's compact-diff idea): what appeared and
 * what disappeared, by signature, order-insensitive. Samples are capped; counts are exact. */
export function diffSnapshots(previous: string[], next: string[]): SnapshotDiff {
  const count = (list: string[]) => {
    const m = new Map<string, number>();
    for (const s of list) m.set(s, (m.get(s) || 0) + 1);
    return m;
  };
  const prev = count(previous);
  const added: string[] = [];
  for (const sig of next) {
    const left = prev.get(sig) || 0;
    if (left > 0) prev.set(sig, left - 1);
    else added.push(sig);
  }
  const removed: string[] = [];
  for (const [sig, n] of prev) for (let i = 0; i < n; i++) removed.push(sig);
  return {
    added: added.slice(0, 20),
    removed: removed.slice(0, 20),
    addedCount: added.length,
    removedCount: removed.length,
    changed: added.length > 0 || removed.length > 0,
  };
}

/** Case-insensitive substring match over an element's identity fields (progressive query). */
export function matchesElementFilter(info: SnapshotElementInfo, filter?: string): boolean {
  if (!filter || !filter.trim()) return true;
  const q = filter.trim().toLowerCase();
  return [info.name, info.role, info.tag, info.type || '', info.value || '']
    .some(field => field.toLowerCase().includes(q));
}

/** Map one coordinate from the 0–1000 normalized space VLMs emit to real pixels (Gemini
 * computer-use denormalization: value / 1000 × size, clamped into the viewport). */
export function denormalizeCoordinate(value: number, size: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0) return 0;
  return Math.min(Math.max(Math.round((value / 1000) * size), 0), Math.max(0, Math.round(size) - 1));
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

/** Page-side mutation counter: lets the runtime detect "the page reacted" without blind sleeps.
 * Installed at page creation AND on every new document, so it survives navigations. */
const MUTATION_COUNTER_SCRIPT = `(() => {
  if (window.__bimaxObs) return;
  window.__bimaxMutations = 0;
  const observer = new MutationObserver(records => { window.__bimaxMutations += records.length; });
  const start = () => {
    try {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      window.__bimaxObs = true;
    } catch { /* no documentElement yet */ }
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})()`;

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
  /** Element handles from the latest OBSERVATION. Identity is observation-scoped: every action
   * attempt CONSUMES the observation (handles are invalidated success or failure) and a fresh one
   * is captured automatically, so an index is only ever valid against the state it described. */
  private indexedElements = new Map<number, ElementHandle<Element>>();
  /** Value-safe metadata mirror of indexedElements, for impact classification and state surfaces. */
  private indexedElementMeta = new Map<number, SnapshotElementInfo>();
  /** Signatures of the previous snapshot's elements (same filter only), fueling successor diffs. */
  private lastSnapshotSignatures: string[] | null = null;
  private lastSnapshotFilter = '';

  /** URL of the live page without launching anything (for status surfaces and approval scoping). */
  currentUrl(): string | null {
    try { return this.page && !this.page.isClosed() ? this.page.url() : null; } catch { return null; }
  }

  /** Value-safe metadata of an element in the CURRENT observation, or null. Never launches. */
  indexedElementInfo(raw: number | string | undefined): SnapshotElementInfo | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const index = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(index) || index < 0) return null;
    return this.indexedElementMeta.get(index) || null;
  }

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

  private async clearIndexedElements(): Promise<void> {
    const handles = Array.from(this.indexedElements.values());
    this.indexedElements.clear();
    this.indexedElementMeta.clear();
    await Promise.all(handles.map(handle => handle.dispose().catch(() => {})));
  }

  /** Resolve an elementIndex against the CURRENT observation. `{stale}` means the caller passed a
   * real index that is no longer part of it (consumed by an action or navigation) — the action
   * must fail truthfully instead of falling back to a misleading "requires selector" message. */
  private resolveIndexed(raw: number | string | undefined):
    { handle: ElementHandle<Element> } | { stale: number } | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const index = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(index) || index < 0) return null;
    const handle = this.indexedElements.get(index);
    return handle ? { handle } : { stale: index };
  }

  private staleIndexResult(base: (ok: boolean, summary: string, data?: unknown) => BrowserCommandResult, index: number): BrowserCommandResult {
    return base(false, `elementIndex ${index} is stale: the observation it came from was consumed by a previous action or navigation. Use the fresh \`observation.elements\` returned by your last action, or take a new snapshot.`);
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
    await this.page.evaluateOnNewDocument(MUTATION_COUNTER_SCRIPT);
    await this.page.evaluate(MUTATION_COUNTER_SCRIPT).catch(() => { /* about:blank etc. */ });
    return this.page;
  }

  /** Capture the interactive-element observation: (re)indexes handles + value-safe metadata.
   * ALWAYS consumes the previous observation first — identity is strictly observation-scoped. */
  private async captureSnapshot(page: Page, filter: string, maxElements: number): Promise<{
    elements: Array<Record<string, unknown>>;
    signatures: string[];
    truncated: boolean;
  }> {
    await this.clearIndexedElements();
    const candidates = await page.$$('a[href], area[href], button, input:not([type="hidden"]), textarea, select, summary, [contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])');
    const elements: Array<Record<string, unknown>> = [];
    for (const handle of candidates) {
      if (elements.length >= maxElements) { await handle.dispose().catch(() => {}); continue; }
      const info = await handle.evaluate(element => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none'
          && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
        if (!visible) return null;
        const input = node as HTMLInputElement;
        const type = (input.type || '').toLowerCase();
        const role = node.getAttribute('role') || node.tagName.toLowerCase();
        const name = node.getAttribute('aria-label') || node.getAttribute('alt')
          || node.getAttribute('title') || input.placeholder
          || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          tag: node.tagName.toLowerCase(), role, type: type || undefined,
          name: name.slice(0, 500),
          value: type === 'password' ? undefined : (input.value || undefined),
          href: node instanceof HTMLAnchorElement ? node.href : undefined,
          disabled: (node as HTMLButtonElement).disabled || node.getAttribute('aria-disabled') === 'true',
          checked: typeof input.checked === 'boolean' && ['checkbox', 'radio'].includes(type) ? input.checked : undefined,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      }).catch(() => null);
      if (!info || !matchesElementFilter(info as SnapshotElementInfo, filter)) { await handle.dispose().catch(() => {}); continue; }
      const index = elements.length;
      this.indexedElements.set(index, handle);
      this.indexedElementMeta.set(index, {
        tag: String(info.tag), role: String(info.role), type: info.type as string | undefined,
        name: String(info.name), value: info.value as string | undefined,
        checked: info.checked as boolean | undefined, disabled: !!info.disabled,
      });
      elements.push({ index, ...info });
    }
    return {
      elements,
      signatures: elements.map(e => elementSignature(e as unknown as SnapshotElementInfo)),
      truncated: candidates.length > maxElements,
    };
  }

  /**
   * The observe→act→observe loop's back half: after a mutating action, wait (bounded,
   * interruptible, first-mutation-exit — never a blind sleep) for the page to react, then capture
   * a FRESH observation and its successor diff against the observation the action consumed.
   * The fresh indexes ship in the same result, so the next reasoning step acts on current state.
   */
  private async observeAfterAction(page: Page, preMutations: number, signal: AbortSignal | undefined, settleMs: number): Promise<Record<string, unknown>> {
    if (settleMs > 0) {
      try {
        const current = await page.evaluate(() => (window as any).__bimaxMutations || 0) as number;
        if (current <= preMutations) {
          let onAbort: (() => void) | undefined;
          const aborted = new Promise<void>(resolve => {
            onAbort = () => resolve();
            signal?.addEventListener('abort', onAbort, { once: true });
          });
          await Promise.race([
            page.waitForFunction(
              (n: number) => ((window as any).__bimaxMutations || 0) > n,
              { timeout: settleMs, polling: 100 },
              preMutations,
            ).catch(() => { /* no mutation within budget — observe anyway */ }),
            aborted,
          ]);
          if (onAbort) signal?.removeEventListener('abort', onAbort);
        }
      } catch { /* settle is best-effort; the observation below is what matters */ }
      if (signal?.aborted) throw new Error('Browser action interrupted.');
    }
    const filter = this.lastSnapshotFilter;
    const previous = this.lastSnapshotSignatures;
    const captured = await this.captureSnapshot(page, filter, 200);
    const diff = previous !== null ? diffSnapshots(previous, captured.signatures) : null;
    this.lastSnapshotSignatures = captured.signatures;
    return {
      ...(filter ? { filter } : {}),
      elements: captured.elements.slice(0, 60),
      truncated: captured.truncated || captured.elements.length > 60,
      ...(diff ? { diff } : {}),
    };
  }

  /** One-line truth about what the action did to the page, appended to action summaries. */
  private observationNote(observation: Record<string, unknown>): string {
    const diff = observation.diff as SnapshotDiff | undefined;
    if (!diff) return ' Fresh observation attached (no prior snapshot to diff against).';
    return diff.changed
      ? ` Page updated: +${diff.addedCount} −${diff.removedCount} element(s); fresh indexes attached.`
      : ' Page elements unchanged; fresh indexes attached.';
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
    let response: HTTPResponse | null = null;
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

      // Observe→act→observe: mutating actions consume the current observation and return a fresh
      // one. Read the page's mutation counter BEFORE acting so the settle wait can end at the
      // first post-action mutation instead of sleeping blind.
      const isMutatingAction = ['click', 'type', 'press', 'select', 'hover', 'upload'].includes(command.action);
      const settleMs = boundedInt(command.settleMs, 800, 0, 5000);
      const preMutations = isMutatingAction
        ? (await page.evaluate(() => (window as any).__bimaxMutations || 0).catch(() => 0)) as number
        : 0;
      const finishAction = async (ok: boolean, summary: string, extra?: Record<string, unknown>): Promise<BrowserCommandResult> => {
        const observation = await this.observeAfterAction(page, preMutations, context.signal, settleMs)
          .catch((e: any) => { if (context.signal?.aborted) throw e; return null; });
        this.checkpoint(cwd);
        return base(ok, `${summary}${observation ? this.observationNote(observation) : ''}`, {
          ...(extra || {}),
          ...(observation ? { observation } : {}),
        });
      };

      switch (command.action) {
        case 'navigate': {
          const check = validateBrowserUrl(String(command.url || ''), command.allowPrivate === true);
          if (!check.ok) return base(false, check.reason);
          const run = await this.retry(maxAttempts, context.signal, async () => {
            const result = await page.goto(check.url.toString(), { waitUntil: command.waitUntil || 'networkidle2', timeout });
            if (!result) throw new Error('Navigation returned no response.');
            return result;
          });
          response = run.value; attempts = run.attempts; this.lastStatus = response.status();
          await this.clearIndexedElements();
          const title = await page.title();
          this.checkpoint(cwd);
          return { ...base(response.ok(), `Loaded ${page.url()} (${response.status()})`), title };
        }
        case 'snapshot': {
          const maxElements = boundedInt(command.maxElements, 200, 1, 1000);
          const filter = (command.filter || '').trim();
          const captured = await this.captureSnapshot(page, filter, maxElements);
          // Successor diff (Pi): what appeared/disappeared since the previous same-filter snapshot,
          // so the model reads "what my action changed" instead of re-scanning the whole list.
          const diff = this.lastSnapshotSignatures !== null && this.lastSnapshotFilter === filter
            ? diffSnapshots(this.lastSnapshotSignatures, captured.signatures)
            : null;
          this.lastSnapshotSignatures = captured.signatures;
          this.lastSnapshotFilter = filter;
          const bodyText = await page.$eval('body', node => (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20_000));
          return {
            ...base(true, `Captured ${captured.elements.length} indexed interactive element(s)${filter ? ` matching "${filter}"` : ''}${diff ? ` (${diff.changed ? `since last snapshot: +${diff.addedCount} −${diff.removedCount}` : 'no element changes since last snapshot'})` : ''}. Indexes are valid until your next action, navigation, or snapshot.`, {
              text: bodyText,
              elements: captured.elements,
              truncated: captured.truncated,
              ...(diff ? { diff } : {}),
            }),
            title: await page.title(),
          };
        }
        case 'click': {
          const resolved = this.resolveIndexed(command.elementIndex);
          if (resolved && 'stale' in resolved) return this.staleIndexResult(base, resolved.stale);
          const indexed = resolved && 'handle' in resolved ? resolved.handle : null;
          const hasCoordinates = Number.isFinite(command.x) && Number.isFinite(command.y);
          if (!command.selector && !indexed && !hasCoordinates) return base(false, 'click requires selector, elementIndex from snapshot, or x/y coordinates.');
          const run = await this.retry(maxAttempts, context.signal, async () => {
            if (indexed) await indexed.click();
            else if (hasCoordinates) {
              let px = Number(command.x), py = Number(command.y);
              if (command.normalized) {
                const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
                px = denormalizeCoordinate(px, viewport.width);
                py = denormalizeCoordinate(py, viewport.height);
              }
              await page.mouse.click(px, py);
            }
            else {
              await page.waitForSelector(command.selector!, { visible: true, timeout });
              await page.click(command.selector!);
            }
          });
          attempts = run.attempts;
          return finishAction(true, indexed ? `Clicked elementIndex ${command.elementIndex}.`
            : hasCoordinates ? `Clicked (${command.x}, ${command.y}).` : `Clicked ${command.selector}.`);
        }
        case 'type': {
          const resolved = this.resolveIndexed(command.elementIndex);
          if (resolved && 'stale' in resolved) return this.staleIndexResult(base, resolved.stale);
          const indexed = resolved && 'handle' in resolved ? resolved.handle : null;
          if (!command.selector && !indexed) return base(false, 'type requires selector or elementIndex from snapshot.');
          const run = await this.retry(maxAttempts, context.signal, async () => {
            const target = indexed || await page.waitForSelector(command.selector!, { visible: true, timeout });
            if (!target) throw new Error('Type target was not found.');
            if (command.clear !== false) {
              await target.focus();
              await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
              await page.keyboard.press('A');
              await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
              await page.keyboard.press('Backspace');
            }
            await target.type(String(command.text || ''));
          });
          attempts = run.attempts;
          return finishAction(true, `Typed ${String(command.text || '').length} character(s) into ${indexed ? `elementIndex ${command.elementIndex}` : command.selector}.`);
        }
        case 'press': {
          if (!command.key) return base(false, 'press requires key.');
          const resolved = this.resolveIndexed(command.elementIndex);
          if (resolved && 'stale' in resolved) return this.staleIndexResult(base, resolved.stale);
          const indexed = resolved && 'handle' in resolved ? resolved.handle : null;
          if (indexed) await indexed.focus();
          else if (command.selector) {
            const target = await page.waitForSelector(command.selector, { visible: true, timeout });
            if (!target) return base(false, `Press target not found: ${command.selector}`);
            await target.focus();
          }
          await page.keyboard.press(command.key as any);
          return finishAction(true, `Pressed ${command.key}${indexed ? ` on elementIndex ${command.elementIndex}` : ''}.`);
        }
        case 'select': {
          const resolved = this.resolveIndexed(command.elementIndex);
          if (resolved && 'stale' in resolved) return this.staleIndexResult(base, resolved.stale);
          const indexed = resolved && 'handle' in resolved ? resolved.handle : null;
          if (!command.selector && !indexed) return base(false, 'select requires selector or elementIndex from snapshot.');
          if (!command.values?.length) return base(false, 'select requires at least one value.');
          const target = indexed || await page.waitForSelector(command.selector!, { visible: true, timeout });
          if (!target) return base(false, 'Select target was not found.');
          const selected = await (target as ElementHandle<HTMLSelectElement>).select(...command.values);
          return finishAction(true, `Selected ${selected.join(', ') || '(none)'}.`, { selected });
        }
        case 'hover': {
          const resolved = this.resolveIndexed(command.elementIndex);
          if (resolved && 'stale' in resolved) return this.staleIndexResult(base, resolved.stale);
          const indexed = resolved && 'handle' in resolved ? resolved.handle : null;
          if (!command.selector && !indexed) return base(false, 'hover requires selector or elementIndex from snapshot.');
          const target = indexed || await page.waitForSelector(command.selector!, { visible: true, timeout });
          if (!target) return base(false, 'Hover target was not found.');
          await target.hover();
          return finishAction(true, `Hovered ${indexed ? `elementIndex ${command.elementIndex}` : command.selector}.`);
        }
        case 'scroll': {
          const pixels = boundedInt(command.pixels, 700, -20_000, 20_000);
          await page.evaluate(value => window.scrollBy(0, value), pixels);
          return base(true, `Scrolled ${pixels}px.`);
        }
        case 'wait': {
          if (command.forChange) {
            // Change detection (Pi wait_for): resolve on the first DOM mutation instead of
            // sleeping blind; report truthfully when nothing changed within the budget.
            const changed = await page.evaluate(budgetMs => new Promise<boolean>(resolve => {
              const observer = new MutationObserver(() => { observer.disconnect(); resolve(true); });
              observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
              setTimeout(() => { observer.disconnect(); resolve(false); }, budgetMs);
            }), timeout);
            return base(changed, changed ? 'DOM changed.' : `No DOM change within ${timeout}ms.`);
          }
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
          return finishAction(true, `Uploaded ${path.relative(cwd, target)} through ${command.selector}.`);
        }
        case 'back':
          response = await page.goBack({ waitUntil: command.waitUntil || 'networkidle2', timeout });
          await this.clearIndexedElements();
          this.lastStatus = response?.status(); this.checkpoint(cwd);
          return base(!!response?.ok(), `Navigated back to ${page.url()}.`);
        case 'reload':
          response = await page.reload({ waitUntil: command.waitUntil || 'networkidle2', timeout });
          await this.clearIndexedElements();
          this.lastStatus = response?.status(); this.checkpoint(cwd);
          return base(!!response?.ok(), `Reloaded ${page.url()}.`);
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
    } catch (error: any) {
      // A failed action attempt still CONSUMED its observation — the page may have half-reacted,
      // so surviving indexes would be lies. Invalidate; the caller re-observes with a snapshot.
      if (['click', 'type', 'press', 'select', 'hover', 'upload'].includes(command.action)) {
        await this.clearIndexedElements();
        this.lastSnapshotSignatures = null;
      }
      this.checkpoint(cwd);
      return base(false, error?.message || String(error));
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    await this.clearIndexedElements();
    this.lastSnapshotSignatures = null;
    this.lastSnapshotFilter = '';
    this.page = null; this.browser = null; this.projectRoot = '';
    if (browser) await browser.close().catch(() => {});
  }
}

export const globalBrowserRuntime = new BrowserRuntime();
