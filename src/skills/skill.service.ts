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
        // Normalise the key the SAME way install() names the folder (lowercase, non-alnum → '-'), so a
        // frontmatter `name:` with spaces/caps still matches SkillTool("the-installed-name").
        const name = (meta.name || entry.name).toLowerCase().replace(/[^a-z0-9-]/g, '-');
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

  /** Dirs (bounded walk) that directly contain a SKILL.md. For installing from a repo. */
  private findSkillDirs(root: string, depth = 4): string[] {
    const out: string[] = [];
    const walk = (dir: string, d: number) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      if (entries.some(e => e.isFile() && e.name.toLowerCase() === 'skill.md')) out.push(dir);
      if (d <= 0) return;
      for (const e of entries) {
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') walk(path.join(dir, e.name), d - 1);
      }
    };
    walk(root, depth);
    return out;
  }

  /**
   * Install a skill from a local repo/folder/SKILL.md into `~/.bimax/skills/<name>/` (global —
   * available to every project). `source` may be a SKILL.md, a skill dir, or a repo containing one.
   * If the repo has several skills, pass `requestedName` to pick one. Copies the whole skill dir
   * (bundled files included), then reloads.
   */
  public install(source: string, requestedName?: string): { ok: boolean; message: string; name?: string } {
    const src = path.resolve(source.replace(/^~(?=\/|$)/, os.homedir()));
    let skillDir: string | undefined;
    let stat: fs.Stats;
    try { stat = fs.statSync(src); } catch { return { ok: false, message: `Path does not exist: ${src}` }; }

    if (stat.isFile()) {
      if (path.basename(src).toLowerCase() === 'skill.md') skillDir = path.dirname(src);
    } else if (fs.existsSync(path.join(src, 'SKILL.md'))) {
      skillDir = src;
    } else {
      const found = this.findSkillDirs(src);
      if (found.length === 0) return { ok: false, message: `No SKILL.md found anywhere under ${src}. Is this a skill repo?` };
      if (requestedName) skillDir = found.find(d => path.basename(d).toLowerCase() === requestedName.toLowerCase());
      if (!skillDir) skillDir = found.length === 1 ? found[0] : undefined;
      if (!skillDir) {
        return { ok: false, message: `Multiple skills found — re-run with the name you want:\n${found.map(d => '  - ' + path.basename(d)).join('\n')}` };
      }
    }
    if (!skillDir) return { ok: false, message: `No SKILL.md at ${src}.` };

    const { meta } = parseSkillFile(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
    if (!meta.description) return { ok: false, message: `${skillDir}/SKILL.md is missing a 'description' in its frontmatter — can't install it.` };

    const name = (requestedName || meta.name || path.basename(skillDir)).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const dest = path.join(os.homedir(), '.bimax', 'skills', name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(skillDir, dest, { recursive: true });
    this.load();
    return { ok: true, name, message: `Installed skill '${name}' globally → ${dest}. It's now available in every project; call SkillTool("${name}") to use it.` };
  }

  /**
   * AUTHOR a brand-new skill from scratch — the agent writes its own capability pack. Synthesises a
   * `~/.bimax/skills/<name>/SKILL.md` from a name + description + body (and optional bundled files),
   * then reloads so it's immediately loadable via SkillTool. This is how the agent crystallises a
   * repeated workflow ("how I set up a new migration", "our PR checklist") into reusable, persistent
   * knowledge — no marketplace, no local repo needed.
   */
  public author(opts: {
    name: string;
    description: string;
    body: string;
    allowedTools?: string[];
    files?: { path: string; content: string }[];
    overwrite?: boolean;
  }): { ok: boolean; message: string; name?: string } {
    const name = (opts.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    if (!name) return { ok: false, message: 'A skill needs a name (letters/numbers/hyphens).' };
    if (!opts.description?.trim()) return { ok: false, message: 'A skill needs a one-line description (this is what tells the model when to use it).' };
    if (!opts.body?.trim()) return { ok: false, message: 'A skill needs a body (the instructions the model follows once loaded).' };

    const dest = path.join(os.homedir(), '.bimax', 'skills', name);
    if (fs.existsSync(path.join(dest, 'SKILL.md')) && !opts.overwrite) {
      return { ok: false, message: `Skill '${name}' already exists. Pass overwrite=true to replace it, or pick a different name.` };
    }

    // Frontmatter via js-yaml so descriptions with colons/quotes are escaped correctly.
    const fm: Record<string, string> = { name, description: opts.description.trim() };
    if (opts.allowedTools?.length) fm['allowed-tools'] = opts.allowedTools.join(', ');
    const front = yaml.dump(fm).trimEnd();
    const md = `---\n${front}\n---\n\n${opts.body.trim()}\n`;

    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'SKILL.md'), md, 'utf8');
    for (const f of opts.files || []) {
      // Keep bundled files inside the skill dir — reject path escapes.
      const rel = f.path.replace(/^[/\\]+/, '');
      const target = path.join(dest, rel);
      if (!target.startsWith(dest + path.sep)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.content, 'utf8');
    }
    this.load();
    const extra = opts.files?.length ? ` (+${opts.files.length} bundled file(s))` : '';
    return { ok: true, name, message: `Authored skill '${name}'${extra} → ${dest}. It's live now; load it with SkillTool("${name}").` };
  }

  public list(): Skill[] {
    return Array.from(this.skills.values());
  }

  public get(name: string): Skill | undefined {
    const q = (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const direct = this.skills.get(q);
    if (direct) return direct;
    // Fallback: match by the installed FOLDER name. install() names the dir from the requested name,
    // which can differ from the SKILL.md `name:` that load() keys on — so a freshly-installed skill
    // referenced by its folder name still resolves (the post-install "not installed" false positive).
    for (const s of this.skills.values()) {
      if (path.basename(s.dir).toLowerCase().replace(/[^a-z0-9-]/g, '-') === q) return s;
    }
    return undefined;
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
