import { buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { SkillService } from '../../skills/skill.service';

/**
 * Agent Skills entry point. The model sees each skill's name + description in its system prompt
 * (progressive disclosure); when a task matches one, it calls SkillTool to load the full
 * instructions, then follows them — running any bundled scripts via the normal Bash/Read tools.
 */
export function createSkillTool(governor: IGovernor, skills: SkillService): BuiltTool {
  return buildTool({
    name: 'SkillTool',
    description: `Loads the full instructions for an installed Agent Skill by name. The available skills are listed under "AVAILABLE SKILLS" in your system prompt (you only see their name + one-line description until you load them here).

# When to use
- The user's task matches an available skill's description. Load it BEFORE starting the work, then follow its instructions exactly.
Do NOT invent skill names — only load ones listed in AVAILABLE SKILLS.`,
    isDestructive: false,
    isConcurrencySafe: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name, exactly as listed in AVAILABLE SKILLS.' },
      },
      required: ['name'],
    },
    execute: async (args: { name: string }) => {
      return skills.renderBody(args.name);
    },
  }, governor);
}
