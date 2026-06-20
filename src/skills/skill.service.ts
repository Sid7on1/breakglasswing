import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/logger';

// Agent Skills — Anthropic-style, model-invoked capability packs with progressive disclosure.
// A skill is a directory containing a `SKILL.md`:
//
//   .bimax/skills/<name>/SKILL.md
//   ---
//   name: pdf-fill
//   description: Fill PDF forms from a JSON spec. Use when asked to populate a PDF.
//   allowed-tools: BashTool, ReadFileTool          # optional, advisory
//   ---
//   <full instructions the model follows once the skill is loaded>
//
// Only the name + description are surfaced to the model up-front (cheap); the full body is loaded
// on demand when the model calls SkillTool(name). Other files in the dir are bundled resources the
// model reads/runs via the normal Read/Bash tools.

export interface Skill {
  name: string;
  description: string;
  allowedTools?: string[];
  dir: string;       // absolute path to the skill directory
  body: string;      // instructions (everything after the frontmatter)
  source: string;    // 'project' | 'home' | 'builtin'
}

/** Parse a SKILL.md: optional `---` frontmatter (name/description/allowed-tools) + body. Pure. */
export function parseSkillFile(content: string): { meta: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  // Locate opening and closing --- delimiters robustly (tolerates trailing spaces and CRLF).
  const open = normalized.match(/^---[ \t]*\n/);
  if (!open) return { meta: {}, body: normalized.trim() };
  const fmStart = open[0].length;
  const closeRe = /\n---[ \t]*(\n|$)/g;
  closeRe.lastIndex = fmStart;
  const close = closeRe.exec(normalized);
  if (!close) return { meta: {}, body: normalized.trim() };

  const fmText = normalized.slice(fmStart, close.index);
  const body = normalized.slice(close.index + close[0].length).trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(fmText) as Record<string, unknown>) || {};
  } catch {
    // Malformed frontmatter — return no meta so the skill is skipped with a warning.
    parsed = {};
  }

  // Normalise all keys to lowercase strings for consistent lookup.
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    meta[k.toLowerCase()] = String(v ?? '');
  }

  return { meta, body };
}

export class SkillService {
  private skills: Map<string, Skill> = new Map();

  /** Lookup dirs in precedence order: project wins over home wins over built-in. */
  private dirs(cwd: string = process.cwd()): { dir: string; source: string }[] {
    return [
      { dir: path.join(cwd, '.bimax', 'skills'), source: 'project' },
      { dir: path.join(os.homedir(), '.bimax', 'skills'), source: 'home' },
      { dir: path.join(__dirname, '../../skills'), source: 'builtin' },
    ];
  }

  /** (Re)scan every lookup dir for `<name>/SKILL.md`. First dir wins on name collisions. */
  public load(cwd: string = process.cwd()): Map<string, Skill> {
    this.skills = new Map();
    for (const { dir, source } of this.dirs(cwd)) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // dir absent / unreadable
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue; // legacy *.json persona-skills live here too — skip them
        const skillFile = path.join(dir, entry.name, 'SKILL.md');
        let content: string;
        try {
          content = fs.readFileSync(skillFile, 'utf8');
        } catch {
          continue; // no SKILL.md in this dir
        }
        const { meta, body } = parseSkillFile(content);
        const name = (meta.name || entry.name).toLowerCase();
        if (this.skills.has(name)) continue; // earlier (higher-precedence) dir already provided it
        if (!meta.description) {
          Logger.warn(`[SkillService] ${skillFile} has no description — skipping.`);
          continue;
        }
        this.skills.set(name, {
          name,
          description: meta.description,
          allowedTools: meta['allowed-tools']
            ? meta['allowed-tools'].split(',').map(s => s.trim()).filter(Boolean)
            : undefined,
          dir: path.join(dir, entry.name),
          body,
          source,
        });
      }
    }
    return this.skills;
  }

  public list(): Skill[] {
    return Array.from(this.skills.values());
  }

  public get(name: string): Skill | undefined {
    return this.skills.get((name || '').toLowerCase());
  }

  /** Compact `name — description` lines for progressive disclosure in the system prompt. */
  public listForPrompt(): string {
    return this.list().map(s => `- ${s.name}: ${s.description}`).join('\n');
  }

  /** Full instructions for a skill plus a pointer to its bundled files. For SkillTool. */
  public renderBody(name: string): string {
    const skill = this.get(name);
    if (!skill) {
      const names = this.list().map(s => s.name).join(', ') || '(none installed)';
      return `No skill named "${name}". Available skills: ${names}.`;
    }
    let bundled: string[] = [];
    try {
      bundled = fs.readdirSync(skill.dir).filter(f => f !== 'SKILL.md');
    } catch { /* dir vanished — ignore */ }
    const filesNote = bundled.length
      ? `\n\nBundled files in this skill (read or run them with the normal tools, dir: ${skill.dir}):\n${bundled.map(f => `- ${f}`).join('\n')}`
      : '';
    return `# Skill: ${skill.name}\n${skill.description}\n\n${skill.body}${filesNote}`;
  }
}

export const globalSkillService = new SkillService();
