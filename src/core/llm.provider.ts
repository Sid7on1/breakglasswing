

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}

export interface ChatOptions {
  system?: string;
  tools?: any[]; // We'll pass the JSON Schema tool definitions here
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string; // 'low' | 'medium' | 'high' — when set, sent as reasoning_effort
  signal?: AbortSignal;
}

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string } // Model's internal reasoning — never show as the reply
  | { type: 'tool_call'; id: string; name: string; args: string } // Note: args comes in as a string
  | { type: 'usage'; prompt: number; completion: number }
  // `kind` tells the agent loop *how* to recover: 'context' → compact and retry;
  // 'transient' → bounded re-ask (new key / re-sampled output). Absent when fatal.
  | { type: 'error'; message: string; recoverable: boolean; kind?: 'context' | 'transient' }
  | { type: 'done' };

export interface LLMProvider {
  chat(messages: Message[], options: ChatOptions): AsyncGenerator<ChatEvent>;
}
