import { buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { SkillService } from '../../skills/skill.service';

/**
 * Installs an Agent Skill from a local repo/folder the user points at, globally
 * (`~/.bimax/skills/<name>/`). This is the counterpart to SkillTool (which only LOADS an
 * already-installed skill). A skill is just a folder with a SKILL.md, so installing = copying
 * that folder into the global skills dir and reloading — no marketplace fetch, no binary.
 */
export function createSkillInstallTool(governor: IGovernor, skills: SkillService): BuiltTool {
  return buildTool({
    name: 'SkillInstallTool',
    description: `Install an Agent Skill GLOBALLY from a local path the user gives you (a cloned repo, a skill folder, or a SKILL.md). Use this whenever the user gives you a skill repo/folder and says "add/install this skill", "add it to yourself", etc.

# How it works
- A skill is just a folder containing SKILL.md. This copies that folder into ~/.bimax/skills/<name>/ (global — every project sees it), then reloads. It will be listed under AVAILABLE SKILLS and loadable via SkillTool.
- "source" can be: a repo dir (it finds the SKILL.md inside, even nested under skills/<name>/), a skill dir, or a SKILL.md file path.
- If the repo holds several skills, pass "name" to pick one; otherwise the tool tells you the choices.

# Do NOT
- Do not use RegisterAgentTool (that's for CLI binaries), do not hand-copy files with Bash, do not look for an install script or marketplace URL. Just call THIS tool with the path. One call installs it.`,
    isDestructive: false,
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Local path to the skill repo, skill folder, or SKILL.md the user pointed you at.' },
        name: { type: 'string', description: 'Optional: which skill to install if the repo contains several (the folder name).' },
      },
      required: ['source'],
    },
    execute: async (args: { source: string; name?: string }) => {
      const res = skills.install(args.source, args.name);
      return res.message;
    },
  }, governor);
}
