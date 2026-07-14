import { cliEvents } from '../../cli/events';
import { globalBrowserRuntime, BrowserCommand, BrowserRuntimePort } from '../../browser/browser.runtime';
import { IGovernor } from '../../core/interfaces';
import { buildTool, BuiltTool } from '../tool.factory';

export function createBrowserTool(
  governor: IGovernor,
  runtime: BrowserRuntimePort = globalBrowserRuntime,
): BuiltTool {
  return buildTool({
    name: 'BrowserTool',
    description: `Drive and verify a real persistent Chromium browser.

Use navigate/click/type/scroll/wait/viewport/upload/back/reload for interaction; inspect for DOM text/HTML; screenshot for a durable visual artifact; compare with baseline for exact engine-trusted visual regression evidence; assert for deterministic engine-trusted verification; status/close for lifecycle control. The browser profile persists under .bimax/browser so cookies and state survive restarts. Navigation and selector actions use bounded retry/backoff. Console errors and failed network requests are returned with every result.

Security: only http/https URLs are accepted. Localhost is allowed for development. Private-network hosts require allowPrivate=true. Uploads and evidence paths must stay inside the workspace. Browser interaction may change external state and therefore remains governor-gated.`,
    isDestructive: true,
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['navigate', 'click', 'type', 'scroll', 'wait', 'inspect', 'screenshot', 'compare', 'assert', 'viewport', 'upload', 'back', 'reload', 'status', 'close'] },
        url: { type: 'string' }, selector: { type: 'string' }, text: { type: 'string' }, path: { type: 'string' },
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
      const result = await runtime.run(args, { cwd: context?.cwd || process.cwd(), signal: context?.signal });
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
