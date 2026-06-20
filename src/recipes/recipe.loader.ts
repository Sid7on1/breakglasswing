import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface RecipeDefinition {
  name: string;
  description?: string;
  instructions: string;
  extensions?: string[];         // MCP server names to enable for this recipe
  sub_recipes?: string[];        // other recipe names to run before this one
  success_checks?: string[];     // shell commands that must exit 0 after completion
  retry?: number;                // max retries on failure (default 0)
  filePath: string;              // set by loader, not from YAML
}

const RECIPE_DIR = '.bimax/recipes';

export class RecipeLoader {
  constructor(private projectRoot: string) {}

  get recipesDir(): string {
    return path.join(this.projectRoot, RECIPE_DIR);
  }

  list(): RecipeDefinition[] {
    const dir = this.recipesDir;
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map(f => this.load(path.join(dir, f)))
        .filter((r): r is RecipeDefinition => r !== null);
    } catch {
      return [];
    }
  }

  load(filePath: string): RecipeDefinition | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = yaml.load(raw) as any;
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        name: parsed.name ?? path.basename(filePath, path.extname(filePath)),
        description: parsed.description,
        instructions: parsed.instructions ?? '',
        extensions: Array.isArray(parsed.extensions) ? parsed.extensions : [],
        sub_recipes: Array.isArray(parsed.sub_recipes) ? parsed.sub_recipes : [],
        success_checks: Array.isArray(parsed.success_checks) ? parsed.success_checks : [],
        retry: typeof parsed.retry === 'number' ? parsed.retry : 0,
        filePath,
      };
    } catch {
      return null;
    }
  }

  getByName(name: string): RecipeDefinition | null {
    const all = this.list();
    return all.find(r => r.name === name) ?? null;
  }

  ensureDir(): void {
    fs.mkdirSync(this.recipesDir, { recursive: true });
  }

  scaffoldExample(name: string): string {
    this.ensureDir();
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    const filePath = path.join(this.recipesDir, `${slug}.yaml`);
    const template = [
      `name: ${slug}`,
      `description: ${name}`,
      `instructions: |`,
      `  Describe what the agent should do for this recipe.`,
      `  Be specific about inputs, outputs, and acceptance criteria.`,
      `# extensions:`,
      `#   - my-mcp-server`,
      `# sub_recipes:`,
      `#   - another-recipe`,
      `# success_checks:`,
      `#   - npm test`,
      `# retry: 1`,
    ].join('\n');
    fs.writeFileSync(filePath, template, 'utf8');
    return filePath;
  }
}

let _loader: RecipeLoader | null = null;
export function getGlobalRecipeLoader(): RecipeLoader | null { return _loader; }
export function setGlobalRecipeLoader(l: RecipeLoader): void { _loader = l; }
