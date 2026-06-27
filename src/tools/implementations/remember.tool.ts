import { buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { ProjectMemory } from '../../memory/project.memory';

/**
 * Lets the agent durably record a project convention, decision, or gotcha. These are
 * recalled and injected into context automatically on later turns, so the project
 * effectively maintains its own CLAUDE.md.
 */
export function createRememberTool(governor: IGovernor, memory: ProjectMemory): BuiltTool {
  return buildTool({
    name: 'RememberTool',
    description: `Saves a durable fact about THIS project to long-term memory: a coding convention, an architectural decision and its rationale, or a gotcha worth not rediscovering. Relevant memories are automatically surfaced to you on future turns.

# When to use
- The user states a preference or rule ("always use X", "never touch Y").
- You discover a non-obvious constraint, build quirk, or decision that future work must respect.
Do NOT use it for transient task state or things already obvious from the code.`,
    isDestructive: false,
    isConcurrencySafe: true,
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact to remember, phrased so it is useful out of context.' },
        kind: { type: 'string', enum: ['convention', 'decision', 'gotcha', 'note'], description: 'Category of memory (default note).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional extra tags.' },
      },
      required: ['content'],
    },
    execute: async (args: { content: string; kind?: any; tags?: string[] }) => {
      const id = await memory.remember(args.content, args.kind || 'note', args.tags || []);
      if (!id) return 'Nothing to remember (empty content).';
      return `Saved to project memory (${args.kind || 'note'}): ${args.content.slice(0, 80)}${args.content.length > 80 ? '…' : ''}`;
    },
  }, governor);
}
