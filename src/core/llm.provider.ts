import { ContentPart } from './multimodal';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  // String for text turns (the overwhelming common case); an OpenAI content-part array only for a
  // user turn that carries image attachments (see core/multimodal.ts). All text-path transforms
  // guard on `typeof content === 'string'`, so the array form is inert outside the vision flow.
  content?: string | ContentPart[];
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
  lite?: boolean; // route this call to the configured LITE model (cheap aux work), if one is set
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
