import { createSpawnSubagentTool } from '../tools/implementations/spawn.tool';
import { globalSubAgentManager, MAX_SUBAGENT_DEPTH } from '../core/subagent.manager';
import { ToolRegistry } from '../tools/tool.registry';

/**
 * Nested sub-agents (3-level agent trees): the spawn tool tags every child with depth = own+1
 * and refuses to deepen the tree past MAX_SUBAGENT_DEPTH — main session (0) → worker (1) →
 * nested worker (2), and a depth-2 agent cannot spawn.
 */
describe('SpawnSubagentTool — agent-tree depth', () => {
  const governor: any = { approveTaskExecution: async () => {}, mode: 'default' };
  let spawnSpy: jest.SpyInstance;

  beforeEach(() => {
    spawnSpy = jest.spyOn(globalSubAgentManager, 'spawnWorker').mockResolvedValue({
      version: 1, taskId: 'mock', agentType: 'BiMax', report: 'done', claimedScope: '',
      observedChangedFiles: [], startedAt: 1, endedAt: 2, toolCalls: 0,
    });
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    delete process.env.BIMAX_SUBAGENT_DEPTH;
  });

  function makeTool() {
    return createSpawnSubagentTool(governor, new ToolRegistry(), {} as any);
  }

  it('main session (depth 0) spawns a child tagged depth 1', async () => {
    delete process.env.BIMAX_SUBAGENT_DEPTH;
    const out = await makeTool().execute({ prompt: 'do a thing' }, { cwd: process.cwd() });
    expect(String(out)).toContain('TASK_QUEUED');
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0][1].depth).toBe(1);
  });

  it('a depth-1 worker spawns a grandchild tagged depth 2', async () => {
    process.env.BIMAX_SUBAGENT_DEPTH = '1';
    const out = await makeTool().execute({ prompt: 'go deeper' }, { cwd: process.cwd() });
    expect(String(out)).toContain('TASK_QUEUED');
    expect(spawnSpy.mock.calls[0][1].depth).toBe(2);
  });

  it('a depth-2 agent is refused — the tree caps at 3 levels', async () => {
    process.env.BIMAX_SUBAGENT_DEPTH = '2';
    const out = await makeTool().execute({ prompt: 'too deep' }, { cwd: process.cwd() });
    expect(String(out)).toContain(`Maximum agent-tree depth (${MAX_SUBAGENT_DEPTH}`);
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
