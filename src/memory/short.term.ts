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
    return this.messages.slice(-count);
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

    this.messages = [...systemMessages, ...keepMessages];
  }
}
