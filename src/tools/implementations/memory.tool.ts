import { ToolDef, buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { VectorStore } from '../../memory/vector.store';

export function createMemoryQueryTool(governor: IGovernor, vectorStore: VectorStore): BuiltTool {
  const def: ToolDef = {
    name: 'MemoryQueryTool',
    description: `Performs a semantic search against the Long-Term Memory VectorStore.

Use this tool when you encounter an unfamiliar error, a weird architectural pattern, or need to know how a specific problem was solved in the past.

# Instructions
- **Query Formulation:** Do not pass raw stack traces as the query. Summarize the conceptual problem (e.g., \`query: "How do we handle FreeCreditsTracker async-mutex race conditions?"\`).
- **Token Budgeting:** The memories returned by this tool are injected directly into your context window. Only query memory if you are genuinely stuck, to avoid exhausting your Short-Term Memory budget.
- **Applying Past Solutions:** If a historical memory suggests a fix, adapt it to the *current* codebase context. Do not blindly copy-paste outdated paths.`,
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query or concept to look for.'
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default 3).'
        }
      },
      required: ['query']
    },
    isDestructive: false,
    isConcurrencySafe: true,
    execute: async (args: { query: string; limit?: number }) => {
      const results = await vectorStore.semanticSearch(args.query, args.limit || 3);
      if (results.length === 0) {
        return "No relevant memories found in the VectorStore.";
      }
      return results.map(r => `Memory ID (Path): ${r.id}\nTags: ${r.metadata.tags.join(', ')}\nContent:\n${r.metadata.content}\n---`).join('\n');
    }
  };

  return buildTool(def, governor);
}
