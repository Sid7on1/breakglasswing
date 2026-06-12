export interface Message {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

export class ShortTermMemory {
  private messages: Message[] = [];
  private readonly MAX_MESSAGES = 50;

  addMessage(role: 'user' | 'agent' | 'system', content: string) {
    this.messages.push({ role, content, timestamp: Date.now() });
    this.prune();
  }

  getRecentContext(count: number = 10): Message[] {
    // System messages are always preserved; the remaining budget goes to the newest messages.
    const systemMessages = this.messages.filter(m => m.role === 'system');
    const otherMessages = this.messages.filter(m => m.role !== 'system');
    const remaining = Math.max(0, count - systemMessages.length);
    return [...systemMessages, ...otherMessages.slice(-remaining)];
  }

  private prune() {
    let totalTokens = 0;
    const MAX_TOKENS = 40000; // Sliding window target

    // Keep system messages
    const systemMessages = this.messages.filter(m => m.role === 'system');
    const otherMessages = this.messages.filter(m => m.role !== 'system');

    // Count system tokens
    for (const msg of systemMessages) {
      totalTokens += Math.ceil(msg.content.length / 4);
    }

    const keepMessages: Message[] = [];
    
    // Slide from the newest to oldest until we hit the budget
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const tokens = Math.ceil(msg.content.length / 4);
      
      if (totalTokens + tokens > MAX_TOKENS) {
        console.log(`[ShortTermMemory] Sliding window met token limit (${MAX_TOKENS}). Dropping older context.`);
        break;
      }
      
      totalTokens += tokens;
      keepMessages.unshift(msg);
    }

    // Enforce the message-count cap on top of the token budget
    const maxOthers = Math.max(0, this.MAX_MESSAGES - systemMessages.length);
    this.messages = [...systemMessages, ...keepMessages.slice(-maxOthers)];
  }
}
