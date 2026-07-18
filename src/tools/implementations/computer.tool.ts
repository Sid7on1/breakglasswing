import { cliEvents } from '../../cli/events';
import { globalDesktopRuntime, DesktopRuntimePort, DesktopCommand } from '../../computer/desktop.runtime';
import { classifyDesktopActionImpact } from '../../browser/action.impact';
import { IGovernor } from '../../core/interfaces';
import { getTaintTracker } from '../../mind/taint';
import { buildTool, BuiltTool } from '../tool.factory';

/** Acting verbs face the governor; observation (screenshot/cursor/status/…) is approval-free. */
const GATED_ACTIONS = new Set(['click', 'drag', 'type', 'key', 'open', 'close']);

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

Use BrowserTool for anything inside a web page; ComputerTool is for native apps and cross-app work. Work the loop: screenshot → act → screenshot to verify. Coordinates are GLOBAL SCREEN POINTS matching the screenshot pixels exactly (Retina captures are pre-scaled), and every coordinate action also accepts normalized=true for the 0–1000 space scaled to the main display. Actions: screenshot (display n) · click/move/drag/scroll · type (unicode text) · key (combos like "cmd+shift+t", "return", "ctrl+c") · cursor · frontmost · open (launch/focus an app by name) · close (quit the intended app) · wait (let UI settle) · status (driver + Accessibility/Screen Recording permissions + displays) · request_access (trigger the macOS permission prompts). Keyboard actions stay locked to the most recently opened app; if focus cannot be restored, the action fails. On first use run status; if permissions are missing run request_access and tell the user what to approve.

Security: acting (click/drag/type/key/open/close) is governor-gated per intended app with session grants; sensitive targets (password managers, system security settings, wallets) are always denied; screenshots carry untrusted screen content and taint the session like WebFetch.`,
    isDestructive: false,
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['screenshot', 'click', 'move', 'drag', 'scroll', 'type', 'key', 'cursor', 'frontmost', 'open', 'close', 'wait', 'status', 'request_access'] },
        x: { type: 'number' }, y: { type: 'number' },
        toX: { type: 'number', description: 'drag: destination x.' }, toY: { type: 'number', description: 'drag: destination y.' },
        dx: { type: 'number', description: 'scroll: horizontal pixels (positive = right).' },
        dy: { type: 'number', description: 'scroll: vertical pixels (positive = down).' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        count: { type: 'number', description: 'click: 1 (default), 2 = double, 3 = triple.' },
        text: { type: 'string', description: 'type: literal text, full unicode.' },
        combo: { type: 'string', description: 'key: e.g. "cmd+shift+t", "return", "escape", "ctrl+c".' },
        app: { type: 'string', description: 'open/close/type/key: intended application name (e.g. "Notes"). Keyboard actions default to the most recently opened app.' },
        display: { type: 'number', description: 'screenshot: display index, 1 = main.' },
        ms: { type: 'number', description: 'wait: 50-5000 milliseconds.' },
        normalized: { type: 'boolean', description: 'Interpret coordinates as 0–1000 normalized space scaled to the main display.' },
      },
      required: ['action'],
    },
    execute: async (args: DesktopCommand, context?: any) => {
      const intendedApp = args.app?.trim() || (['type', 'key', 'close'].includes(args.action) ? targetApp : '');
      const effectiveArgs: DesktopCommand = intendedApp ? { ...args, app: intendedApp } : args;
      if (GATED_ACTIONS.has(effectiveArgs.action)) {
        // Scope the approval to the app that will RECEIVE the input so the governor can offer
        // (and honor) a session grant for exactly that app — and hard-deny sensitive targets.
        const app = ['open', 'close', 'type', 'key'].includes(effectiveArgs.action) && intendedApp
          ? intendedApp
          : await runtime.frontmostApp();
        const impact = classifyDesktopActionImpact(effectiveArgs.action, { text: effectiveArgs.text, combo: effectiveArgs.combo, app: effectiveArgs.app });
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
