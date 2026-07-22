/**
 * Agent Client Protocol (ACP) method names and message shapes.
 *
 * ACP is Zed's open standard for editor↔agent communication (agentclientprotocol.com). The method
 * names and the SessionUpdate / StopReason / ContentBlock variants below are transcribed from the
 * surface Grok Build's xai-acp-lib implements (AGENT_METHOD_NAMES / CLIENT_METHOD_NAMES and the
 * AcpMethod enums) so a Bimax ACP agent speaks the exact same wire an editor already knows.
 *
 * Only the fields Bimax actually reads or writes are typed; unknown fields pass through untouched.
 */

/** Methods the editor (client) calls ON the agent. */
export const AgentMethod = {
  Initialize: 'initialize',
  Authenticate: 'authenticate',
  NewSession: 'session/new',
  LoadSession: 'session/load',
  SetSessionMode: 'session/set_mode',
  SetSessionModel: 'session/set_model',
  Prompt: 'session/prompt',
  Cancel: 'session/cancel', // notification (no response)
} as const;

/** Methods the agent calls ON the editor (client). */
export const ClientMethod = {
  SessionUpdate: 'session/update', // notification (streaming)
  RequestPermission: 'session/request_permission',
  ReadTextFile: 'fs/read_text_file',
  WriteTextFile: 'fs/write_text_file',
  CreateTerminal: 'terminal/create',
  TerminalOutput: 'terminal/output',
  ReleaseTerminal: 'terminal/release',
  WaitForTerminalExit: 'terminal/wait_for_exit',
  KillTerminal: 'terminal/kill',
} as const;

/** The ACP protocol version Bimax implements (major version negotiated in `initialize`). */
export const ACP_PROTOCOL_VERSION = 1;

// ---- initialize -------------------------------------------------------------------------------

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities?: {
    fs?: { readTextFile?: boolean; writeTextFile?: boolean };
    terminal?: boolean;
  };
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: {
    /** Agent can resume a previously-saved session via session/load. */
    loadSession?: boolean;
    promptCapabilities?: {
      /** Agent accepts image content blocks in a prompt. */
      image?: boolean;
      /** Agent accepts embedded resource content blocks. */
      embeddedContext?: boolean;
    };
    /**
     * Machine-readable session semantics (Bimax extension; unknown fields are ignored by
     * standard ACP clients). Bimax runs ONE engine conversation: sessions are not isolated or
     * concurrent — creating a new session SUPERSEDES (and resets) the previous one, and prompts
     * against superseded ids are rejected.
     */
    sessions?: {
      concurrent: boolean;
      isolated: boolean;
      model: 'single-supersede';
    };
  };
  /** Authentication methods the agent supports; empty = no auth needed. */
  authMethods: Array<{ id: string; name: string; description?: string | null }>;
}

// ---- sessions ---------------------------------------------------------------------------------

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
}

export interface NewSessionParams {
  cwd: string;
  mcpServers?: McpServerConfig[];
}
export interface NewSessionResult {
  sessionId: string;
}

export interface LoadSessionParams {
  sessionId: string;
  cwd: string;
  mcpServers?: McpServerConfig[];
}

export interface PromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

/** Why a prompt turn ended. */
export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';
export interface PromptResult {
  stopReason: StopReason;
}

export interface CancelParams {
  sessionId: string;
}

// ---- content blocks ---------------------------------------------------------------------------

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'audio'; mimeType: string; data: string }
  | { type: 'resource_link'; uri: string; name?: string }
  | { type: 'resource'; resource: { uri: string; text?: string; mimeType?: string } };

/** Extract the plain-text portion of a prompt's content blocks (what Bimax's turn engine consumes). */
export function promptText(blocks: ContentBlock[]): string {
  return (blocks || [])
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'resource_link') return `@${b.uri}`;
      if (b.type === 'resource' && b.resource?.text) return b.resource.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// ---- session/update (streaming, agent → editor) -----------------------------------------------

/** One streamed update within a turn. `sessionUpdate` tags the variant. */
export type SessionUpdate =
  | { sessionUpdate: 'agent_message_chunk'; content: ContentBlock }
  | { sessionUpdate: 'agent_thought_chunk'; content: ContentBlock }
  | { sessionUpdate: 'user_message_chunk'; content: ContentBlock }
  | { sessionUpdate: 'tool_call'; toolCallId: string; title: string; status?: ToolCallStatus; kind?: string; rawInput?: unknown }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; status?: ToolCallStatus; content?: ToolCallContent[]; rawOutput?: unknown }
  | { sessionUpdate: 'plan'; entries: Array<{ content: string; priority?: string; status?: string }> };

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type ToolCallContent = { type: 'content'; content: ContentBlock };

export interface SessionUpdateParams {
  sessionId: string;
  update: SessionUpdate;
}

// ---- session/request_permission (agent → editor) ----------------------------------------------

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: { toolCallId: string; title: string };
  options: Array<{ optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }>;
}
export type RequestPermissionResult =
  | { outcome: { outcome: 'selected'; optionId: string } }
  | { outcome: { outcome: 'cancelled' } };

// ---- helpers to build update params -----------------------------------------------------------

export function agentMessageChunk(sessionId: string, text: string): SessionUpdateParams {
  return { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } };
}
export function agentThoughtChunk(sessionId: string, text: string): SessionUpdateParams {
  return { sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } } };
}

/** ACP tool-call kinds (drive the editor's icon/affordance). Bimax tool names are mapped heuristically. */
export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';

/** Best-effort map from a Bimax tool name to an ACP tool kind. Unknown tools fall back to 'other'. */
export function toolKind(toolName: string): ToolKind {
  const n = (toolName || '').toLowerCase();
  if (/read|cat|view|open|lsp|graph|scout|search|grep|find|glob|toolsearch/.test(n)) {
    return /search|grep|find|glob|scout|toolsearch/.test(n) ? 'search' : 'read';
  }
  if (/delete|remove|\brm\b/.test(n)) return 'delete';
  if (/move|rename|\bmv\b/.test(n)) return 'move';
  if (/edit|write|apply|patch|create|str_replace/.test(n)) return 'edit';
  if (/bash|shell|exec|run|command|terminal|computer|train|browser/.test(n)) return 'execute';
  if (/web|fetch|http|url|download/.test(n)) return 'fetch';
  if (/think|plan|reason/.test(n)) return 'think';
  return 'other';
}

/** Parse a tool's input (a JSON string, or already-object) into rawInput; never throws. */
function toRawInput(input: unknown): unknown {
  if (input == null) return undefined;
  if (typeof input !== 'string') return input;
  const s = input.trim();
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return { input: s }; }
}

/** A tool call has started (status in_progress). Editors render it in the live tool timeline. */
export function toolCallStart(sessionId: string, toolCallId: string, toolName: string, input: unknown): SessionUpdateParams {
  return {
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: toolName,
      status: 'in_progress',
      kind: toolKind(toolName),
      rawInput: toRawInput(input),
    },
  };
}

/** A tool call has finished — carries the completed/failed status and its output text. */
export function toolCallUpdate(sessionId: string, toolCallId: string, isError: boolean, output: string): SessionUpdateParams {
  return {
    sessionId,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: isError ? 'failed' : 'completed',
      content: output ? [{ type: 'content', content: { type: 'text', text: output } }] : [],
    },
  };
}
