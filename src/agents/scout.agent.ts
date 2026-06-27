import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ScoutReport {
  url: string;
  repoName: string;
  defaultBranch: string;
  topFiles: string[];
  entryPoints: string[];
  languages: Record<string, number>;
  readme: string;
  packageJson?: Record<string, any>;
  exportedSymbols: string[];
  error?: string;
}

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.rb': 'Ruby',
  '.cs': 'C#', '.cpp': 'C++', '.c': 'C', '.swift': 'Swift', '.kt': 'Kotlin',
};

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', 'target', 'dist', 'build', '.next']);

/** Recursively enumerate files, skipping well-known vendor/build dirs. */
function* walkFiles(dir: string): Generator<{ fullPath: string; size: number }> {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const fullPath = path.join(dir, e.name);
    if (e.isDirectory()) { yield* walkFiles(fullPath); }
    else if (e.isFile()) {
      try { yield { fullPath, size: fs.statSync(fullPath).size }; } catch { /* skip unreadable */ }
    }
  }
}

function detectLanguages(dir: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { fullPath } of walkFiles(dir)) {
    const lang = EXT_TO_LANG[path.extname(fullPath).toLowerCase()];
    if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
  }
  return counts;
}

function topFilesBySize(dir: string, limit = 20): string[] {
  const files: { rel: string; size: number }[] = [];
  for (const { fullPath, size } of walkFiles(dir)) {
    files.push({ rel: path.relative(dir, fullPath), size });
  }
  return files
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
    .map(f => f.rel);
}

function findEntryPoints(dir: string): string[] {
  const candidates = [
    'src/index.ts', 'src/main.ts', 'index.ts', 'main.ts',
    'src/index.js', 'index.js', 'main.py', '__main__.py', 'main.go', 'src/lib.rs',
  ];
  return candidates.filter(c => fs.existsSync(path.join(dir, c)));
}

function extractExportedSymbols(dir: string, limit = 20): string[] {
  const symbols: string[] = [];
  try {
    const out = execSync(
      `grep -r --include="*.ts" --include="*.js" -h "^export " . 2>/dev/null | head -${limit}`,
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }
    );
    for (const line of out.trim().split('\n').filter(Boolean).slice(0, limit)) {
      symbols.push(line.trim().slice(0, 120));
    }
  } catch { /* ignore */ }
  return symbols;
}

/**
 * ScoutAgent — read-only repo inspector. Shallow-clones a remote git repository into a temp
 * directory, extracts structural information (languages, entry points, exports, README),
 * then deletes the clone. Never writes to the user's working directory.
 */
export class ScoutAgent {
  async inspect(url: string): Promise<ScoutReport> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-scout-'));
    const repoName = url.split('/').pop()?.replace(/\.git$/, '') ?? 'unknown';

    try {
      try {
        execFileSync('git', ['clone', '--depth=1', '--quiet', url, tmpDir], {
          timeout: 60000,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } catch (e: any) {
        return {
          url, repoName, defaultBranch: '', topFiles: [], entryPoints: [],
          languages: {}, readme: '', exportedSymbols: [],
          error: `Clone failed: ${e.message?.slice(0, 200)}`,
        };
      }

      let branch = 'main';
      try {
        branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: tmpDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || 'main';
      } catch { /* use default */ }

      const readmePath = ['README.md', 'readme.md', 'README.txt', 'README']
        .find(r => fs.existsSync(path.join(tmpDir, r)));
      let readme = '';
      if (readmePath) {
        try { readme = fs.readFileSync(path.join(tmpDir, readmePath), 'utf8').slice(0, 2000); } catch { /* ignore */ }
      }

      let packageJson: Record<string, any> | undefined;
      const pkgPath = path.join(tmpDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try { packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { /* ignore */ }
      }

      return {
        url,
        repoName,
        defaultBranch: branch,
        topFiles: topFilesBySize(tmpDir),
        entryPoints: findEntryPoints(tmpDir),
        languages: detectLanguages(tmpDir),
        readme,
        packageJson,
        exportedSymbols: extractExportedSymbols(tmpDir),
      };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

export function formatScoutReport(r: ScoutReport): string {
  if (r.error) return `Scout failed: ${r.error}`;

  const lines: string[] = [
    `## Scout Report: ${r.repoName}`,
    `URL: ${r.url}  branch: ${r.defaultBranch}`,
    '',
  ];

  const langStr = Object.entries(r.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `${l} (${n})`)
    .join(', ');
  if (langStr) lines.push(`**Languages:** ${langStr}`, '');

  if (r.entryPoints.length > 0) lines.push(`**Entry points:** ${r.entryPoints.join(', ')}`, '');

  if (r.packageJson) {
    const name = r.packageJson.name ?? r.repoName;
    const desc = r.packageJson.description ?? '';
    const ver = r.packageJson.version ?? '';
    lines.push(`**Package:** ${name}${ver ? ` v${ver}` : ''}${desc ? ` — ${desc}` : ''}`, '');
    const deps = Object.keys(r.packageJson.dependencies ?? {}).slice(0, 10).join(', ');
    if (deps) lines.push(`**Key deps:** ${deps}`, '');
  }

  if (r.exportedSymbols.length > 0) {
    lines.push('**Top exports:**');
    for (const s of r.exportedSymbols.slice(0, 10)) lines.push(`  ${s}`);
    lines.push('');
  }

  if (r.topFiles.length > 0) {
    lines.push('**Top files by size:**');
    for (const f of r.topFiles.slice(0, 10)) lines.push(`  ${f}`);
    lines.push('');
  }

  if (r.readme) {
    lines.push('**README (first 2000 chars):**', '```');
    lines.push(r.readme);
    lines.push('```');
  }

  return lines.join('\n');
}
