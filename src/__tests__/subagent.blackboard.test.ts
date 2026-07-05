import { SubAgentBlackboard, scopesOverlap } from '../core/subagent.blackboard';

describe('scopesOverlap', () => {
  it('detects equal, prefix, and disjoint scopes', () => {
    expect(scopesOverlap('src/graph', 'src/graph')).toBe(true);
    expect(scopesOverlap('src', 'src/graph')).toBe(true);       // parent contains child
    expect(scopesOverlap('src/graph/x', 'src/graph')).toBe(true);
    expect(scopesOverlap('src/graph', 'src/mind')).toBe(false); // siblings — disjoint
    expect(scopesOverlap('./src/graph/', 'src/graph')).toBe(true); // normalization
    expect(scopesOverlap('a, b, c', 'x, y, b')).toBe(true);     // any shared token
  });
});

describe('SubAgentBlackboard', () => {
  it('tracks lifecycle and reports overlapping running claims', () => {
    const bb = new SubAgentBlackboard();
    bb.register('t1', 'BiMax', 'src/graph', 'map the graph layer');
    bb.register('t2', 'BiMax', 'src/mind', 'map the mind layer');
    expect(bb.active()).toHaveLength(2);

    // A new agent claiming src/graph/x collides with t1 (running) but not t2.
    const clash = bb.overlapping('src/graph/x');
    expect(clash.map(c => c.taskId)).toEqual(['t1']);

    bb.incTool('t1'); bb.incTool('t1');
    bb.markDone('t1', 'done reading graph');
    expect(bb.active().map(c => c.taskId)).toEqual(['t2']); // t1 no longer running
    // A done claim no longer counts as an overlap.
    expect(bb.overlapping('src/graph')).toHaveLength(0);

    const t1 = bb.all().find(c => c.taskId === 't1')!;
    expect(t1.status).toBe('done');
    expect(t1.toolCalls).toBe(2);
    expect(t1.result).toBe('done reading graph');
  });
});
