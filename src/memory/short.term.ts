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
    if (this.messages.length > this.MAX_MESSAGES) {
      console.log(`[ShortTermMemory] Pruning old messages to stay under token limit.`);
      
      const systemMessages = this.messages.filter(m => m.role === 'system');
      const otherMessages = this.messages.filter(m => m.role !== 'system');
      
      const retainCount = this.MAX_MESSAGES - systemMessages.length;
      
      if (retainCount > 0) {
        this.messages = [...systemMessages, ...otherMessages.slice(-retainCount)];
      } else {
        this.messages = [...systemMessages];
      }
    }
  }
}
