

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
  signal?: AbortSignal;
}

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: string } // Note: args comes in as a string
  | { type: 'usage'; prompt: number; completion: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done' };

export interface LLMProvider {
  chat(messages: Message[], options: ChatOptions): AsyncGenerator<ChatEvent>;
}
