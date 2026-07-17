import { cliEvents } from '../../cli/events';
import { globalBrowserRuntime, BrowserCommand, BrowserRuntimePort } from '../../browser/browser.runtime';
import { IGovernor } from '../../core/interfaces';
import { getTaintTracker } from '../../mind/taint';
import { buildTool, BuiltTool } from '../tool.factory';

export function createBrowserTool(
  governor: IGovernor,
  runtime: BrowserRuntimePort = globalBrowserRuntime,
): BuiltTool {
  return buildTool({
    name: 'BrowserTool',
    description: `Drive and verify a real persistent Chromium browser.

Use snapshot to get a Browser-Use-style indexed interactive-element map, then pass elementIndex to click/type/press/select/hover without inventing CSS selectors. snapshot accepts filter (substring over name/role/tag) for a focused query instead of the full list, and each snapshot reports a diff (added/removed elements) against the previous one so you see what your last action changed. Use wait with forChange=true to wait for the page to actually change after an action. Selector and coordinate actions remain available as fallbacks (click also accepts normalized=true for 0–1000 coordinate space). Always act from a FRESH snapshot: indexes expire on navigation. Use navigate/click/type/press/select/hover/scroll/wait/viewport/upload/back/reload for interaction; inspect for DOM text/HTML; screenshot for a durable visual artifact; compare with baseline for exact engine-trusted visual regression evidence; assert for deterministic engine-trusted verification; status/close for lifecycle control. Element indexes expire after navigation or the next snapshot. The browser profile persists under .bimax/browser so cookies and state survive restarts. Navigation and selector actions use bounded retry/backoff. Console errors and failed network requests are returned with every result.

Security: only http/https URLs are accepted. Localhost is allowed for development. Private-network hosts require allowPrivate=true. Uploads and evidence paths must stay inside the workspace. Browser interaction may change external state and therefore remains governor-gated.`,
    // Read-only observation is approval-free; actions that can change page/external state are
    // separately gated below with their exact action visible to the user.
    isDestructive: false,
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['navigate', 'snapshot', 'click', 'type', 'press', 'select', 'hover', 'scroll', 'wait', 'inspect', 'screenshot', 'compare', 'assert', 'viewport', 'upload', 'back', 'reload', 'status', 'close'] },
        url: { type: 'string' }, selector: { type: 'string' }, elementIndex: { type: 'number', description: 'Index from the latest snapshot.' },
        text: { type: 'string' }, key: { type: 'string' }, values: { type: 'array', items: { type: 'string' } },
        x: { type: 'number' }, y: { type: 'number' }, path: { type: 'string' }, maxElements: { type: 'number' },
        filter: { type: 'string', description: 'snapshot: only index elements whose name/role/tag matches this substring.' },
        normalized: { type: 'boolean', description: 'click: treat x/y as 0–1000 normalized coordinates and scale to the viewport.' },
        forChange: { type: 'boolean', description: 'wait: resolve on the first DOM change instead of sleeping; reports truthfully if nothing changed.' },
        baseline: { type: 'string', description: 'Workspace-relative baseline PNG for action=compare.' },
        fullPage: { type: 'boolean' }, width: { type: 'number' }, height: { type: 'number' }, pixels: { type: 'number' },
        timeout: { type: 'number', description: 'Action timeout in ms (100–120000).' },
        retries: { type: 'number', description: 'Bounded attempts (1–4, default 2).' },
        waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'] },
        clear: { type: 'boolean' }, allowPrivate: { type: 'boolean' },
        assertion: {
          type: 'object',
          properties: {
            selector: { type: 'string' }, exists: { type: 'boolean' }, textIncludes: { type: 'string' },
            urlIncludes: { type: 'string' }, titleIncludes: { type: 'string' }, noConsoleErrors: { type: 'boolean' },
            noFailedRequests: { type: 'boolean' }, statusBelow: { type: 'number' },
          },
        },
      },
      required: ['action'],
    },
    execute: async (args: BrowserCommand, context?: any) => {
      if (['click', 'type', 'press', 'select', 'upload'].includes(args.action)) {
        // Scope the approval to the page's domain so the governor can offer (and honor) a
        // session grant for exactly this site. Uploads move workspace files into a page —
        // exfiltration-shaped — so they are high-impact: always prompted, never grant-covered.
        let host = '';
        try { host = new URL(args.url || runtime.currentUrl?.() || '').hostname.toLowerCase(); } catch { /* no live page yet */ }
        await governor.approveTaskExecution('COMPUTER_CONTROL', {
          tool: 'BrowserTool', action: args.action, url: args.url, host: host || undefined,
          highImpact: args.action === 'upload' || undefined,
          selector: args.selector, elementIndex: args.elementIndex, isDestructive: true,
        });
      }
      const result = await runtime.run(args, { cwd: context?.cwd || process.cwd(), signal: context?.signal });
      // Page content is untrusted input (prompt injection): any observation that pulls page text,
      // titles, or element names into the conversation taints the session, exactly like WebFetch.
      if (result.ok && ['snapshot', 'inspect', 'navigate'].includes(args.action)) {
        try { getTaintTracker().mark('web', `BrowserTool ${args.action} ${result.url || args.url || ''}`.trim()); } catch { /* taint is best-effort */ }
      }
      if (args.action === 'assert' || args.action === 'screenshot' || args.action === 'compare') {
        cliEvents.emit('browser_evidence', {
          action: args.action,
          ok: result.ok,
          trusted: args.action === 'assert' || args.action === 'compare',
          source: result.screenshot || result.url || 'BrowserTool',
          summary: result.summary,
        });
      }
      return JSON.stringify(result, null, 2);
    },
  }, governor);
}
