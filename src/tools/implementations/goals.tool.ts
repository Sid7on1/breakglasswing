import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { getGoalManager } from '../../memory/goal.manager';

interface GoalsArgs {
  action: 'list' | 'add' | 'complete' | 'abandon' | 'update';
  id?: string;
  title?: string;
  description?: string;
  notes?: string;
}

/**
 * GoalsTool — model-driven management of persistent cross-session goals.
 *
 * Goals survive restarts and appear in every session's system prompt. The model
 * should call this to:
 *   - Mark a goal complete when the user's long-running objective is achieved
 *   - Add a new goal the user articulated (especially ones spanning multiple sessions)
 *   - List current goals to orient on what the user is working toward
 */
export const createGoalsTool = (governor: IGovernor) => buildTool({
  name: 'GoalsTool',
  description: `Manages cross-session persistent goals — objectives that span multiple sessions and should be tracked beyond the current conversation.

Unlike the per-session TodoTool (task steps), goals represent higher-level intentions (e.g. "implement OAuth", "get CI green", "refactor the auth module"). Active goals are automatically shown at session start.

# Actions
- **list**: Show all goals (active, completed, abandoned).
- **add**: Create a new goal. Requires title. Description is optional but useful.
- **complete**: Mark a goal as completed (by id). Call when the user's objective is achieved.
- **abandon**: Mark a goal as abandoned (by id). Call when the user explicitly drops it.
- **update**: Update title, description, or notes on an existing goal (by id).

# When to call
- User mentions a long-running objective ("I want to refactor X over the next few sessions")
- A multi-session task is finally finished → complete it
- User says "add this as a goal" or "track this"`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'complete', 'abandon', 'update'],
        description: 'What to do.',
      },
      id: { type: 'string', description: 'Goal ID (required for complete/abandon/update).' },
      title: { type: 'string', description: 'Goal title (required for add; optional for update).' },
      description: { type: 'string', description: 'Longer description of the goal (optional).' },
      notes: { type: 'string', description: 'Progress notes to attach to the goal (for update).' },
    },
    required: ['action'],
  },
  execute: async (args: GoalsArgs, context?: any) => {
    const gm = getGoalManager();
    const sessionId = context?.sessionId as string | undefined;

    switch (args.action) {
      case 'list': {
        const all = gm.getAllGoals();
        if (all.length === 0) return 'No goals yet. Add one with action: "add".';
        const format = (g: any) => {
          const status = g.status === 'active' ? '[active]' : g.status === 'completed' ? '[done] ' : '[gone] ';
          const sess = g.sessions.length ? ` · ${g.sessions.length} session(s)` : '';
          const notes = g.notes ? `\n    Notes: ${g.notes}` : '';
          return `${status} [${g.id}] ${g.title}${g.description ? `\n    ${g.description}` : ''}${notes}${sess}`;
        };
        const active = all.filter(g => g.status === 'active');
        const done = all.filter(g => g.status !== 'active');
        const parts: string[] = [];
        if (active.length) parts.push(`Active (${active.length}):\n${active.map(format).join('\n')}`);
        if (done.length) parts.push(`Completed/Abandoned (${done.length}):\n${done.map(format).join('\n')}`);
        return parts.join('\n\n');
      }

      case 'add': {
        if (!args.title) return 'Error: title is required for action "add".';
        const goal = await gm.addGoal(args.title, args.description || '', sessionId);
        return `Goal added [${goal.id}]: "${goal.title}"\nThis goal will appear in every future session until completed.`;
      }

      case 'complete': {
        if (!args.id) return 'Error: id is required for action "complete".';
        const goal = await gm.setStatus(args.id, 'completed', sessionId);
        if (!goal) return `Error: no goal found with id "${args.id}". Use action "list" to see goal IDs.`;
        return `Goal [${goal.id}] marked complete: "${goal.title}"`;
      }

      case 'abandon': {
        if (!args.id) return 'Error: id is required for action "abandon".';
        const goal = await gm.setStatus(args.id, 'abandoned', sessionId);
        if (!goal) return `Error: no goal found with id "${args.id}". Use action "list" to see goal IDs.`;
        return `Goal [${goal.id}] abandoned: "${goal.title}"`;
      }

      case 'update': {
        if (!args.id) return 'Error: id is required for action "update".';
        const goal = await gm.updateGoal(args.id, {
          ...(args.title !== undefined && { title: args.title }),
          ...(args.description !== undefined && { description: args.description }),
          ...(args.notes !== undefined && { notes: args.notes }),
        }, sessionId);
        if (!goal) return `Error: no goal found with id "${args.id}". Use action "list" to see goal IDs.`;
        return `Goal [${goal.id}] updated: "${goal.title}"`;
      }

      default:
        return `Error: unknown action "${args.action}". Valid: list, add, complete, abandon, update.`;
    }
  },
}, governor);
