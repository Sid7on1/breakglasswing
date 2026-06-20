import * as https from 'https';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';

interface ScoutArgs {
  package: string;
  aspect?: 'all' | 'api' | 'readme' | 'versions';
  registry?: 'npm' | 'pypi';
}

function httpsGetOnce(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'bimax-scout/1.0', 'Accept': 'application/json,text/plain' } }, (res) => {
      // Treat 429 (rate-limit) as a retriable error so the retry loop backs off.
      if (res.statusCode === 429) {
        res.resume();
        reject(Object.assign(new Error('rate-limited'), { code: 'RATE_LIMITED' }));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function httpsGet(url: string, timeoutMs = 8000, maxRetries = 2): Promise<string> {
  let lastErr: Error = new Error('no attempts');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await httpsGetOnce(url, timeoutMs);
    } catch (e: any) {
      lastErr = e;
      // Don't retry on timeout or permanent errors — only on transient network/rate-limit errors.
      if (e.message === 'timeout') throw e;
      if (attempt < maxRetries) {
        // Exponential backoff: 400ms, 800ms
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

/** Strip HTML tags and collapse whitespace into plain readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Block-level elements → newlines so paragraphs survive as separate lines.
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|article|section|header|footer)[^>]*>/gi, '\n')
    // Strip remaining HTML tags: only match patterns that actually look like tags
    // (letter-started tag name) so TypeScript generic syntax like Array<T> is never
    // accidentally consumed — PyPI descriptions are real HTML, not TypeScript source.
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?\/?>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cap a string to maxChars, appending a note if truncated. */
function cap(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `\n\n[… truncated at ${maxChars} chars — use WebFetchTool for the full content]`;
}

async function scoutNpm(pkg: string, aspect: string): Promise<string> {
  const data = await httpsGet(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
  const j = JSON.parse(data);
  const latest = j['dist-tags']?.latest || Object.keys(j.versions || {}).pop() || '?';
  const meta = j.versions?.[latest] || j;
  const name = j.name || pkg;
  const desc = j.description || meta.description || '(no description)';
  const homepage = meta.homepage || j.homepage || '';
  const repo = meta.repository?.url || '';
  const license = meta.license || '?';
  const deps = meta.dependencies ? Object.keys(meta.dependencies).length : 0;
  const mainExports = meta.exports ? JSON.stringify(meta.exports, null, 2).slice(0, 400) : '';
  const mainEntry = meta.main || meta.module || '';
  const types = meta.types || meta.typings || '';
  const keywords = (j.keywords || []).slice(0, 8).join(', ');
  const weeklyDl = j.downloads?.weekly || '?';

  const lines: string[] = [
    `# ${name}@${latest}`,
    `**Description:** ${desc}`,
    `**License:** ${license}  **Dependencies:** ${deps}`,
  ];
  if (keywords) lines.push(`**Keywords:** ${keywords}`);
  if (homepage) lines.push(`**Homepage:** ${homepage}`);
  if (repo) lines.push(`**Repo:** ${repo.replace(/^git\+/, '').replace(/\.git$/, '')}`);
  lines.push(`**Install:** \`npm install ${name}\``);
  if (mainEntry) lines.push(`**Main entry:** ${mainEntry}`);
  if (types) lines.push(`**Types:** ${types}`);
  if (mainExports) lines.push(`\n**Exports:**\n\`\`\`json\n${mainExports}\n\`\`\``);

  if (aspect === 'versions' || aspect === 'all') {
    const versions = Object.keys(j.versions || {}).slice(-10).reverse();
    lines.push(`\n**Recent versions:** ${versions.join(', ')}`);
  }

  // Try to fetch README from npm registry (it's embedded in the main doc)
  if (aspect === 'readme' || aspect === 'all') {
    const readme = j.readme || '';
    if (readme && readme !== 'ERROR: No README data found!') {
      lines.push(`\n## README (excerpt)\n${cap(readme, 3000)}`);
    } else if (repo) {
      // Try GitHub raw README
      const ghPath = repo.replace(/^git\+https?:\/\/github\.com\//, '').replace(/\.git$/, '');
      if (ghPath && !ghPath.includes(' ')) {
        try {
          const raw = await httpsGet(`https://raw.githubusercontent.com/${ghPath}/HEAD/README.md`, 6000);
          lines.push(`\n## README (from GitHub)\n${cap(raw, 3000)}`);
        } catch { /* readme unavailable */ }
      }
    }
  }

  return lines.join('\n');
}

async function scoutPypi(pkg: string, aspect: string): Promise<string> {
  const data = await httpsGet(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`);
  const j = JSON.parse(data);
  const info = j.info || {};
  const latest = info.version || '?';
  const desc = info.summary || '(no description)';
  const home = info.home_page || info.project_url || '';
  const license = info.license || '?';
  const requires = (info.requires_dist || []).slice(0, 8).join(', ');
  const keywords = info.keywords || '';

  const lines: string[] = [
    `# ${pkg}@${latest} (PyPI)`,
    `**Description:** ${desc}`,
    `**License:** ${license}`,
  ];
  if (keywords) lines.push(`**Keywords:** ${keywords}`);
  if (home) lines.push(`**Homepage:** ${home}`);
  if (requires) lines.push(`**Requires:** ${requires}`);
  lines.push(`**Install:** \`pip install ${pkg}\``);

  if (aspect === 'readme' || aspect === 'all') {
    const readme = htmlToText(info.description || '');
    if (readme) lines.push(`\n## Description\n${cap(readme, 3000)}`);
  }

  return lines.join('\n');
}

/**
 * ScoutTool — targeted dependency inspection (gap from WebSearch's breadth).
 *
 * WebSearch returns raw search results. ScoutTool fetches structured data from
 * the package registry (npm / PyPI) and synthesizes: version, install command,
 * exports, dependencies, README excerpt. One call, structured answer.
 *
 * Amplifies existing WebFetchTool by pre-structuring package data so the model
 * gets a concise API surface instead of raw HTML.
 */
export const createScoutTool = (governor: IGovernor) => buildTool({
  name: 'ScoutTool',
  description: `Inspect an npm or PyPI package: version, install command, exports, dependencies, README excerpt.

Use this instead of WebSearch when you need "what is this package, how do I use it?" — it fetches structured registry data and returns a compact answer.

# When to use
- Before adding a new dependency (check version, license, size)
- When the user mentions a package name and asks how to use it
- Replacing trial-and-error imports with the actual export map

# Aspect
- **all** (default): full summary — description, install, exports, README excerpt
- **api**: description, exports, types only (no README)
- **readme**: full README excerpt only
- **versions**: recent version history`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      package: { type: 'string', description: 'Package name (e.g. "zod", "react", "axios").' },
      aspect: { type: 'string', enum: ['all', 'api', 'readme', 'versions'], description: 'What to return (default: all).' },
      registry: { type: 'string', enum: ['npm', 'pypi'], description: 'Package registry (default: npm).' },
    },
    required: ['package'],
  },
  execute: async (args: ScoutArgs) => {
    const pkg = (args.package || '').trim();
    if (!pkg) return 'Error: package name is required.';
    const aspect = args.aspect || 'all';
    const registry = args.registry || 'npm';

    try {
      if (registry === 'pypi') return await scoutPypi(pkg, aspect);
      return await scoutNpm(pkg, aspect);
    } catch (e: any) {
      if (e.message === 'timeout') return `Scout timed out fetching "${pkg}" from ${registry}. Try WebFetchTool for a direct URL.`;
      if (e instanceof SyntaxError) return `Scout: "${pkg}" not found in ${registry} registry (or registry returned non-JSON). Check the spelling.`;
      return `Scout error for "${pkg}": ${e.message}`;
    }
  },
}, governor);
