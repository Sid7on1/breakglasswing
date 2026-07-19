import { cliEvents } from '../../cli/events';
import { loadConfig } from '../../cli/config';
import { globalDesktopRuntime, DesktopRuntimePort, DesktopCommand } from '../../computer/desktop.runtime';
import { classifyDesktopActionImpact } from '../../browser/action.impact';
import { IGovernor } from '../../core/interfaces';
import { getTaintTracker } from '../../mind/taint';
import { buildTool, BuiltTool } from '../tool.factory';

/** Acting verbs face the governor; observation (screenshot/cursor/status/…) is approval-free. */
const GATED_ACTIONS = new Set(['click', 'drag', 'type', 'key', 'set_value', 'open', 'close', 'record_start', 'hold', 'mouse_down', 'mouse_up']);

export function createComputerTool(
  governor: IGovernor,
  runtime: DesktopRuntimePort = globalDesktopRuntime,
): BuiltTool {
  // Keyboard approval is shown in the terminal, so the approval UI itself can steal focus from
  // the app the model just opened. Remember that intended app and pass it all the way to the
  // runtime; the runtime re-activates and verifies it immediately before each keyboard action.
  let targetApp = '';
  return buildTool({
    name: 'ComputerTool',
    description: `See and control the user's real desktop — native screenshots, mouse, and keyboard (embedded native driver, no external server).

Use BrowserTool for ordinary websites; ComputerTool is Bimax's native app and cross-app runtime. It follows a visual see → act → see loop: open/observe returns a real PNG, and every click/type/key/drag/scroll/wait automatically returns the fresh PNG after the action. Choose the next action from the NEWEST attached image only. Screenshot x/y are first-class and map exactly to that image; normalized=true uses a 0–1000 image space. query="Storage" is an optional convenience that maps available native text to its visible frame-center pixel, while elementToken/elementIndex remain fallbacks. Native text is supplemental and may be missing or stale; the screenshot is the source of truth. The runtime pins actions to the most recently opened window and rejects coordinates not grounded in its latest image.

THE SCREEN IS THE DELIVERABLE. When the task is to make an app do something (compute a result, send a message, apply a setting), drive the app through the FINAL step — press the "=" / Enter / Save / final button — then observe and report what the app actually displays. Never substitute your own knowledge for the app's output: answering "2+2=4" without having pressed "=" and read "4" off the screen is a FAILED task, even if the answer is right.

COMPLETION PROOF IS REQUIRED. Only claim success when the newest post-action screenshot visibly shows the requested result, or a final observe query matches concrete native text unique to that result. A generic heading or a delivered-click message is not proof. If neither pixels nor native text prove the outcome, keep acting or report the blocker instead of guessing.

Actions: status/request_access · apps/windows discovery · open · observe/screenshot · click/type/key/set_value/drag/scroll · hover/hold/mouse_down/mouse_up (fine-grained pointer: hover to reveal, hold=click-and-hold for ms, and the down/up pair for staged text/cell selection — a drag verifies its source is on the window before pressing and always releases the button, even on failure) · cursor/frontmost/move · close/wait · record_start/record_status/record_stop. open returns pid/windowId and keeps that window as the default target. Actions may also name pid/windowId explicitly. Visible/background delivery is a user preference controlled by /computer; the model cannot override it. screenshot observes the selected native window when one exists and otherwise uses the full display fallback. PiP and automatic MP4 trajectory recording follow /computer settings.

Security: acting (click/drag/type/key/open/close) is governor-gated per intended app with session grants; sensitive targets (password managers, system security settings, wallets) are always denied; screenshots carry untrusted screen content and taint the session like WebFetch.`,
    isDestructive: false,
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'request_access', 'apps', 'windows', 'open', 'observe', 'screenshot', 'click', 'type', 'key', 'set_value', 'drag', 'scroll', 'hover', 'hold', 'mouse_down', 'mouse_up', 'cursor', 'frontmost', 'move', 'close', 'wait', 'record_start', 'record_status', 'record_stop'] },
        x: { type: 'number' }, y: { type: 'number' },
        toX: { type: 'number', description: 'drag: destination x.' }, toY: { type: 'number', description: 'drag: destination y.' },
        dx: { type: 'number', description: 'scroll: horizontal pixels (positive = right).' },
        dy: { type: 'number', description: 'scroll: vertical pixels (positive = down).' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        modifier: { type: 'array', items: { type: 'string', enum: ['cmd', 'shift', 'alt', 'ctrl', 'fn'] }, description: 'click: optional held modifier keys, e.g. ["cmd"] for Finder multi-selection.' },
        count: { type: 'number', description: 'click: 1 (default), 2 = double, 3 = triple.' },
        text: { type: 'string', description: 'type: literal text, full unicode.' },
        combo: { type: 'string', description: 'key: e.g. "cmd+shift+t", "return", "escape", "ctrl+c".' },
        app: { type: 'string', description: 'Intended application name (e.g. "Notes"). Actions default to the most recently opened app.' },
        bundleId: { type: 'string', description: 'open: exact macOS bundle id; preferred when known.' },
        pid: { type: 'number', description: 'Target process id returned by open/apps/windows.' },
        windowId: { type: 'number', description: 'Target window id returned by open/windows.' },
        elementIndex: { type: 'number', description: 'Fresh semantic handle from the latest observe of this exact pid/window.' },
        elementToken: { type: 'string', description: 'Opaque fresh semantic handle from observe; preferred over elementIndex.' },
        query: { type: 'string', description: 'observe: filter/verify optional native text. click: map a native label to its visible frame-center pixel when available.' },
        maxElements: { type: 'number', description: 'observe: compact model-visible element budget, 1–2000 (the runtime scans deeper internally).' },
        includeScreenshot: { type: 'boolean', description: 'observe: false for a cheap tree-only verification refresh.' },
        value: { type: 'string', description: 'set_value: new native control value.' },
        session: { type: 'string', description: 'Optional stable Bimax cursor/session identity.' },
        newInstance: { type: 'boolean', description: 'open: request an isolated app instance when supported.' },
        display: { type: 'number', description: 'screenshot: display index, 1 = main.' },
        ms: { type: 'number', description: 'wait: 50-5000 ms. hover/hold: how long to hover or hold the button (default 400/800 ms).' },
        normalized: { type: 'boolean', description: 'Interpret click coordinates in a 0–1000 space scaled to the newest window screenshot.' },
        pixelFallback: { type: 'boolean', description: 'Deprecated compatibility flag; screenshot pixel clicks are always supported.' },
        recordVideo: { type: 'boolean', description: 'record_start: include an MP4 screen recording (default true).' },
        outputDir: { type: 'string', description: 'record_start: optional output directory; defaults under .bimax/computer/recordings.' },
      },
      required: ['action'],
    },
    execute: async (args: DesktopCommand, context?: any) => {
      const intendedApp = args.app?.trim() || (['click', 'drag', 'scroll', 'type', 'key', 'set_value', 'close', 'hover', 'hold', 'mouse_down', 'mouse_up'].includes(args.action) ? targetApp : '');
      // Delivery is a user-owned /computer preference. Strip any stale or hallucinated model arg
      // so a visible run cannot silently fall back to the sidecar's synthetic overlay path.
      const { deliveryMode: _ignoredDelivery, ...modelArgs } = args;
      const effectiveArgs: DesktopCommand = intendedApp ? { ...modelArgs, app: intendedApp } : modelArgs;
      if (GATED_ACTIONS.has(effectiveArgs.action)) {
        // Scope the approval to the app that will RECEIVE the input so the governor can offer
        // (and honor) a session grant for exactly that app — and hard-deny sensitive targets.
        // 'open' is the odd one out: it targets an app that is NOT yet frontmost (that's the whole
        // point), so falling back to frontmostApp() for it showed the WRONG app in the prompt —
        // e.g. "Allow? open in ComputerTool @ <terminal>" when the model opened by bundleId only,
        // confusingly naming whatever happened to still be focused instead of what's being opened.
        const app = effectiveArgs.action === 'open'
          ? (effectiveArgs.app?.trim() || effectiveArgs.bundleId?.trim() || 'application')
          : intendedApp || await runtime.frontmostApp();
        const semanticTarget = runtime.describeTarget?.(effectiveArgs) || undefined;
        const impact = effectiveArgs.action === 'record_start'
          ? { high: true, reason: 'starting screen recording captures visible desktop content' }
          : classifyDesktopActionImpact(effectiveArgs.action, {
          text: effectiveArgs.text, combo: effectiveArgs.combo, app: effectiveArgs.app,
          label: semanticTarget?.label, role: semanticTarget?.role, value: semanticTarget?.value,
          });
        // The sidecar's first-use spawn/handshake can take real wall-clock time; kick it off now
        // so it overlaps with the human reading/deciding on the approval prompt instead of starting
        // only after Enter, where it would otherwise sit behind an undifferentiated spinner.
        runtime.warm?.();
        // 'high-impact-only' approvals: routine interaction (click/type/press/open) flows without a
        // prompt so long runs aren't interrupted every step; high-impact actions (delete/send/
        // purchase/submit/permissions) still face the human each time, and the governor's
        // sensitive-target hard floor runs regardless of what we pass here. plan/strict sessions
        // keep the every-action prompt — those modes exist to slow things down.
        const approvals = (await loadConfig()).computerApprovals;
        const governorMode = (governor as any).mode;
        const routine = approvals === 'high-impact-only' && !impact.high
          && governorMode !== 'plan' && governorMode !== 'strict';
        await governor.approveTaskExecution('COMPUTER_CONTROL', {
          tool: 'ComputerTool', action: effectiveArgs.action, app: app || undefined,
          highImpact: impact.high || undefined, impactReason: impact.reason,
          isDestructive: !routine,
        });
        if (routine) cliEvents.emit('status', `Auto-approved (${approvals}): ${effectiveArgs.action}${app ? ` in ${app}` : ''}`);
      }
      const result = await runtime.run(effectiveArgs, { cwd: context?.cwd || process.cwd(), signal: context?.signal });
      if (result.ok && effectiveArgs.action === 'open') targetApp = effectiveArgs.app?.trim() || result.app || '';
      if (result.ok && effectiveArgs.action === 'close' && (!intendedApp || intendedApp === targetApp)) targetApp = '';
      // Whatever is on screen is untrusted input (prompt injection): a screenshot pulls it into
      // the conversation, exactly like a WebFetch of an arbitrary page.
      if (result.ok && ['observe', 'screenshot'].includes(effectiveArgs.action)) {
        try { getTaintTracker().mark('web', `ComputerTool screenshot${result.app ? ` (${result.app})` : ''}`); } catch { /* taint is best-effort */ }
        cliEvents.emit('browser_evidence', {
          action: 'screenshot', ok: result.ok, trusted: false,
          source: result.screenshot || 'ComputerTool', summary: result.summary,
        });
      }
      return JSON.stringify(result, null, 2);
    },
  }, governor);
}
