import { buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { SkillService } from '../../skills/skill.service';

/**
 * Lets the agent AUTHOR a brand-new Agent Skill from scratch — writing its own reusable capability
 * pack — instead of only installing one from a path the user supplies (SkillInstallTool) or loading
 * an existing one (SkillTool). The new skill is written to ~/.bimax/skills/<name>/SKILL.md, reloaded
 * live, and immediately loadable in the same session.
 */
export function createSkillAuthorTool(governor: IGovernor, skills: SkillService): BuiltTool {
  return buildTool({
    name: 'SkillAuthorTool',
    description: `Create a NEW Agent Skill that you write yourself — turn a workflow, convention, or procedure into a reusable, persistent capability pack. The skill is saved GLOBALLY (~/.bimax/skills/), loads live (no restart), and is then available in every project via SkillTool.

# When to use
- The user says "make/create a skill that…", "teach yourself to…", "remember how to do X as a skill".
- You notice you've done the same multi-step procedure repeatedly and want to crystallise it so future sessions can just load it.
- You want to capture a project convention or checklist as a loadable capability.

# How to write a good skill
- name: short kebab-case id (e.g. "release-checklist").
- description: ONE line describing WHEN to use it — this is all the model sees up front, so make it a clear trigger ("Use when cutting a release: bumps version, updates changelog, tags.").
- body: the full instructions the model follows once the skill is loaded — concrete steps, commands, gotchas. Write it as if instructing a capable agent.
- files (optional): bundled resources (templates, scripts) saved alongside the skill; reference them by relative path in the body and run/read them with the normal Bash/Read tools.

# Do NOT
- Do not hand-write SKILL.md with WriteFileTool — use THIS tool so it lands in the right place and reloads. To install a skill from an existing repo/folder, use SkillInstallTool instead.`,
    isDestructive: false,
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short kebab-case skill id, e.g. "release-checklist".' },
        description: { type: 'string', description: 'One line describing WHEN to use this skill (the trigger the model sees up front).' },
        body: { type: 'string', description: 'The full instructions the model follows once the skill is loaded.' },
        allowedTools: { type: 'array', items: { type: 'string' }, description: 'Optional advisory list of tools this skill expects to use.' },
        files: {
          type: 'array',
          description: 'Optional bundled files (templates/scripts) saved inside the skill dir.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path within the skill dir, e.g. "template.md".' },
              content: { type: 'string', description: 'File contents.' },
            },
            required: ['path', 'content'],
          },
        },
        overwrite: { type: 'boolean', description: 'Replace an existing skill of the same name (default false).' },
      },
      required: ['name', 'description', 'body'],
    },
    execute: async (args: {
      name: string; description: string; body: string;
      allowedTools?: string[]; files?: { path: string; content: string }[]; overwrite?: boolean;
    }) => {
      const res = skills.author(args);
      return res.message;
    },
  }, governor);
}
