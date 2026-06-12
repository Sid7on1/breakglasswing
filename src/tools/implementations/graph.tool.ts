import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { GraphStore } from '../../graph/graph.store';

export const createGraphQueryTool = (governor: IGovernor, graphStore: GraphStore) => buildTool({
  name: 'GraphQueryTool',
  description: `Queries the internal Abstract Syntax Tree (AST) topological map of the project.

This is your ultimate "Zoom Out" tool. BreakGlassWing maintains a live Dependency Graph of all classes, functions, and files. Use this tool BEFORE making edits to understand the blast radius of your changes.

# Instructions
- **Dependency Tracking:** Use the query \`GET_DEPENDENTS <NodeID>\` to see every other file/class that relies on the target you are about to modify. If you change a function signature, you MUST update all dependents.
- **Feature Discovery:** Use \`SEARCH_NODES <Keyword>\` to find where specific domain logic lives without grepping the entire codebase.
- **Architectural Constraints:** When the tool returns an AST node, pay attention to the \`emits\` and \`listensTo\` metadata. If a class emits an event, your code edits must preserve that event emission, or the \`ArchitectureGuardian\` will block your save.`,
  isDestructive: false, // Read-only query
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The node ID or query to inspect' }
    },
    required: ['query']
  },
  execute: async (args: { query: string }) => {
    const node = graphStore.getNode(args.query);
    if (!node) return `No node found for query: ${args.query}`;
    
    // Return node and its edges
    const graph = graphStore.getGraph();
    const edges = graph.edges.filter(e => e.sourceId === args.query || e.targetId === args.query);
    
    return JSON.stringify({ node, edges }, null, 2);
  }
}, governor);
