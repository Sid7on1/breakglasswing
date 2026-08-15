/**
 * Expose Bimax Computer Use over MCP stdio, so an external agent (Claude Code, etc.) drives the SAME
 * `BimaxComputerRuntime` the engine drives — `bimax mcp-computer`.
 *
 * Why this exists rather than a throwaway script: the runtime is stateful. Observed frames, the
 * target lock, frame ids, AX event epochs and the no-progress streak all live across calls, and every
 * guard built on them (stale-frame refusal, self-invalidation re-grounding, occlusion re-routing) only
 * has meaning in a process that survives between actions. A script re-opens and re-observes each run
 * and therefore cannot reproduce the state those bugs live in. One long-lived stdio server can.
 *
 * This is the runtime surface, deliberately NOT the agent-loop surface: the messaging phase gates and
 * completion nudges live in the loop, so a failure reproduced here is a runtime failure and a failure
 * that only appears in the TUI is a loop failure. That split is the whole diagnostic value.
 */

import { normalizeDesktopAction, PUBLIC_DESKTOP_ACTIONS, DesktopCommand } from '../computer/desktop.runtime';
import { globalComputerSessionManager } from '../computer/session.manager';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

export const COMPUTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: [...PUBLIC_DESKTOP_ACTIONS], description: 'One action per call.' },
    app: { type: 'string', description: 'open/focus/close/quit_app: application name.' },
    bundleId: { type: 'string' },
    query: { type: 'string', description: 'Semantic target from the newest frame. Pass the element\'s FULL label — a truncated head can be an exact match for window chrome that carries the same name.' },
    elementToken: { type: 'string', description: 'Fresh handle from the newest observe — its `element_token` field, e.g. "s0002:1". Expires whenever the app re-renders.' },
    elementIndex: { type: 'number', description: 'Fresh index from the newest observe — its `element_index` FIELD, which is not the element\'s position in the returned array.' },
    x: { type: 'number', description: 'Raw screenshot pixel. Never derived from an element frame.' },
    y: { type: 'number' },
    toX: { type: 'number' }, toY: { type: 'number' },
    // drag/desktop can land on a NAMED destination, not just raw pixels. Omitting these left the
    // runtime's own guidance unusable: the `desktop` summary tells the caller to pass toQuery.
    toQuery: { type: 'string', description: 'drag/desktop: semantic destination, same rules as query.' },
    toElementToken: { type: 'string', description: 'drag/desktop: destination handle from the newest observe.' },
    toElementIndex: { type: 'number', description: 'drag/desktop: destination `element_index` from the newest observe.' },
    normalized: { type: 'boolean', description: 'Treat x/y as 0-1000 within the returned image.' },
    text: { type: 'string', description: 'type: literal text.' },
    replaceExisting: { type: 'boolean', description: 'type: select the field\'s existing contents first, so entry replaces rather than appends.' },
    combo: { type: 'string', description: 'key: e.g. "return", "cmd+a".' },
    modifier: { type: 'array', items: { type: 'string' } },
    button: { type: 'string', description: 'click: left (default) or right.' },
    count: { type: 'number', description: 'click: 2 for a double-click.' },
    value: { type: 'string', description: 'set_value: exact value for an AX-settable control.' },
    expect: { type: 'string', description: 'Semantic postcondition proven against the fresh post-action frame.' },
    expectMode: { type: 'string' },
    frameId: { type: 'string', description: 'The frame this action was planned from. Raw x/y planned against a superseded frame is REFUSED; a named target (query/elementToken/elementIndex) is instead re-observed and re-grounded automatically, so the guard protects coordinates, not names.' },
    maxElements: { type: 'number', description: 'observe: element budget. Low values starve your own targeting — the frame then exposes no field to name.' },
    includeScreenshot: { type: 'boolean' },
    layout: { type: 'string', description: 'arrange: maximize | fullscreen | left | right | …' },
    direction: { type: 'string' }, amount: { type: 'number' },
    deliveryMode: { type: 'string', enum: ['foreground', 'background'], description: 'foreground uses the one real cursor; background routes through accessibility.' },
    captureScope: { type: 'string' },
    // The runtime reads `ms`. A `seconds` field sat here instead and was read by nothing, so every
    // duration the caller asked for was silently discarded: wait{seconds:3} waited the 500ms default.
    ms: { type: 'number', description: 'wait: duration in MILLISECONDS (50–5000, default 500). hold: press duration (default 800).' },
    pid: { type: 'number' }, windowId: { type: 'number' },
  },
  required: ['action'],
};

const READ_ONLY_MCP_ACTIONS = new Set([
  'status', 'apps', 'windows', 'observe', 'screenshot', 'cursor', 'frontmost', 'desktop',
  'record_status',
]);

export type ComputerMcpAuthorizer = (
  command: DesktopCommand,
  context: { cwd: string },
) => Promise<boolean | { allowed: boolean; reason?: string }>;

/**
 * Build the shared MCP call path independently from the SDK transport.
 *
 * External MCP is read-only by default. A host that wants acting verbs must inject an authorizer
 * connected to its real approval UI; an environment boolean or model-controlled argument is not
 * authority to click, type, launch, close, or request permissions.
 */
export function createComputerMcpCallHandler(
  runtime: Pick<ReturnType<typeof globalComputerSessionManager.forSession>, 'run'>,
  cwd: string,
  authorize?: ComputerMcpAuthorizer,
): (args: Record<string, unknown>) => Promise<unknown> {
  return async (args: Record<string, unknown>) => {
    const allowedFields = new Set(Object.keys(COMPUTER_SCHEMA.properties));
    const sanitized = Object.fromEntries(Object.entries(args).filter(([key]) => allowedFields.has(key)));
    const action = normalizeDesktopAction(String(sanitized.action || ''));
    if (!(PUBLIC_DESKTOP_ACTIONS as readonly string[]).includes(action)) {
      return { ok: false, action, code: 'invalid_external_action', error: 'Unknown external computer action.' };
    }
    const cmd = {
      ...sanitized,
      action,
    } as unknown as DesktopCommand;
    if (!READ_ONLY_MCP_ACTIONS.has(cmd.action)) {
      if (!authorize) {
        return {
          ok: false, action: cmd.action, code: 'external_approval_unavailable',
          error: 'External MCP acting verbs require a host-injected approval broker; this server is read-only.',
        };
      }
      const decision = await authorize(cmd, { cwd });
      const allowed = typeof decision === 'boolean' ? decision : decision.allowed;
      if (!allowed) {
        return {
          ok: false, action: cmd.action, code: 'external_action_denied',
          error: typeof decision === 'boolean' ? 'External action denied.' : decision.reason || 'External action denied.',
        };
      }
    }
    return runtime.run(cmd, { cwd });
  };
}

/** Build (but do not connect) the server. Exported for tests. */
export function createComputerMcpServer(
  runtime = globalComputerSessionManager.forSession(`mcp-computer-${process.pid}`),
  cwd: string = process.cwd(),
  authorize?: ComputerMcpAuthorizer,
): any {
  const server = new Server({ name: 'bimax-computer', version: '1.0.0' }, { capabilities: { tools: {} } });
  const call = createComputerMcpCallHandler(runtime, cwd, authorize);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'computer',
      description: (authorize
        ? 'Observe AND drive the real desktop through Bimax Computer Use. Acting verbs are enabled for '
          + 'this client. '
        : 'Observe the real desktop through Bimax Computer Use. Acting verbs are available only '
          + 'when the embedding host supplies an approval broker. ')
        + 'One action per call. Returns the '
        + 'runtime\'s full JSON result — frameId, elements, targeting, actionReceipt, progressCheck — so '
        + 'you can judge by the evidence rather than by "ok". Start with status, then open/observe, and '
        + 'pass the returned frameId back on the action you planned from it. '
        + 'Judge by actionResult, not by ok: `delivered` says the input was sent, `observed` says what '
        + 'the screen then showed, and a launch can be delivered while its first frame is unverified. '
        + '`screenshot` is the SAME operation as `observe` (identical payload, elements included) — use '
        + 'maxElements to control its cost. `apps` and `windows` accept a `query` to narrow what they '
        + 'return; unfiltered they describe the whole machine.',
      inputSchema: COMPUTER_SCHEMA,
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    if (req.params.name !== 'computer') {
      return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
    const args = (req.params.arguments || {}) as Record<string, unknown>;
    const action = normalizeDesktopAction(String(args.action || ''));
    try {
      const result = await call(args);
      // A refused action is a RESULT, not a transport error: its message is the remediation, and the
      // caller needs to read it exactly as the agent loop does.
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, action, error: String(error?.message || error) }, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Authorizer for a host whose operator opted in when they LAUNCHED the server.
 *
 * The invariant the read-only default protects is that authority to click must not be something the
 * model can assert for itself. A process-launch flag satisfies that: it is written by hand into the
 * client's server config (`.mcp.json`), it is fixed for the life of the process, and no tool argument
 * can turn it on. What it is NOT is per-action consent, so every acting verb is announced on stderr —
 * the client surfaces that as server logs, which is the only place the operator can audit what a
 * remote agent actually drove on their machine.
 */
export function createLaunchFlagAuthorizer(log: (line: string) => void = console.error): ComputerMcpAuthorizer {
  return async (command) => {
    const target = [
      command.app && `app=${command.app}`,
      command.query && `query=${JSON.stringify(command.query)}`,
      command.elementToken && `token=${command.elementToken}`,
      typeof command.x === 'number' && `x=${command.x},y=${command.y}`,
      command.text && `text=${JSON.stringify(String(command.text).slice(0, 60))}`,
      command.combo && `combo=${command.combo}`,
    ].filter(Boolean).join(' ');
    log(`[bimax-computer] acting verb allowed by --allow-acting: ${command.action}${target ? ` ${target}` : ''}`);
    return { allowed: true };
  };
}

/** Serve the desktop runtime over stdio (used by `bimax mcp-computer`). */
export async function runComputerMcpStdioServer(
  cwd: string = process.cwd(),
  options: { allowActing?: boolean } = {},
): Promise<void> {
  // stdout is the JSON-RPC channel — any stray log on it corrupts the framing.
  console.log = console.error.bind(console);
  const runtime = globalComputerSessionManager.forSession(`mcp-computer-${process.pid}`);
  const authorize = options.allowActing ? createLaunchFlagAuthorizer() : undefined;
  if (authorize) {
    console.error('[bimax-computer] started with --allow-acting: acting verbs are ENABLED for this client.');
  }
  const server = createComputerMcpServer(runtime, cwd, authorize);
  await server.connect(new StdioServerTransport());
  const shutdown = async () => {
    try { await runtime.dispose?.(); } catch { /* exiting anyway */ }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
