import { cliEvents } from '../../cli/events';
import { globalDesktopRuntime, DesktopRuntimePort, DesktopCommand } from '../../computer/desktop.runtime';
import { classifyDesktopActionImpact } from '../../browser/action.impact';
import { IGovernor } from '../../core/interfaces';
import { getTaintTracker } from '../../mind/taint';
import { buildTool, BuiltTool } from '../tool.factory';

/** Acting verbs face the governor; observation (screenshot/cursor/status/…) is approval-free. */
const GATED_ACTIONS = new Set(['click', 'drag', 'type', 'key', 'set_value', 'open', 'close']);

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
    description: `See and control the user's real desktop — native screenshots, mouse, and keyboard (first-party OS driver, no external server).

Use BrowserTool for ordinary websites; ComputerTool is Bimax's native app and cross-app runtime. Its primary loop is open → observe → semantic action → observe. observe returns one window's accessibility tree AND its screenshot from the same instant, with pid/windowId and fresh elementIndex/elementToken handles. Prefer elementToken or elementIndex for click/type/key/set_value; use window-local screenshot pixels only when the tree is missing or visibly wrong. Handles expire after the next observe. Every action result is delivery evidence, not success evidence: observe again and verify the requested state before replying.

Actions: status/request_access · apps/windows discovery · open · observe/screenshot · click/type/key/set_value/drag/scroll · cursor/frontmost/move · close/wait. open returns pid/windowId and keeps that window as the default target. Actions may also name pid/windowId explicitly. deliveryMode defaults to background (no focus steal); foreground is an explicit last-resort retry only after a background action plus fresh observation proved a no-op. screenshot observes the selected native window when one exists and otherwise uses the full display fallback.

Security: acting (click/drag/type/key/open/close) is governor-gated per intended app with session grants; sensitive targets (password managers, system security settings, wallets) are always denied; screenshots carry untrusted screen content and taint the session like WebFetch.`,
    isDestructive: false,
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'request_access', 'apps', 'windows', 'open', 'observe', 'screenshot', 'click', 'type', 'key', 'set_value', 'drag', 'scroll', 'cursor', 'frontmost', 'move', 'close', 'wait'] },
        x: { type: 'number' }, y: { type: 'number' },
        toX: { type: 'number', description: 'drag: destination x.' }, toY: { type: 'number', description: 'drag: destination y.' },
        dx: { type: 'number', description: 'scroll: horizontal pixels (positive = right).' },
        dy: { type: 'number', description: 'scroll: vertical pixels (positive = down).' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        count: { type: 'number', description: 'click: 1 (default), 2 = double, 3 = triple.' },
        text: { type: 'string', description: 'type: literal text, full unicode.' },
        combo: { type: 'string', description: 'key: e.g. "cmd+shift+t", "return", "escape", "ctrl+c".' },
        app: { type: 'string', description: 'Intended application name (e.g. "Notes"). Actions default to the most recently opened app.' },
        bundleId: { type: 'string', description: 'open: exact macOS bundle id; preferred when known.' },
        pid: { type: 'number', description: 'Target process id returned by open/apps/windows.' },
        windowId: { type: 'number', description: 'Target window id returned by open/windows.' },
        elementIndex: { type: 'number', description: 'Fresh semantic handle from the latest observe of this exact pid/window.' },
        elementToken: { type: 'string', description: 'Opaque fresh semantic handle from observe; preferred over elementIndex.' },
        query: { type: 'string', description: 'observe: filter the rendered accessibility tree while keeping element identity stable.' },
        maxElements: { type: 'number', description: 'observe: accessibility-tree budget, 1–2000.' },
        includeScreenshot: { type: 'boolean', description: 'observe: false for a cheap tree-only verification refresh.' },
        value: { type: 'string', description: 'set_value: new native control value.' },
        deliveryMode: { type: 'string', enum: ['background', 'foreground'], description: 'background first; foreground only after a verified no-op.' },
        session: { type: 'string', description: 'Optional stable Bimax cursor/session identity.' },
        newInstance: { type: 'boolean', description: 'open: request an isolated app instance when supported.' },
        display: { type: 'number', description: 'screenshot: display index, 1 = main.' },
        ms: { type: 'number', description: 'wait: 50-5000 milliseconds.' },
        normalized: { type: 'boolean', description: 'Interpret coordinates as 0–1000 normalized space scaled to the main display.' },
      },
      required: ['action'],
    },
    execute: async (args: DesktopCommand, context?: any) => {
      const intendedApp = args.app?.trim() || (['click', 'drag', 'scroll', 'type', 'key', 'set_value', 'close'].includes(args.action) ? targetApp : '');
      const effectiveArgs: DesktopCommand = intendedApp ? { ...args, app: intendedApp } : args;
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
        const impact = classifyDesktopActionImpact(effectiveArgs.action, {
          text: effectiveArgs.text, combo: effectiveArgs.combo, app: effectiveArgs.app,
          label: semanticTarget?.label, role: semanticTarget?.role, value: semanticTarget?.value,
        });
        // The sidecar's first-use spawn/handshake can take real wall-clock time; kick it off now
        // so it overlaps with the human reading/deciding on the approval prompt instead of starting
        // only after Enter, where it would otherwise sit behind an undifferentiated spinner.
        runtime.warm?.();
        await governor.approveTaskExecution('COMPUTER_CONTROL', {
          tool: 'ComputerTool', action: effectiveArgs.action, app: app || undefined,
          highImpact: impact.high || undefined, impactReason: impact.reason,
          isDestructive: true,
        });
      }
      const result = await runtime.run(effectiveArgs, { cwd: context?.cwd || process.cwd(), signal: context?.signal });
      if (result.ok && effectiveArgs.action === 'open') targetApp = effectiveArgs.app?.trim() || result.app || '';
      if (result.ok && effectiveArgs.action === 'close' && (!intendedApp || intendedApp === targetApp)) targetApp = '';
      // Whatever is on screen is untrusted input (prompt injection): a screenshot pulls it into
      // the conversation, exactly like a WebFetch of an arbitrary page.
      if (result.ok && effectiveArgs.action === 'screenshot') {
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
