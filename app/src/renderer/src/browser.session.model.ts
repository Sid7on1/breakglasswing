/**
 * Browser lane evidence.
 *
 * `competitive/05_GAP_REGISTER.md` P1 makes browser-first the Bimax target for web work and asks
 * that "web tasks use structured browser before generic Mac clicks;
 * artifacts attached". The inspector therefore needs a browser lane that appears only once the task
 * has actually opened a page.
 *
 * Same discipline as the Mac lane: this reads the engine's own `BrowserTool` results out of the
 * transcript rather than adding a second telemetry channel, and never invents a URL.
 */

export interface BrowserStep {
  id: string;
  action: string;
  url: string;
  status: 'running' | 'success' | 'error';
  atMs: number | null;
  summary: string;
  title: string;
  consoleErrors: number;
  failedRequests: number;
  elementCount: number | null;
}

export interface BrowserSession {
  active: boolean;
  currentUrl: string;
  currentTitle: string;
  screenshot: string;
  steps: BrowserStep[];
  consoleErrors: number;
  failedRequests: number;
  successfulSteps: number;
}

export interface BrowserToolCall {
  id: string;
  toolName: string;
  input: string;
  output: string;
  status: 'running' | 'success' | 'error';
  startTime: string;
  endTime?: string;
}

export function isBrowserToolCall(call: { toolName: string }): boolean {
  return call.toolName === 'BrowserTool';
}

export function deriveBrowserSession(calls: BrowserToolCall[]): BrowserSession {
  const steps: BrowserStep[] = [];
  let currentUrl = '';
  let currentTitle = '';
  let screenshot = '';
  let consoleErrors = 0;
  let failedRequests = 0;

  for (const call of calls.filter(isBrowserToolCall)) {
    let payload: Record<string, any> | null = null;
    try {
      const parsed = JSON.parse(call.output);
      payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { payload = null; }
    const url = typeof payload?.url === 'string' ? payload.url : '';
    if (url) currentUrl = url;
    const title = typeof payload?.title === 'string' ? payload.title : '';
    if (title) currentTitle = title;
    if (typeof payload?.screenshot === 'string' && payload.screenshot) screenshot = payload.screenshot;
    const stepConsoleErrors = Array.isArray(payload?.consoleErrors) ? payload.consoleErrors.length : 0;
    const stepFailedRequests = Array.isArray(payload?.failedRequests) ? payload.failedRequests.length : 0;
    consoleErrors += stepConsoleErrors;
    failedRequests += stepFailedRequests;
    const observation = payload?.data && typeof payload.data === 'object'
      ? (payload.data as { observation?: { elements?: unknown[] } }).observation
      : undefined;
    const at = Date.parse(call.endTime || call.startTime);
    steps.push({
      id: call.id,
      action: String(payload?.action || actionFromInput(call.input) || 'browse'),
      url,
      status: call.status,
      atMs: Number.isFinite(at) ? at : null,
      summary: typeof payload?.summary === 'string' ? payload.summary : '',
      title,
      consoleErrors: stepConsoleErrors,
      failedRequests: stepFailedRequests,
      elementCount: Array.isArray(observation?.elements) ? observation.elements.length : null,
    });
  }

  return {
    active: steps.length > 0,
    currentUrl,
    currentTitle,
    screenshot,
    steps,
    consoleErrors,
    failedRequests,
    successfulSteps: steps.filter((step) => step.status === 'success').length,
  };
}

function actionFromInput(input: string): string {
  const match = (input || '').match(/"action"\s*:\s*"([a-z_]+)"/i);
  return match ? match[1] : '';
}
