import { GraphStore } from '../graph/graph.store';
import { GraphNode } from '../graph/models';
import { createGraphQueryTool } from '../tools/implementations/graph.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;
const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, name: id, type: 'FUNCTION', filePath: `${id}.ts`, ...extra,
});

// The model guessed conceptual node names ("Architecture") that don't exist and then fell back to
// blind globbing. A missed SEARCH_NODES should ORIENT it (no hardcoded workflow) — show the real
// node types + central symbols so its next call uses an actual name.
describe('GraphQueryTool — orientation on a missed search', () => {
  it('a no-match SEARCH_NODES explains what the graph holds and which real symbols to try', async () => {
    const store = new GraphStore(':memory:');
    store.addNode(node('KnowledgeGraph', { type: 'CLASS' }));
    store.addNode(node('SessionRule', { type: 'CLASS' }));
    store.addNode(node('evaluate'));
    const out = String(await createGraphQueryTool(governor, store).execute({ query: 'SEARCH_NODES Architecture' }, {}));

    expect(out).toContain('No nodes match');
    expect(out).toMatch(/CLASS|FUNCTION/);                       // node-type breakdown
    expect(out).toMatch(/KnowledgeGraph|SessionRule|evaluate/);  // real central symbols
    expect(out).toMatch(/CODE symbols/);                         // the steer away from concepts
  });

  it('still returns hits normally when a real symbol matches', async () => {
    const store = new GraphStore(':memory:');
    store.addNode(node('SessionRule', { type: 'CLASS' }));
    const out = String(await createGraphQueryTool(governor, store).execute({ query: 'SEARCH_NODES Session' }, {}));
    expect(out).toContain('SessionRule');
    expect(out).not.toContain('No nodes match');
  });

  it('SEARCH_NODES * lists central nodes for discovery (the model tried this)', async () => {
    const store = new GraphStore(':memory:');
    store.addNode(node('KnowledgeGraph', { type: 'CLASS' }));
    store.addNode(node('evaluate'));
    const out = String(await createGraphQueryTool(governor, store).execute({ query: 'SEARCH_NODES *' }, {}));
    expect(out).toMatch(/central/i);
    expect(out).toMatch(/KnowledgeGraph|evaluate/);
    expect(out).not.toContain('No nodes match');
  });

  it('a file-path target resolves to its FILE node instead of "ambiguous"', async () => {
    const store = new GraphStore(':memory:');
    // The file node PLUS two symbols inside it all match the path "src/index.ts".
    store.addNode(node('index.ts', { id: 'file:src/index.ts', type: 'FILE', filePath: 'src/index.ts' }));
    store.addNode(node('main', { id: 'func:src/index.ts:main', filePath: 'src/index.ts' }));
    store.addNode(node('helper', { id: 'func:src/index.ts:helper', filePath: 'src/index.ts' }));
    const out = String(await createGraphQueryTool(governor, store).execute({ query: 'GET_DEPENDENTS src/index.ts' }, {}));
    expect(out).not.toMatch(/ambiguous/i); // auto-resolved to the FILE node
  });
});
