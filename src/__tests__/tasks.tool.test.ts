import { createTasksTool } from '../tools/implementations/tasks.tool';
import { globalSubAgentBlackboard } from '../core/subagent.blackboard';

// A no-op governor stub — buildTool's wrapper only needs approveTaskExecution to resolve.
const governor: any = { approveTaskExecution: jest.fn().mockResolvedValue(undefined), mode: 'default' };
const tool = createTasksTool(governor);
const run = (args: any) => tool.execute(args);

describe('TasksTool — sub-agent management', () => {
  beforeEach(() => globalSubAgentBlackboard.clear());

  it('lists spawned sub-agents with status and coverage', async () => {
    globalSubAgentBlackboard.register('t1', 'BiMax', 'src/graph', 'map the graph layer');
    globalSubAgentBlackboard.register('t2', 'BiMax', 'src/mind', 'map the mind layer');
    globalSubAgentBlackboard.markDone('t1', 'graph mapped');

    const out = await run({ action: 'list' });
    expect(out).toContain('1 running · 2 total');
    expect(out).toContain('t1');
    expect(out).toContain('t2');
    expect(out).toContain('src/graph');
  });

  it('reports "none" when nothing was spawned', async () => {
    expect(await run({ action: 'list' })).toContain('No sub-agents spawned');
  });

  it('gets a finished agent\'s full result on demand', async () => {
    globalSubAgentBlackboard.register('t1', 'BiMax', '', 'do the thing');
    globalSubAgentBlackboard.markDone('t1', 'here is the full report body');
    const out = await run({ action: 'get', taskId: 't1' });
    expect(out).toContain('here is the full report body');
    expect(out).toContain('done');
  });

  it('reports a running agent has no result yet, and a failed agent its error', async () => {
    globalSubAgentBlackboard.register('r', 'BiMax', '', 'p');
    expect(await run({ action: 'get', taskId: 'r' })).toContain('Still running');
    globalSubAgentBlackboard.register('f', 'BiMax', '', 'p');
    globalSubAgentBlackboard.markFailed('f', 'boom');
    expect(await run({ action: 'get', taskId: 'f' })).toContain('boom');
  });

  it('waits efficiently until a running agent settles', async () => {
    globalSubAgentBlackboard.register('waited', 'BiMax', 'src', 'finish work');
    setTimeout(() => globalSubAgentBlackboard.markDone('waited', 'verified report'), 20);
    const out = await run({ action: 'wait', timeout_seconds: 1 });
    expect(out).toContain('Agent update');
    expect(out).toContain('waited');
    expect(out).toContain('[done]');
  });

  it('errors clearly on a missing taskId or unknown id', async () => {
    expect(await run({ action: 'get' })).toContain('requires a `taskId`');
    expect(await run({ action: 'get', taskId: 'nope' })).toContain('no sub-agent with id nope');
    expect(await run({ action: 'stop' })).toContain('requires a `taskId`');
  });

  it('refuses to stop an already-finished agent, stops a running one', async () => {
    globalSubAgentBlackboard.register('done', 'BiMax', '', 'p');
    globalSubAgentBlackboard.markDone('done', 'x');
    expect(await run({ action: 'stop', taskId: 'done' })).toContain('already done');

    globalSubAgentBlackboard.register('live', 'BiMax', '', 'p');
    const out = await run({ action: 'stop', taskId: 'live' });
    expect(out).toContain('Stopped sub-agent live');
    expect(globalSubAgentBlackboard.all().find(c => c.taskId === 'live')?.status).toBe('failed');
  });

  it('rejects an unknown action', async () => {
    expect(await run({ action: 'frobnicate' })).toContain('unknown action');
  });
});
