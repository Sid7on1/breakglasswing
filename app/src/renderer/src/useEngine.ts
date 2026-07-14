import { useEffect, useReducer, useRef, useCallback } from 'react';
import {
  Outbound, RequestMsg, CompletionItem, MessageEntry, ToolCallEntry, UiSnapshot, SubAgentClaim,
  EngineConfig, PROTOCOL_VERSION,
} from './protocol';

/**
 * The renderer's engine state machine: consumes protocol Outbound messages from the preload
 * bridge and folds them into one UI state object. This is the App-side equivalent of the Go
 * TUI's model.go update loop, reduced to the foundation feature set.
 */

export type TranscriptItem =
  | { kind: 'msg'; msg: MessageEntry; menuChosen?: string; thought?: string }
  | { kind: 'tool'; call: ToolCallEntry };

export interface EngineUiState {
  items: TranscriptItem[];
  streaming: string;            // in-flight assistant reply (stream_token accumulation)
  thinking: string;             // reasoning-channel text for the current turn
  spinner: { state: string; message: string };
  status: string;
  snapshot: UiSnapshot | null;
  todos: { content?: string; status?: string }[];
  subagents: SubAgentClaim[];
  request: RequestMsg | null;   // pending approval/ask modal
  completions: { id: number; items: CompletionItem[] };
  engine: { state: string; detail: string };
  protocolMismatch: number | null; // engine's protocol version when it differs from ours
  mode: string;
  tier: string;
  streamedChars: number;
  project: string;
}

const initial: EngineUiState = {
  items: [],
  streaming: '',
  thinking: '',
  spinner: { state: 'idle', message: '' },
  status: '',
  snapshot: null,
  todos: [],
  subagents: [],
  request: null,
  completions: { id: 0, items: [] },
  engine: { state: 'starting', detail: '' },
  protocolMismatch: null,
  mode: '',
  tier: '',
  streamedChars: 0,
  project: '',
};

type Action =
  | { type: 'outbound'; msg: Outbound }
  | { type: 'engineState'; state: string; detail: string }
  | { type: 'project'; dir: string }
  | { type: 'localUser'; text: string }
  | { type: 'closeRequest' }
  | { type: 'statusClear' }
  | { type: 'menuChosen'; id: string; value: string }
  | { type: 'clearCompletions' };

function upsertTool(items: TranscriptItem[], call: ToolCallEntry): TranscriptItem[] {
  const idx = items.findIndex((it) => it.kind === 'tool' && it.call.id === call.id);
  if (idx === -1) return [...items, { kind: 'tool', call }];
  const next = items.slice();
  next[idx] = { kind: 'tool', call };
  return next;
}

function onEvent(state: EngineUiState, name: string, args: any[]): EngineUiState {
  switch (name) {
    case 'message': {
      const msg = args[0] as MessageEntry;
      if (!msg) return state;
      // A final assistant message supersedes the in-flight stream buffer and adopts the turn's
      // reasoning text so the "Thought for Ns" line can expand to the actual thoughts.
      const streaming = msg.role === 'assistant' ? '' : state.streaming;
      const thought = msg.role === 'assistant' && state.thinking ? state.thinking : undefined;
      return { ...state, items: [...state.items, { kind: 'msg', msg, thought }], streaming, thinking: '' };
    }
    case 'stream_token':
      return { ...state, streaming: state.streaming + String(args[0] ?? '') };
    case 'tool_call':
    case 'tool_call_result':
      return args[0] ? { ...state, items: upsertTool(state.items, args[0] as ToolCallEntry) } : state;
    case 'thinking':
      return { ...state, thinking: state.thinking + String(args[0] ?? '') };
    case 'thinking_clear':
      return { ...state, thinking: '' };
    case 'spinner_state':
      return { ...state, spinner: { state: String(args[0] ?? 'idle'), message: String(args[1] ?? '') } };
    case 'status':
      return { ...state, status: String(args[0] ?? '') };
    case 'clear':
      return { ...state, items: [], streaming: '', thinking: '', streamedChars: 0 };
    case 'ui_snapshot':
      return { ...state, snapshot: args[0] as UiSnapshot };
    case 'todo_update':
      return { ...state, todos: Array.isArray(args[0]) ? args[0] : [] };
    case 'subagent_update':
      return { ...state, subagents: Array.isArray(args[0]) ? (args[0] as SubAgentClaim[]) : [] };
    case 'mode_change':
      return { ...state, mode: String(args[0] ?? '') };
    case 'model_tier':
      return { ...state, tier: String(args[0]?.tier ?? '') };
    case 'cost_update':
      return { ...state, streamedChars: state.streamedChars + Number(args[0] ?? 0) };
    default:
      return state; // log, graph_changed, config_changed, … — no transcript rendering needed yet
  }
}

function reducer(state: EngineUiState, action: Action): EngineUiState {
  switch (action.type) {
    case 'outbound': {
      const m = action.msg;
      switch (m.t) {
        case 'ready':
          return {
            ...state,
            engine: { state: 'ready', detail: '' },
            protocolMismatch: m.protocol !== PROTOCOL_VERSION ? m.protocol : null,
          };
        case 'event':
          return onEvent(state, m.name, m.args);
        case 'request':
          return { ...state, request: m };
        case 'queryResult':
          // Drop stale results: only the latest query id may populate the dropdown.
          return m.id >= state.completions.id
            ? { ...state, completions: { id: m.id, items: m.items } }
            : state;
        default:
          return state;
      }
    }
    case 'engineState':
      return { ...state, engine: { state: action.state, detail: action.detail } };
    case 'project':
      return { ...state, project: action.dir, items: [], streaming: '', thinking: '', todos: [] };
    case 'localUser': {
      const msg: MessageEntry = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: action.text,
        timestamp: new Date().toISOString(),
      };
      return { ...state, items: [...state.items, { kind: 'msg', msg }] };
    }
    case 'closeRequest':
      return { ...state, request: null };
    case 'statusClear':
      return { ...state, status: '' };
    case 'menuChosen':
      return {
        ...state,
        items: state.items.map((it) =>
          it.kind === 'msg' && it.msg.id === action.id ? { ...it, menuChosen: action.value } : it,
        ),
      };
    case 'clearCompletions':
      return { ...state, completions: { id: state.completions.id, items: [] } };
    default:
      return state;
  }
}

export function useEngine() {
  const [state, dispatch] = useReducer(reducer, initial);
  const queryId = useRef(0);
  // Config round-trips (protocol v3) resolve promises instead of flowing through the reducer —
  // settings pages await them directly; nothing renders in the transcript.
  const configId = useRef(0);
  const configPending = useRef(new Map<number, (cfg: EngineConfig) => void>());

  useEffect(() => {
    const offMsg = window.bimax.onMessage((msg) => {
      if (msg.t === 'configResult') {
        const resolve = configPending.current.get(msg.id);
        if (resolve) { configPending.current.delete(msg.id); resolve(msg.config as EngineConfig); }
        return;
      }
      dispatch({ type: 'outbound', msg });
    });
    const offState = window.bimax.onEngineState((s, d) => dispatch({ type: 'engineState', state: s, detail: d }));
    const offProject = window.bimax.onProject((dir) => dispatch({ type: 'project', dir }));
    void window.bimax.getProject().then((dir) => dispatch({ type: 'project', dir }));
    window.bimax.rendererReady();
    return () => { offMsg(); offState(); offProject(); };
  }, []);

  // Footer statuses are ephemeral (TUI parity): self-clear ~10s after the last update.
  useEffect(() => {
    if (!state.status) return;
    const id = setTimeout(() => dispatch({ type: 'statusClear' }), 10000);
    return () => clearTimeout(id);
  }, [state.status]);

  const submit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    dispatch({ type: 'localUser', text: trimmed });
    window.bimax.send({ t: 'input', text: trimmed });
    dispatch({ type: 'clearCompletions' });
  }, []);

  const interrupt = useCallback(() => window.bimax.send({ t: 'interrupt' }), []);

  // Chrome-initiated commands (/mode, /clear, palette executions): straight to the engine, no
  // local user bubble — the engine's own messages/status are the feedback.
  const sendCommand = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed) window.bimax.send({ t: 'input', text: trimmed });
  }, []);

  const query = useCallback((text: string) => {
    const id = ++queryId.current;
    window.bimax.send({ t: 'query', id, text });
  }, []);

  const reply = useCallback((id: number, value: string) => {
    window.bimax.send({ t: 'reply', id, value });
    dispatch({ type: 'closeRequest' });
  }, []);

  const menuSelect = useCallback((id: string, value: string) => {
    window.bimax.send({ t: 'menuSelect', id, value });
    dispatch({ type: 'menuChosen', id, value });
  }, []);

  const clearCompletions = useCallback(() => dispatch({ type: 'clearCompletions' }), []);

  const configRoundTrip = useCallback((send: (id: number) => void): Promise<EngineConfig> => {
    const id = ++configId.current;
    return new Promise<EngineConfig>((resolve) => {
      configPending.current.set(id, resolve);
      send(id);
      // Old engine (pre-v3) never answers — resolve empty after 3s so settings shows its
      // "engine too old" state instead of spinning forever.
      setTimeout(() => {
        if (configPending.current.has(id)) { configPending.current.delete(id); resolve({}); }
      }, 3000);
    });
  }, []);

  const configGet = useCallback(
    () => configRoundTrip((id) => window.bimax.send({ t: 'configGet', id })),
    [configRoundTrip],
  );

  const configSet = useCallback(
    (patch: EngineConfig) => configRoundTrip((id) => window.bimax.send({ t: 'configSet', id, patch: patch as any })),
    [configRoundTrip],
  );

  return { state, submit, interrupt, sendCommand, query, reply, menuSelect, clearCompletions, configGet, configSet };
}
