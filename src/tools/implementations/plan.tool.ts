import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { getPlanManager } from '../../memory/plan.manager';

interface PlanArgs {
  action: 'write' | 'read' | 'update_step' | 'list' | 'delete';
  // write
  title?: string;
  goal?: string;
  steps?: string[];
  risks?: string[];
  files_to_touch?: string[];
  goal_id?: string;
  // read / update_step / delete
  slug?: string;
  // update_step
  step_index?: number;
  done?: boolean;
}

/**
 * PlanTool — write and maintain structured plans as version-controlled markdown files.
 *
 * Unlike the per-session TodoTool (transient task steps), plans are:
 *   - Persisted to .bimax/plans/<slug>.md (committed to git alongside code)
 *   - Structured: goal, numbered checkbox steps, risks, files to touch
 *   - Optionally linked to a GoalManager goal (goal_id)
 *
 * Workflow:
 *   1. Enter /plan mode (read-only)
 *   2. Investigate, then call PlanTool(action: "write") with the full plan
 *   3. Exit /plan mode, execute step by step
 *   4. Call PlanTool(action: "update_step") to check off each step as you go
 */
export const createPlanTool = (governor: IGovernor) => buildTool({
  name: 'PlanTool',
  description: `Write and maintain structured plans as version-controlled markdown files in .bimax/plans/.

Unlike TodoTool (per-session), plans persist across sessions, track progress step-by-step, and can be linked to a long-running Goal.

# Actions
- **write**: Create a new plan with title, goal, step list, optional risks and files.
- **read**: Read back a plan by slug (use list to find slugs).
- **update_step**: Check or uncheck a step by its 1-based index (as you complete work).
- **list**: List all saved plan slugs.
- **delete**: Remove a plan by slug.

# When to call
- After /plan mode investigation → write the plan before executing
- After completing each step → update_step to check it off
- At session start when resuming multi-session work → read the active plan`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['write', 'read', 'update_step', 'list', 'delete'] },
      title: { type: 'string', description: 'Plan title (required for write).' },
      goal: { type: 'string', description: 'One-sentence goal (required for write).' },
      steps: { type: 'array', items: { type: 'string' }, description: 'Ordered step descriptions (required for write).' },
      risks: { type: 'array', items: { type: 'string' }, description: 'Known risks or blockers (optional).' },
      files_to_touch: { type: 'array', items: { type: 'string' }, description: 'Files expected to change (optional, helps /impact gate).' },
      goal_id: { type: 'string', description: 'GoalManager goal ID to link this plan to (optional).' },
      slug: { type: 'string', description: 'Plan slug (required for read/update_step/delete).' },
      step_index: { type: 'number', description: '1-based step number (required for update_step).' },
      done: { type: 'boolean', description: 'True to check off, false to uncheck (required for update_step).' },
    },
    required: ['action'],
  },
  execute: async (args: PlanArgs) => {
    const pm = getPlanManager();

    switch (args.action) {
      case 'write': {
        if (!args.title) return 'Error: title is required for action "write".';
        if (!args.goal) return 'Error: goal is required for action "write".';
        if (!args.steps || args.steps.length === 0) return 'Error: steps array is required and must not be empty for action "write".';
        const plan = await pm.create({
          title: args.title,
          goal: args.goal,
          steps: args.steps,
          risks: args.risks,
          filesToTouch: args.files_to_touch,
          goalId: args.goal_id,
        });
        return `Plan written to .bimax/plans/${plan.slug}.md\n\n${pm.formatPlan(plan)}\n\nUse PlanTool(action:"update_step", slug:"${plan.slug}", step_index:N, done:true) to check off steps as you complete them.`;
      }

      case 'read': {
        if (!args.slug) return 'Error: slug is required for action "read". Use action "list" to see available plans.';
        const plan = await pm.load(args.slug);
        if (!plan) return `Error: no plan found with slug "${args.slug}". Use action "list" to see available plans.`;
        return pm.formatPlan(plan);
      }

      case 'update_step': {
        if (!args.slug) return 'Error: slug is required for action "update_step".';
        if (args.step_index === undefined) return 'Error: step_index (1-based) is required for action "update_step".';
        if (args.done === undefined) return 'Error: done (true/false) is required for action "update_step".';
        const plan = await pm.setStepDone(args.slug, args.step_index, args.done);
        if (!plan) return `Error: plan "${args.slug}" not found or step ${args.step_index} does not exist.`;
        const done = plan.steps.filter(s => s.done).length;
        const total = plan.steps.length;
        const allDone = done === total;
        return `Step ${args.step_index} ${args.done ? 'checked ✓' : 'unchecked'} — ${done}/${total} complete.${allDone ? '\n\nAll steps done! Consider marking the linked goal complete via GoalsTool.' : ''}`;
      }

      case 'list': {
        const slugs = await pm.list();
        if (slugs.length === 0) return 'No plans yet. Create one with action "write".';
        const lines: string[] = [];
        for (const slug of slugs) {
          const plan = await pm.load(slug);
          if (!plan) continue;
          const done = plan.steps.filter(s => s.done).length;
          const total = plan.steps.length;
          lines.push(`• ${slug}  [${done}/${total}]  ${plan.title}`);
        }
        return `Saved plans (${slugs.length}):\n${lines.join('\n')}`;
      }

      case 'delete': {
        if (!args.slug) return 'Error: slug is required for action "delete".';
        const ok = await pm.delete(args.slug);
        return ok ? `Plan "${args.slug}" deleted.` : `Error: plan "${args.slug}" not found.`;
      }

      default:
        return `Error: unknown action. Valid: write, read, update_step, list, delete.`;
    }
  },
}, governor);
