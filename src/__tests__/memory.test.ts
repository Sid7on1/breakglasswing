import { ShortTermMemory } from '../memory/short.term';

describe('ShortTermMemory', () => {
  let memory: ShortTermMemory;

  beforeEach(() => {
    memory = new ShortTermMemory();
  });

  it('preserves system messages when pruning', () => {
    memory.addMessage('system', 'You are a helpful assistant.');
    
    // Add 50 user messages to trigger pruning (MAX_MESSAGES = 50)
    for (let i = 0; i < 50; i++) {
      memory.addMessage('user', `Message ${i}`);
    }

    const context = memory.getRecentContext(50);
    // Should still have the system message
    expect(context.filter(m => m.role === 'system').length).toBe(1);
    expect(context[0].content).toBe('You are a helpful assistant.');
  });
});
