import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { getBlueprintEngine } from '../../blueprints/blueprint.engine';
import { getBlueprintCompiler } from '../../blueprints/blueprint.compiler';
import { getCatalog, DOMAIN_CATALOGS } from '../../blueprints/catalogs';
import { getTrainMonitor } from '../../training/train.monitor';
import { globalMcpManager } from '../../mcp/manager';
import { catalogEntry } from '../../mcp/catalog';

// A browser/screenshot-capable MCP tool (Playwright/Puppeteer) → the website Verify loop. We detect
// one by name so `verify` can either drive it or auto-connect one.
function findBrowserTool(names: string[]): string | undefined {
  return names.find(n => /playwright|puppeteer|screenshot|browser/i.test(n));
}

// The minimal slice of McpManager the verify auto-connect needs — injectable so it can be tested
// without spawning a real npx process.
export interface McpConnector {
  addToConfig(spec: { name: string; command?: string; args?: string[] }): void;
  connectSpec(spec: any, registry: any, governor: IGovernor): Promise<{ name: string; toolNames: string[] } | null>;
  lastError: string | null;
}

/**
 * Ensure a browser/screenshot MCP is connected for the website Verify loop. If one is already wired,
 * return it. Otherwise auto-discover Playwright from the catalog, connect it live (governor-gated, so
 * the user still confirms starting the process), and return the freshly-registered tool. This closes
 * the "instructs vs. does" gap: the agent no longer has to run McpManageTool by hand before verifying.
 */
export async function autoConnectBrowser(
  registry: { getToolNames(): string[] },
  governor: IGovernor,
  manager: McpConnector = globalMcpManager as unknown as McpConnector,
): Promise<{ tool?: string; connected: boolean; added?: string[]; error?: string }> {
  const existing = findBrowserTool(registry.getToolNames());
  if (existing) return { tool: existing, connected: true };
  const entry = catalogEntry('playwright');
  if (!entry) return { connected: false, error: 'no "playwright" entry in the MCP catalog' };
  const spec = { name: 'playwright', command: entry.command, args: entry.args };
  manager.addToConfig(spec);
  const conn = await manager.connectSpec(spec, registry, governor);
  if (!conn) return { connected: false, error: manager.lastError || 'Playwright MCP failed to start' };
  const tool = findBrowserTool(registry.getToolNames()) || conn.toolNames[0];
  return { tool, connected: true, added: conn.toolNames };
}

// Minimal web-import parser: pull a title + a one-line description out of fetched HTML so a freshly
// released OSS model/framework page becomes a selectable Blueprint option without hand-typing it.
function parsePage(html: string): { title: string; desc: string } {
  const pick = (re: RegExp) => { const m = html.match(re); return m ? m[1].trim().replace(/\s+/g, ' ') : ''; };
  const title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<title[^>]*>([^<]+)<\/title>/i);
  const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  return { title: title.slice(0, 80), desc: (desc || title).slice(0, 140) };
}

interface BlueprintArgs {
  action: 'create' | 'list' | 'show' | 'levels' | 'select' | 'override' | 'import' | 'import_url' | 'verify' | 'build' | 'delete';
  // create
  goal?: string;
  domain?: string;
  // show/select/override/import/build/delete
  slug?: string;
  // select/override/import
  level?: string;
  // select
  option?: string;
  // override
  text?: string;
  // import
  option_id?: string;
  option_title?: string;
  option_note?: string;
  url?: string;
}

/**
 * BlueprintTool — the level-by-level decision engine behind Sketch Mode. Non-destructive (it only
 * writes Blueprint YAML, never code), so it runs inside sketch/plan mode where edits are blocked.
 *
 * Flow: create (from an idea → domain catalog) → select / override / import at each level → build
 * (emit the build brief beast mode executes). Blueprints persist to .bimax/blueprints/<slug>.yaml.
 */
export const createBlueprintTool = (governor: IGovernor, toolRegistry?: { getToolNames(): string[] }) => buildTool({
  name: 'BlueprintTool',
  description: `Design and maintain a Blueprint — a level-by-level decision tree for building a website, an agent, or an LLM — saved to .bimax/blueprints/<slug>.yaml. This is the spine of Sketch Mode.

# Actions
- **create**: Start a Blueprint from an idea. Pass goal (the idea) and optional domain (website | agent | llm — inferred if omitted). Seeds every decision level with curated options + sensible defaults.
- **list**: List saved Blueprints (slug · domain · goal).
- **show**: Render a Blueprint (slug) — every level, its selected option, alternatives, and overrides.
- **levels**: Show the catalog of options for a domain (domain) WITHOUT creating anything — useful to discuss choices.
- **select**: Pick an option at a level. Pass slug, level (id or title), option (id or title).
- **override**: Set a free-text note at a level that customizes or MIXES options (e.g. "MoE at the FFN but keep MLA's KV-cache from attention"). Pass slug, level, text. Honored verbatim at build.
- **import**: Add a new option (e.g. a freshly-released OSS model/framework you fetched with WebFetchTool) at a level and select it. Pass slug, level, option_id, option_title, option_note, optional url.
- **import_url**: Web-import shortcut — fetch a URL, parse its title/description, and register it as a selectable option at a level (and select it). Pass slug, level, url. Use when the user points you at a freshly-released model/framework page.
- **build**: Compile the Blueprint into concrete artifacts in .bimax/builds/<slug>/ AND (for LLM) auto-wire monitoring. Pass slug. Execute the emitted files in beast mode.
- **verify**: Domain-appropriate proof. For a website, AUTO-CONNECTS a Playwright browser MCP if none is wired yet (governor-gated), then drives it to render + screenshot a URL so you can critique the visual. Pass slug, optional url.
- **delete**: Remove a Blueprint by slug.

# When to use
In sketch mode: after discussing an idea, create a Blueprint, then walk the user level-by-level — offer the options, let them select, capture overrides, import anything new from the web. Conclude by saving and telling them to switch to beast mode (Shift+Tab) to build.`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'show', 'levels', 'select', 'override', 'import', 'import_url', 'verify', 'build', 'delete'] },
      goal: { type: 'string', description: 'The idea (required for create).' },
      domain: { type: 'string', enum: ['website', 'agent', 'llm'], description: 'Domain (optional for create — inferred; required for levels).' },
      slug: { type: 'string', description: 'Blueprint slug (required for show/select/override/import/build/delete).' },
      level: { type: 'string', description: 'Level id or title (required for select/override/import).' },
      option: { type: 'string', description: 'Option id or title to select (required for select).' },
      text: { type: 'string', description: 'Free-text override that customizes/mixes options (required for override).' },
      option_id: { type: 'string', description: 'Id for the imported option (required for import).' },
      option_title: { type: 'string', description: 'Title for the imported option (required for import).' },
      option_note: { type: 'string', description: 'One-line note for the imported option (required for import).' },
      url: { type: 'string', description: 'Source URL of the imported option (optional for import).' },
    },
    required: ['action'],
  },
  execute: async (args: BlueprintArgs) => {
    const eng = getBlueprintEngine();
    if (!eng) return 'Error: BlueprintEngine not initialized in this context.';
    const fail = (r: any): r is { error: string } => r && typeof r === 'object' && 'error' in r;

    switch (args.action) {
      case 'create': {
        if (!args.goal) return 'Error: goal is required for action "create".';
        const bp = eng.create(args.goal, args.domain);
        return `Blueprint created → .bimax/blueprints/${bp.slug}.yaml\n\n${eng.format(bp)}\n\nWalk the user level-by-level: present each level's options, capture their pick with select, free-text customizations with override, and import anything new from the web. When done, tell them to Shift+Tab to beast mode (or say "build it").`;
      }
      case 'list': {
        const all = eng.list();
        if (!all.length) return 'No Blueprints yet. Create one with action "create".';
        return `Saved Blueprints (${all.length}):\n${all.map(b => `• ${b.slug}  [${b.domain}]  ${b.goal}`).join('\n')}`;
      }
      case 'levels': {
        const cat = getCatalog(args.domain || '');
        if (!cat) return `Error: domain is required for "levels". Valid: ${Object.keys(DOMAIN_CATALOGS).join(', ')}.`;
        const lines = cat.levels.map(l =>
          `### ${l.title} (id: ${l.id})\n${l.options.map(o => `  - ${o.title} (${o.id}) — ${o.note}`).join('\n')}`);
        return `${cat.title}: ${cat.description}\n\n${lines.join('\n\n')}\n\nBuild: ${cat.build}\nVerify: ${cat.verify}`;
      }
      case 'show': {
        if (!args.slug) return 'Error: slug is required for action "show".';
        const bp = eng.load(args.slug);
        return bp ? eng.format(bp) : `Error: no Blueprint "${args.slug}". Use action "list".`;
      }
      case 'select': {
        if (!args.slug || !args.level || !args.option) return 'Error: slug, level, and option are required for "select".';
        const r = eng.select(args.slug, args.level, args.option);
        return fail(r) ? `Error: ${r.error}` : eng.format(r);
      }
      case 'override': {
        if (!args.slug || !args.level || !args.text) return 'Error: slug, level, and text are required for "override".';
        const r = eng.override(args.slug, args.level, args.text);
        return fail(r) ? `Error: ${r.error}` : `Override set at "${args.level}". It will be honored verbatim at build.\n\n${eng.format(r)}`;
      }
      case 'import': {
        if (!args.slug || !args.level || !args.option_id || !args.option_title || !args.option_note)
          return 'Error: slug, level, option_id, option_title, and option_note are required for "import".';
        const r = eng.importOption(args.slug, args.level, { id: args.option_id, title: args.option_title, note: args.option_note, url: args.url });
        return fail(r) ? `Error: ${r.error}` : `Imported "${args.option_title}" at "${args.level}" and selected it.\n\n${eng.format(r)}`;
      }
      case 'import_url': {
        if (!args.slug || !args.level || !args.url) return 'Error: slug, level, and url are required for "import_url".';
        let parsed: { title: string; desc: string };
        try {
          const res = await fetch(args.url, { headers: { 'User-Agent': 'Bimax/1.0' } });
          if (!res.ok) return `Error: fetch ${args.url} → ${res.status}.`;
          parsed = parsePage(await res.text());
        } catch (e: any) {
          return `Error: could not fetch ${args.url} (${e.message}). You can still add it manually with action "import".`;
        }
        if (!parsed.title) return `Error: couldn't parse a title from ${args.url}. Use action "import" with your own option_title/note.`;
        const id = parsed.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        const r = eng.importOption(args.slug, args.level, { id, title: parsed.title, note: parsed.desc, url: args.url });
        return fail(r) ? `Error: ${r.error}` : `Web-imported "${parsed.title}" at "${args.level}" from ${args.url} and selected it.\n\n${eng.format(r)}`;
      }
      case 'verify': {
        if (!args.slug) return 'Error: slug is required for action "verify".';
        const bp = eng.load(args.slug);
        if (!bp) return `Error: no Blueprint "${args.slug}". Use action "list".`;
        if (bp.domain === 'llm') return `Verify (LLM): launch it, then read its metrics. Dry-run first — TrainLaunchTool launch run="${bp.slug}" dir=".bimax/builds/${bp.slug}" smoke=true — then TrainLaunchTool status and TrainMonitorTool status run="${bp.slug}" to check loss/grad/throughput. For the real run, drop smoke. Not a visual check.`;
        if (bp.domain === 'agent') return `Verify (agent): run the smoke goal end-to-end and confirm the agent uses its tools and stays in guardrails. Not a visual check.`;
        const url = args.url || 'http://localhost:4321 (your dev server)';
        if (!toolRegistry) return `Verify (website): no tool registry in this context — connect a browser MCP with McpManageTool(action:"add", id:"playwright"), then render ${url} and self-critique the visual.`;
        const browser = await autoConnectBrowser(toolRegistry, governor);
        if (!browser.connected) {
          return `Verify (website): no browser MCP, and auto-connect failed (${browser.error}). Connect one by hand — McpManageTool(action:"add", id:"playwright") — then call verify again to render ${url}.`;
        }
        const wired = browser.added ? ` (auto-connected Playwright — added ${browser.added.length} tool(s))` : '';
        return `Verify (website): browser MCP "${browser.tool}" ready${wired}. Navigate to ${url}, capture a screenshot, read it back, and self-critique the VISUAL against the goal "${bp.goal}". Iterate on the build until it matches, then declare done.`;
      }
      case 'build': {
        if (!args.slug) return 'Error: slug is required for action "build".';
        const bp = eng.load(args.slug);
        if (!bp) return `Error: no Blueprint "${args.slug}". Use action "list".`;
        const compiler = getBlueprintCompiler();
        let emitted = '';
        if (compiler) {
          const r = compiler.compile(bp);
          emitted = `\n\nCompiled ${r.files.length} artifact(s) → ${r.outDir}/\n${r.files.map(f => `  • ${f.path}`).join('\n')}` +
            (r.notes.length ? `\n${r.notes.map(n => `  → ${n}`).join('\n')}` : '');
          // Auto-wire monitoring for LLM builds so Verify is live the moment training starts — no
          // manual TrainMonitorTool watch step. The scaffold's metrics.jsonl lives in the build dir.
          if (bp.domain === 'llm') {
            const mon = getTrainMonitor();
            if (mon) {
              mon.watch(bp.slug, `${r.outDir}/metrics.jsonl`);
              emitted += `\n  → Monitoring auto-wired: TrainMonitorTool status run="${bp.slug}" once training writes metrics.`;
            }
          }
        }
        return `BUILD "${bp.slug}" — concrete artifacts written to disk; now execute them (you are in beast mode). For a substantial build run /beast with the brief below; refine the generated files in place. Then verify (BlueprintTool action:"verify").${emitted}\n\n${eng.buildBrief(bp)}`;
      }
      case 'delete': {
        if (!args.slug) return 'Error: slug is required for action "delete".';
        return eng.delete(args.slug) ? `Blueprint "${args.slug}" deleted.` : `Error: no Blueprint "${args.slug}".`;
      }
      default:
        return 'Error: unknown action. Valid: create, list, show, levels, select, override, import, build, delete.';
    }
  },
}, governor);
