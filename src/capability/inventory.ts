// Read-only environment inventory — owner section 29 (V29B), slice S29-A steps 2 and 4.
//
// docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §18: the resolver is
// "inspect → explain → propose → approve → transact → verify", never "detect missing tool and
// install it". This file is the *inspect* half and nothing else. It cannot install, cannot mutate,
// and — the constraint that shapes the whole design — cannot execute project code.
//
// That last rule is enforced structurally rather than by discipline. Every subprocess this module
// can run comes from `VERSION_PROBES`, a fixed table of well-known tools invoked with a fixed
// version flag. There is no code path that takes a command from a project file, a lockfile, a shell
// profile or a manifest and runs it. The acceptance gate says "read-only inventory does not execute
// project scripts, source untrusted shell profiles, expose secrets or mutate the environment"; a
// table is the only version of that claim a test can actually falsify.
//
// The second design rule is that "missing" and "unknown" are different answers. §18 requires a plan
// to identify "already satisfied requirements", "incompatible or ambiguous versions" and "missing
// optional versus required components" — five states, not a boolean. A probe that did not run
// produces `unverified`, never `missing`.

import { Identity } from '../evidence/schema';
import { isInside, normalizePath } from '../evidence/path.class';

/** How Bimax came to know about an executable. §18: "record provenance for every detected executable". */
export type ToolProvenance =
  | 'system'          // shipped with macOS
  | 'vendor'          // Xcode and other vendor-installed developer tooling
  | 'package-manager' // Homebrew, MacPorts
  | 'version-manager' // nvm, pyenv, rbenv, asdf, mise, cargo, bun
  | 'project-local'   // node_modules/.bin, .venv/bin — scoped to this project
  | 'user'            // somewhere in the user's home Bimax cannot attribute
  | 'unknown';

export function toolProvenance(executablePath: string, opts: { home: string; projectRoot?: string | null }): ToolProvenance {
  const path = normalizePath(executablePath);
  const { home, projectRoot } = opts;
  if (projectRoot && isInside(path, projectRoot)) return 'project-local';
  if (['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/libexec'].some(p => isInside(path, p))) return 'system';
  if (isInside(path, '/Library/Developer') || /^\/Applications\/Xcode[^/]*\.app\//.test(path)) return 'vendor';
  if (['/opt/homebrew', '/usr/local', '/opt/local'].some(p => isInside(path, p))) return 'package-manager';
  const managerRoots = ['.nvm', '.pyenv', '.rbenv', '.rvm', '.asdf', '.local/share/mise', '.cargo', '.bun', '.sdkman', '.volta']
    .map(dir => `${home}/${dir}`);
  if (managerRoots.some(root => isInside(path, root))) return 'version-manager';
  if (isInside(path, home)) return 'user';
  return 'unknown';
}

/**
 * The complete set of subprocesses the inventory may run. Nothing outside this table is executed,
 * ever, from any input. Each entry is a well-known tool asked for its own version.
 */
export const VERSION_PROBES: ReadonlyArray<{ tool: string; args: string[] }> = Object.freeze([
  { tool: 'node', args: ['--version'] },
  { tool: 'npm', args: ['--version'] },
  { tool: 'pnpm', args: ['--version'] },
  { tool: 'yarn', args: ['--version'] },
  { tool: 'bun', args: ['--version'] },
  { tool: 'deno', args: ['--version'] },
  { tool: 'python3', args: ['--version'] },
  { tool: 'pip3', args: ['--version'] },
  { tool: 'ruby', args: ['--version'] },
  { tool: 'go', args: ['version'] },
  { tool: 'cargo', args: ['--version'] },
  { tool: 'rustc', args: ['--version'] },
  { tool: 'java', args: ['-version'] },
  { tool: 'swift', args: ['--version'] },
  { tool: 'git', args: ['--version'] },
  { tool: 'brew', args: ['--version'] },
  { tool: 'xcodebuild', args: ['-version'] },
  { tool: 'xcrun', args: ['--version'] },
  { tool: 'adb', args: ['version'] },
  { tool: 'docker', args: ['--version'] },
]);

const PROBE_INDEX = new Map(VERSION_PROBES.map(probe => [probe.tool, probe.args]));

export function isAllowedProbe(tool: string, args: string[]): boolean {
  const allowed = PROBE_INDEX.get(tool);
  return Boolean(allowed) && JSON.stringify(allowed) === JSON.stringify(args);
}

/** The host surface the inventory reads. Injected so the whole module is testable off-machine. */
export interface InventoryHost {
  arch: string;
  macosVersion: string;
  home: string;
  readFile(path: string): Promise<string | null>;
  listDir(path: string): Promise<string[]>;
  /** Resolve an executable on PATH. Must not source a shell profile to do it. */
  which(tool: string): Promise<string | null>;
  /** Run one allowed probe. Implementations must reject anything `isAllowedProbe` rejects. */
  probeVersion(tool: string, args: string[]): Promise<string | null>;
}

export type RequirementStatus = 'satisfied' | 'missing' | 'ambiguous' | 'incompatible' | 'unverified';

export interface DetectedTool {
  tool: string;
  path: string | null;
  version: string | null;
  provenance: ToolProvenance;
  /** Why the version is unknown, when it is. Empty when the probe succeeded. */
  note: string;
}

export interface ProjectDeclaration {
  /** Relative to the project root, so the inventory is portable and leaks no home directory. */
  file: string;
  kind: 'manifest' | 'lockfile' | 'toolchain-pin' | 'ci' | 'container' | 'workspace';
  ecosystem: string;
}

export interface Requirement {
  tool: string;
  /** The constraint as the project wrote it. Never normalized away — ambiguity is information. */
  constraint: string;
  source: string;
  required: boolean;
}

export interface ResolvedRequirement extends Requirement {
  status: RequirementStatus;
  detected: DetectedTool | null;
  explanation: string;
}

export interface EnvironmentInventory {
  /** Fixed field order and no timestamps, so the same machine and project produce the same bytes. */
  arch: string;
  macosVersion: string;
  projectRoot: string | null;
  declarations: ProjectDeclaration[];
  tools: DetectedTool[];
  requirements: ResolvedRequirement[];
  /** Everything the inventory deliberately did not look at, so absence is never read as evidence. */
  notInspected: string[];
}

/** Files whose *presence* is a declaration. Read for constraints, never executed. */
const DECLARATION_FILES: ReadonlyArray<Omit<ProjectDeclaration, 'file'> & { file: string }> = [
  { file: 'package.json', kind: 'manifest', ecosystem: 'node' },
  { file: 'package-lock.json', kind: 'lockfile', ecosystem: 'node' },
  { file: 'pnpm-lock.yaml', kind: 'lockfile', ecosystem: 'node' },
  { file: 'yarn.lock', kind: 'lockfile', ecosystem: 'node' },
  { file: 'bun.lockb', kind: 'lockfile', ecosystem: 'node' },
  { file: 'pnpm-workspace.yaml', kind: 'workspace', ecosystem: 'node' },
  { file: '.nvmrc', kind: 'toolchain-pin', ecosystem: 'node' },
  { file: 'pyproject.toml', kind: 'manifest', ecosystem: 'python' },
  { file: 'requirements.txt', kind: 'manifest', ecosystem: 'python' },
  { file: 'poetry.lock', kind: 'lockfile', ecosystem: 'python' },
  { file: '.python-version', kind: 'toolchain-pin', ecosystem: 'python' },
  { file: 'Cargo.toml', kind: 'manifest', ecosystem: 'rust' },
  { file: 'Cargo.lock', kind: 'lockfile', ecosystem: 'rust' },
  { file: 'go.mod', kind: 'manifest', ecosystem: 'go' },
  { file: 'go.sum', kind: 'lockfile', ecosystem: 'go' },
  { file: 'Gemfile', kind: 'manifest', ecosystem: 'ruby' },
  { file: 'Gemfile.lock', kind: 'lockfile', ecosystem: 'ruby' },
  { file: 'Package.swift', kind: 'manifest', ecosystem: 'swift' },
  { file: 'Podfile', kind: 'manifest', ecosystem: 'cocoapods' },
  { file: 'Podfile.lock', kind: 'lockfile', ecosystem: 'cocoapods' },
  { file: 'build.gradle', kind: 'manifest', ecosystem: 'android' },
  { file: 'build.gradle.kts', kind: 'manifest', ecosystem: 'android' },
  { file: 'pubspec.yaml', kind: 'manifest', ecosystem: 'flutter' },
  { file: '.tool-versions', kind: 'toolchain-pin', ecosystem: 'asdf' },
  { file: 'Dockerfile', kind: 'container', ecosystem: 'docker' },
  { file: 'docker-compose.yml', kind: 'container', ecosystem: 'docker' },
];

/** Things this inventory does not read, stated out loud rather than left as a silent hole. */
export const NOT_INSPECTED: ReadonlyArray<string> = Object.freeze([
  'shell profiles (~/.zshrc and friends) — sourcing an untrusted profile to learn PATH is forbidden',
  'project scripts and lifecycle hooks — discovery never executes project code',
  'environment variables — never collected wholesale, and never stored',
  'credentials, keychains and registry tokens — outside the collection contract entirely',
  'installed package inventories beyond declared manifests — a later slice, behind structured output',
]);

/**
 * Extract version constraints from the declarations Bimax can parse.
 *
 * Deliberately narrow. A constraint Bimax reads wrong is worse than one it does not read: it would
 * produce a confident `incompatible` about a project that is fine. Anything unparsed simply does
 * not appear, and the file still appears in `declarations` so the user can see it was noticed.
 */
export function extractRequirements(file: string, content: string): Requirement[] {
  if (file === 'package.json') {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const engines = (parsed.engines ?? {}) as Record<string, unknown>;
      const packageManager = typeof parsed.packageManager === 'string' ? parsed.packageManager : '';
      const out: Requirement[] = Object.entries(engines)
        .filter(([, range]) => typeof range === 'string')
        .map(([tool, range]) => ({ tool, constraint: String(range), source: file, required: true }));
      const pm = /^([a-z]+)@(\d+\.\d+\.\d+)/.exec(packageManager);
      if (pm) out.push({ tool: pm[1], constraint: pm[2], source: `${file} (packageManager)`, required: true });
      return out;
    } catch {
      return [];
    }
  }
  if (file === '.nvmrc') {
    const value = content.trim().replace(/^v/, '');
    return value ? [{ tool: 'node', constraint: value, source: file, required: true }] : [];
  }
  if (file === '.python-version') {
    const value = content.trim();
    return value ? [{ tool: 'python3', constraint: value, source: file, required: true }] : [];
  }
  if (file === '.tool-versions') {
    return content.split('\n').flatMap(line => {
      const match = /^([a-z0-9_-]+)\s+([^\s#]+)/.exec(line.trim());
      return match ? [{ tool: match[1], constraint: match[2], source: file, required: true }] : [];
    });
  }
  if (file === 'go.mod') {
    const match = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(content);
    return match ? [{ tool: 'go', constraint: `>=${match[1]}`, source: file, required: true }] : [];
  }
  return [];
}

/** Pull a bare version out of a probe's chatty output: `v22.1.0`, `go version go1.22 darwin/arm64`. */
export function parseVersion(raw: string | null): string | null {
  if (!raw) return null;
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(raw);
  return match ? match[1] : null;
}

const compare = (a: string, b: string): number => {
  const parse = (v: string) => v.split('.').map(n => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
};

/**
 * Decide one requirement's status.
 *
 * The `ambiguous` state is the one that earns its keep: a range like `^20 || ^22` is satisfiable by
 * versions Bimax cannot rank with the narrow comparator it has, and saying so is honest where
 * guessing either way is not.
 */
export function resolveRequirement(requirement: Requirement, detected: DetectedTool | null): ResolvedRequirement {
  const base = { ...requirement, detected };
  if (!detected || !detected.path) {
    return { ...base, status: 'missing', explanation: `${requirement.tool} was not found on PATH` };
  }
  if (!detected.version) {
    return {
      ...base, status: 'unverified',
      explanation: `${requirement.tool} is installed at ${detected.path} but its version could not be read: ${detected.note || 'the probe returned nothing'}`,
    };
  }
  const constraint = requirement.constraint.trim();
  if (/\|\||\s-\s|,/.test(constraint)) {
    return {
      ...base, status: 'ambiguous',
      explanation: `the constraint "${constraint}" has alternatives Bimax does not rank; ${detected.tool} ${detected.version} is installed`,
    };
  }
  const range = /^([><]=?|\^|~)?\s*v?(\d+(?:\.\d+)*)$/.exec(constraint);
  if (!range) {
    return {
      ...base, status: 'ambiguous',
      explanation: `the constraint "${constraint}" is not one Bimax parses; ${detected.tool} ${detected.version} is installed`,
    };
  }
  const [, operator = '', wanted] = range;
  const cmp = compare(detected.version, wanted);
  const major = (v: string) => v.split('.')[0];
  const minor = (v: string) => v.split('.').slice(0, 2).join('.');
  const satisfied = operator === '>=' ? cmp >= 0
    : operator === '>' ? cmp > 0
      : operator === '<=' ? cmp <= 0
        : operator === '<' ? cmp < 0
          : operator === '^' ? major(detected.version) === major(wanted) && cmp >= 0
            : operator === '~' ? minor(detected.version) === minor(wanted) && cmp >= 0
              // A bare version in a pin file means "at least", which is how nvm and asdf read it.
              : cmp >= 0;
  return satisfied
    ? { ...base, status: 'satisfied', explanation: `${detected.tool} ${detected.version} satisfies ${constraint}` }
    : {
      ...base, status: 'incompatible',
      explanation: `${detected.tool} ${detected.version} does not satisfy ${constraint} (installed via ${detected.provenance})`,
    };
}

/**
 * Build the inventory. Reads declarations, resolves the allowed tools, and resolves requirements.
 * Performs no mutation and executes nothing outside `VERSION_PROBES`.
 */
export async function inventory(host: InventoryHost, projectRoot: string | null): Promise<EnvironmentInventory> {
  const declarations: ProjectDeclaration[] = [];
  const requirements: Requirement[] = [];

  if (projectRoot) {
    const present = new Set(await host.listDir(projectRoot).catch(() => []));
    for (const candidate of DECLARATION_FILES) {
      if (!present.has(candidate.file)) continue;
      declarations.push(candidate);
      const content = await host.readFile(`${projectRoot}/${candidate.file}`);
      if (content) requirements.push(...extractRequirements(candidate.file, content));
    }
  }

  const tools: DetectedTool[] = [];
  for (const probe of VERSION_PROBES) {
    const resolved = await host.which(probe.tool).catch(() => null);
    if (!resolved) continue;
    let raw: string | null = null;
    let note = '';
    try {
      raw = await host.probeVersion(probe.tool, [...probe.args]);
    } catch (error) {
      note = (error as Error).message || 'the probe failed';
    }
    tools.push({
      tool: probe.tool,
      path: normalizePath(resolved),
      version: parseVersion(raw),
      provenance: toolProvenance(resolved, { home: host.home, projectRoot }),
      note: raw === null && !note ? 'the probe produced no output' : note,
    });
  }

  const byTool = new Map(tools.map(tool => [tool.tool, tool]));
  const resolved = requirements
    .map(requirement => resolveRequirement(requirement, byTool.get(requirement.tool) ?? null))
    // Sorted so the same project always produces the same bytes: S29-01 grades determinism.
    .sort((a, b) => (a.tool === b.tool ? a.source.localeCompare(b.source) : a.tool.localeCompare(b.tool)));

  return {
    arch: host.arch,
    macosVersion: host.macosVersion,
    projectRoot: projectRoot ? normalizePath(projectRoot) : null,
    declarations: declarations.slice().sort((a, b) => a.file.localeCompare(b.file)),
    tools: tools.slice().sort((a, b) => a.tool.localeCompare(b.tool)),
    requirements: resolved,
    notInspected: [...NOT_INSPECTED],
  };
}

/** Identities for the Trust Center, one per detected tool. */
export function inventoryIdentities(snapshot: EnvironmentInventory): Identity[] {
  return snapshot.tools.map(tool => ({
    kind: 'executable',
    id: tool.path ?? tool.tool,
    display: tool.version ? `${tool.tool} ${tool.version}` : tool.tool,
    provenance: 'observed',
  }));
}
