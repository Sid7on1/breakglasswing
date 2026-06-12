import { EventEmitter } from 'events';
import { appStore } from '../state/app.state';

class AppEventEmitter extends EventEmitter {
  emit(event: string | symbol, ...args: any[]): boolean {
    const result = super.emit(event, ...args);
    
    // Bridge to new appStore state
    try {
      if (event === 'log') {
        const payload = args[0];
        if (typeof payload === 'string') {
          appStore.setState(prev => ({
            logs: [...prev.logs, { id: Date.now() + Math.random(), level: 'info', text: payload, timestamp: new Date() }]
          }));
        } else if (payload && payload.text) {
          appStore.setState(prev => ({
            logs: [...prev.logs, payload]
          }));
        }
      } else if (event === 'message') {
        appStore.setState(prev => ({
          messages: [...prev.messages, args[0]]
        }));
      } else if (event === 'spinner_state') {
        appStore.setState({ spinner: { status: args[0], message: args[1] || '' } });
      } else if (event === 'status') {
        appStore.setState({ statusText: args[0] });
      } else if (event === 'veto_prompt') {
        appStore.setState({ vetoResolver: { question: args[0], options: args[1], resolve: args[2] } });
      } else if (event === 'tool_call') {
        const tc = args[0];
        appStore.setState(prev => {
          const arr = [...prev.streamingToolCalls];
          const idx = arr.findIndex(t => t.id === tc.id);
          if (idx !== -1) arr[idx] = tc; else arr.push(tc);
          return { streamingToolCalls: arr };
        });
      } else if (event === 'tool_call_result') {
        const tc = args[0];
        appStore.setState(prev => {
          const arr = [...prev.streamingToolCalls];
          const idx = arr.findIndex(t => t.id === tc.id);
          if (idx !== -1) arr[idx] = tc;
          return { streamingToolCalls: arr };
        });
      }
    } catch (e) {
      // Ignore bridging errors
    }
    
    return result;
  }
}

export const cliEvents = new AppEventEmitter();

export type AgentState = 'idle' | 'thinking' | 'decomposing' | 'executing' | 'vetoing' | 'blocked' | 'responding';

export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

export interface LogEntry {
  id: number;
  level: LogLevel;
  text: string;
  timestamp: Date;
}

export interface ToolCallEntry {
  id: string;
  toolName: string;
  input: string;
  output: string;
  status: 'running' | 'success' | 'error';
  startTime: Date;
  endTime?: Date;
}

export interface MessageEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  level?: 'info' | 'warn' | 'error' | 'success';
  uiComponent?: string;
  payload?: any;
  content: string | React.ReactNode;
  toolCalls?: ToolCallEntry[];
  timestamp: Date;
}

// Events:
// - log: (entry: LogEntry) => Appends to log stream
// - message: (msg: MessageEntry) => New chat message
// - tool_call: (call: ToolCallEntry) => Tool call update
// - veto_prompt: (question: string, options: string[], resolve: (answer: string) => void) => Triggers permission overlay
// - veto_answer: (answer: string) => Governor veto response
// - clear: () => Clears logs
// - spinner_state: (state: AgentState, message?: string) => Updates the AgentSpinner
// - search: (query: string) => Search transcript
// - mode_change: (mode: string) => Mode change
// - status: (text: string) => Status bar update
// - stash: () => Stash current prompt
// - resume_stashed: () => Resume stashed prompt
// - shutdown: () => Graceful shutdown
// - diff: (diffText: string) => Display inline diff
