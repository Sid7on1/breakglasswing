// BiMax UI protocol — the wire contract between the engine (Node, unchanged) and a front-end
// running out-of-process (the planned Go / Bubble Tea TUI). It exists so the engine's existing
// UI seam — the `cliEvents` emitter (src/cli/events.ts) + the GlobalPrompter approval round-trip
// — can be driven over a pipe instead of in-process, WITHOUT touching engine logic. Ink keeps
// working in-process; this is purely additive and only activates in headless mode.
//
// Transport is newline-delimited JSON (NDJSON): one JSON object per line, both directions. See
// codec.ts for framing and host.ts for the engine-side endpoint.

export const PROTOCOL_VERSION = 1;

// A JSON-safe value. The codec guarantees only these cross the wire (sanitizeArgs strips the rest).
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

// --- Outbound: engine → front-end ----------------------------------------------------------

/** A forwarded `cliEvents` emit. `name` is the event, `args` its (sanitized) payload. */
export interface EventMsg { t: 'event'; name: string; args: JsonValue[]; }

/**
 * An approval / ask-user request that needs an answer before the engine can continue. This is
 * the GlobalPrompter `veto_prompt` round-trip: its in-process `resolve` callback can't cross a
 * pipe, so it becomes a request `id` the front-end answers with a matching `reply`.
 */
export interface RequestMsg {
  t: 'request';
  id: number;
  kind: 'prompt' | 'diff' | 'input'; // option-select | diff-approval | free-form text
  question: string;
  options: string[];
  isAsk?: boolean;  // true for the AskUser tool (free-form) vs a governor yes/no/always veto
  body?: string;    // for kind:'diff', the unified diff to render before the choices
}

/** Handshake — sent once when the host attaches, so the front-end can version-check. */
export interface ReadyMsg { t: 'ready'; protocol: number; }

/** A single autocomplete candidate (slash command, @symbol, or @path). */
export interface CompletionItem {
  value: string; // the text to insert (e.g. "/git", "@handlePayment", "@./src/")
  label: string; // display label
  desc: string;  // short description / category
  kind: 'command' | 'symbol' | 'path';
}

/** Completions for a {@link QueryMsg}, correlated by `id` so stale results can be dropped. */
export interface QueryResultMsg { t: 'queryResult'; id: number; items: CompletionItem[]; }

export type Outbound = EventMsg | RequestMsg | ReadyMsg | QueryResultMsg;

// --- Inbound: front-end → engine -----------------------------------------------------------

/** The answer to a {@link RequestMsg}, correlated by `id`. */
export interface ReplyMsg { t: 'reply'; id: number; value: string; }

/** A submitted prompt line — a user turn OR a slash command (engine decides, as handleSubmit does). */
export interface InputMsg { t: 'input'; text: string; }

/** Cancel the in-flight turn (Ctrl-C / Esc in the front-end). */
export interface InterruptMsg { t: 'interrupt'; }

/** Ask the engine for autocomplete candidates for the current input `text`. */
export interface QueryMsg { t: 'query'; id: number; text: string; }

export type Inbound = ReplyMsg | InputMsg | InterruptMsg | QueryMsg;

// --- Event vocabulary ----------------------------------------------------------------------

// The serializable engine→UI signals forwarded verbatim (kept in sync with the contract block at
// the bottom of src/cli/events.ts). `veto_prompt` is intentionally absent — it carries a callback
// and is translated to a RequestMsg by the host instead.
export const FORWARDED_EVENTS: readonly string[] = [
  'log', 'message', 'tool_call', 'tool_call_result',
  'spinner_state', 'status', 'mode_change', 'model_tier', 'set_tier',
  'cost_update', 'todo_update', 'thinking', 'thinking_clear',
  'config_changed', 'graph_changed', 'cwd_changed', 'mcp_changed',
  'rerun_onboarding', 'shutdown', 'loop_detected', 'goals_changed',
  // Headless-only: the persona streams reply tokens through a direct callback in the Ink path;
  // in headless mode the driver re-emits each token here so the front-end can render the stream.
  'stream_token',
  // Footer state the Ink UI reads from engine singletons; snapshotted for out-of-process clients.
  'ui_snapshot',
];

/** Events the host special-cases into a {@link RequestMsg} (they carry a resolve callback). */
export const PROMPT_EVENT = 'veto_prompt';
export const DIFF_PROMPT_EVENT = 'diff_prompt';
export const INPUT_PROMPT_EVENT = 'input_prompt';

// React element brand — so a `message` event carrying a JSX `content`/`payload` doesn't blow up
// JSON.stringify; we replace it with a placeholder the front-end can render generically.
const REACT_ELEMENT = Symbol.for('react.element');

/**
 * Make an event's args safe to serialize: drop functions, replace React elements with a marker,
 * and let JSON handle the rest (Dates become ISO strings). Never throws — a value that can't be
 * cloned (e.g. a cycle) collapses to null rather than killing the stream.
 */
export function sanitizeArgs(args: any[]): JsonValue[] {
  const replacer = (_key: string, value: any): any => {
    if (typeof value === 'function') return undefined;
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object' && (value as any).$$typeof === REACT_ELEMENT) {
      return { __ui: (value as any).type?.name || 'component' };
    }
    return value;
  };
  return args.map(a => {
    try { return JSON.parse(JSON.stringify(a ?? null, replacer)); }
    catch { return null; }
  });
}
