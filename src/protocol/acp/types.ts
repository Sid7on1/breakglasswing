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
