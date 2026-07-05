import { extractTaskRef, awaitTaskResult } from '../mcp/tasks';

/**
 * MCP Tasks extension: task-shaped tools/call responses are polled to a terminal state and the
 * real result is fetched — long-running server-side work behaves like a normal (slower) tool call.
 */
describe('MCP Tasks extension', () => {
  describe('extractTaskRef', () => {
    it('reads the spec shape (result.task.taskId)', () => {
      expect(extractTaskRef({ task: { taskId: 't-1', status: 'working' } }))
        .toEqual({ taskId: 't-1', status: 'working' });
    });

    it('reads the _meta fallback shape', () => {
      expect(extractTaskRef({ _meta: { 'io.modelcontextprotocol/task': { taskId: 't-2' } } }))
        .toEqual({ taskId: 't-2', status: undefined });
    });

    it('returns null for ordinary inline results', () => {
      expect(extractTaskRef({ content: [{ type: 'text', text: 'hi' }] })).toBeNull();
      expect(extractTaskRef(null)).toBeNull();
      expect(extractTaskRef({ task: {} })).toBeNull();
    });
  });

  describe('awaitTaskResult', () => {
    // A mock MCP client whose tasks/get walks through a scripted status sequence.
    function mockClient(statuses: string[], result: any) {
      let i = 0;
      const calls: any[] = [];
      return {
        calls,
        request: async (req: any) => {
          calls.push(req);
          if (req.method === 'tasks/get') {
            const status = statuses[Math.min(i++, statuses.length - 1)];
            return { task: { taskId: req.params.taskId, status } };
          }
          if (req.method === 'tasks/result') return result;
          throw new Error(`unexpected method ${req.method}`);
        },
      };
    }

    it('polls working → completed and returns the fetched result', async () => {
      const client = mockClient(['working', 'working', 'completed'], { content: [{ type: 'text', text: 'built!' }] });
      const res = await awaitTaskResult(client, 'srv', 'build', { taskId: 't-9' }, 30_000);
      expect(res.content[0].text).toBe('built!');
      expect(client.calls.filter(c => c.method === 'tasks/get')).toHaveLength(3);
      expect(client.calls.at(-1).method).toBe('tasks/result');
    });

    it('unwraps a result nested under `result`', async () => {
      const client = mockClient(['completed'], { result: { content: [{ type: 'text', text: 'nested' }] } });
      const res = await awaitTaskResult(client, 'srv', 'q', { taskId: 't-8' }, 30_000);
      expect(res.content[0].text).toBe('nested');
    });

    it('throws on a failed task', async () => {
      const client = mockClient(['working', 'failed'], {});
      await expect(awaitTaskResult(client, 'srv', 'deploy', { taskId: 't-7' }, 30_000))
        .rejects.toThrow(/ended failed/);
    });

    it('throws with guidance on input_required', async () => {
      const client = mockClient(['input_required'], {});
      await expect(awaitTaskResult(client, 'srv', 'wizard', { taskId: 't-6' }, 30_000))
        .rejects.toThrow(/needs additional input/);
    });

    it('times out when the task never terminates', async () => {
      const client = mockClient(['working'], {});
      await expect(awaitTaskResult(client, 'srv', 'slow', { taskId: 't-5' }, 1200))
        .rejects.toThrow(/did not finish within/);
    }, 10_000);

    it('skips polling entirely when the ref already arrived terminal', async () => {
      const client = mockClient([], { content: [{ type: 'text', text: 'instant' }] });
      const res = await awaitTaskResult(client, 'srv', 'fast', { taskId: 't-4', status: 'completed' }, 5_000);
      expect(res.content[0].text).toBe('instant');
      expect(client.calls.filter(c => c.method === 'tasks/get')).toHaveLength(0);
    });
  });
});
