// BiMax UI protocol — the wire contract between the engine (Node) and the out-of-process
// front-end (the Go / Bubble Tea TUI in tui/). It exists so the engine's UI seam — the
// `cliEvents` emitter (src/cli/events.ts) + the GlobalPrompter approval round-trip — can be
// driven over a pipe instead of in-process, WITHOUT touching engine logic. This is the sole
// interactive path; it activates in headless mode, which the TUI always spawns.
//
// Transport is newline-delimited JSON (NDJSON): one JSON object per line, both directions. See
// codec.ts for framing and host.ts for the engine-side endpoint.

// v2 (2026-07-10): ui_snapshot gains optional sessions / checkpoints / git fields (all additive —
// a v1 front-end ignores them; a v2 front-end hides the matching UI when they're absent).
// v3 (2026-07-11): silent config round-trip — configGet/configSet inbound + configResult outbound,
// so graphical front-ends drive settings pages without printing menus into the transcript.
// v3 additive (2026-07-12): `boot` + `health` outbound (startup progress + liveness heartbeat for
// the desktop supervisor) and `resume` inbound (typed session-resume, so front-ends never have to
// synthesize a slash command). All additive — a front-end that doesn't know them ignores them, an
// engine that predates `resume` drops it — so the version stays 3.
export const PROTOCOL_VERSION = 3;

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
  isMulti?: boolean; // true for multi-select checklists
  body?: string;    // for kind:'diff', the unified diff to render before the choices
  masked?: boolean; // for kind:'input': the answer is a secret — render it as bullets, never echo
}

/** Handshake — sent once when the host attaches, so the front-end can version-check. */
export interface ReadyMsg { t: 'ready'; protocol: number; }

/** A single autocomplete candidate (slash command, @symbol, or @path). */
export interface CompletionItem {
  value: string; // the text to insert (e.g. "/git", "@handlePayment", "@./src/")
  label: string; // display label
  desc: string;  // short description / category
  kind: 'command' | 'symbol' | 'path';
  disabled?: boolean;
  disabledReason?: string;
}

/** Completions for a {@link QueryMsg}, correlated by `id` so stale results can be dropped. */
export interface QueryResultMsg { t: 'queryResult'; id: number; items: CompletionItem[]; }

/** Liveness answer to a {@link PingMsg} — echoes `id` so the front-end can match it. */
export interface PongMsg { t: 'pong'; id: number; }

/**
 * The engine's settings, answering a {@link ConfigGetMsg} or {@link ConfigSetMsg} — only the
 * allowlisted, JSON-safe subset of CliConfig crosses the wire (headless.entry owns the list).
 */
export interface ConfigResultMsg { t: 'configResult'; id: number; config: { [k: string]: JsonValue }; }

/**
 * Startup progress. Emitted on stdout BEFORE the protocol host attaches (boot.status.ts writes it
 * directly), so a supervising front-end can show real phases instead of an indefinite spinner.
 * Phases arrive in order; `ready` (the handshake) supersedes them all.
 */
export interface BootMsg {
  t: 'boot';
  phase: 'booting' | 'loading_storage' | 'loading_graph' | 'loading_tools' | 'loading_interface' | 'restoring_session';
  detail?: string;
  pid: number;
}

/**
 * Periodic liveness heartbeat, emitted every few seconds once the engine is interactive. A stalled
 * stream of these means the event loop is wedged (or the process is gone) — the supervising
 * front-end distinguishes that from legitimate long work via `activeTurn`.
 */
export interface HealthMsg {
  t: 'health';
  uptimeMs: number;
  rssMb: number;
  heapMb: number;
  eventLoopDelayMs: number; // p99 event-loop delay since the last heartbeat
  activeTurn: boolean;      // a user turn is executing (long work is expected)
  phase: 'ready';
}

export type Outbound = EventMsg | RequestMsg | ReadyMsg | QueryResultMsg | PongMsg | ConfigResultMsg | BootMsg | HealthMsg;

// --- Inbound: front-end → engine -----------------------------------------------------------

/** The answer to a {@link RequestMsg}, correlated by `id`. */
export interface ReplyMsg { t: 'reply'; id: number; value: string; }

/** A submitted prompt line — a user turn OR a slash command (engine decides, as handleSubmit does). */
export interface InputMsg { t: 'input'; text: string; }

/** Cancel the in-flight turn (Ctrl-C / Esc in the front-end). */
export interface InterruptMsg { t: 'interrupt'; }

/** Ask the engine for autocomplete candidates for the current input `text`. */
export interface QueryMsg { t: 'query'; id: number; text: string; }

/**
 * The user picked an option in an interactive menu. `id` correlates to the menu the engine emitted;
 * `value` is the chosen option's value. The engine runs that menu's `onSelect` (which can't cross the
 * wire as a callback) — falling back to dispatching `value` as a command for menus that have none.
 */
export interface MenuSelectMsg { t: 'menuSelect'; id: string; value: string; }

/**
 * Liveness probe from the front-end. Answered immediately with a {@link PongMsg} — if the answer
 * doesn't come back, the engine's event loop is wedged (or the process is a zombie) and the
 * front-end can tell the user instead of showing a spinner forever.
 */
export interface PingMsg { t: 'ping'; id: number; }

/** Read the engine's settings (allowlisted subset) — answered with a {@link ConfigResultMsg}. */
export interface ConfigGetMsg { t: 'configGet'; id: number; }

/**
 * Write settings: `patch` merges into the engine config (allowlisted keys only; unknown keys are
 * dropped, never errors). Answered with the post-write {@link ConfigResultMsg} and followed by a
 * `config_changed` event so every attached front-end (and ui_snapshot) refreshes.
 */
export interface ConfigSetMsg { t: 'configSet'; id: number; patch: { [k: string]: JsonValue }; }

/**
 * Resume a saved session by id — the typed equivalent of the user running /resume. Lets a
 * graphical front-end's recovery flow restore a thread without synthesizing slash-command text.
 * Ignored (never an error) when the id doesn't resolve to a saved session.
 */
export interface ResumeMsg { t: 'resume'; id: string; }

/**
 * Atomically apply shell controls. A graphical front-end must not synthesize several independent
 * slash-command messages for one autonomy preset: those dispatch concurrently and can leave the
 * governor, plan mode, and diff gate disagreeing. The headless session serializes this one request.
 */
export interface ControlsMsg {
  t: 'controls';
  mode?: 'general' | 'explore' | 'sketch' | 'code' | 'beast';
  tier?: 'auto' | 'lite' | 'heavy';
  autonomy?: 'ask' | 'auto' | 'plan' | 'full';
}

export type Inbound = ReplyMsg | InputMsg | InterruptMsg | QueryMsg | MenuSelectMsg | PingMsg | ConfigGetMsg | ConfigSetMsg | ResumeMsg | ControlsMsg;

// --- Event vocabulary ----------------------------------------------------------------------

// The serializable engine→UI signals forwarded verbatim (kept in sync with the contract block at
// the bottom of src/cli/events.ts). `veto_prompt` is intentionally absent — it carries a callback
// and is translated to a RequestMsg by the host instead.
export const FORWARDED_EVENTS: readonly string[] = [
  'log', 'message', 'tool_call', 'tool_call_result',
  'spinner_state', 'status', 'mode_change', 'model_tier', 'set_tier',
  'cost_update', 'todo_update', 'subagent_update', 'thinking', 'thinking_clear',
  'config_changed', 'graph_changed', 'cwd_changed', 'mcp_changed',
  'rerun_onboarding', 'shutdown', 'loop_detected', 'goals_changed',
  // /clear wipes the front-end transcript (the engine has no in-process UI to intercept it).
  'clear',
  // True resume: `{ id, entries }` — the saved thread's transcript (messages + tool lines) so a
  // graphical front-end can rebuild its scrollback, not just inject invisible context.
  'session_restore',
  // Review domain: the current thread's derived review snapshot (plan, approvals, attributed
  // changes, verification runs, checkpoint state). Always a FULL snapshot — a reconnecting
  // front-end is correct again on the next emit.
  'review_update',
  // Outcome domain: compact full snapshot of the active contract, acceptance gate, task/gap counts,
  // iteration and blocker. Null means this thread has no substantial outcome contract yet.
  'outcome_update',
  // The driver re-emits each reply token here so the out-of-process front-end can render the stream.
  'stream_token',
  // Footer state read from engine singletons; snapshotted for the out-of-process front-end.
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
    // Fast path: primitives are already JSON-safe, so skip the stringify→parse clone. This runs
    // once per streamed token (the hottest event on the wire) — avoiding two JSON passes per token
    // is the cheapest real win here; the final encode() stringifies the whole message exactly once.
    if (a == null) return null;
    const t = typeof a;
    if (t === 'string' || t === 'number' || t === 'boolean') return a;
    if (t === 'bigint') return (a as bigint).toString();
    if (t === 'function') return null;
    // Objects/arrays: clone through JSON to drop functions, mark React elements, ISO-ify Dates.
    try { return JSON.parse(JSON.stringify(a, replacer)); }
    catch { return null; }
  });
}
