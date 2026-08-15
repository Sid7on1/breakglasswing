import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * Desktop-owned, read-only capability inventory for the Environment and ML Alchemist lanes.
 *
 * The inventory never sources shell profiles and never executes project scripts. Every process
 * comes from this fixed table, receives fixed arguments, has a short deadline, and returns bounded
 * output. This is the inspect stage of `inspect -> explain -> propose -> approve -> transact ->
 * verify`; it has intentionally no install or mutation API.
 */

export type CapabilityState = 'ready' | 'missing' | 'unverified';

export interface WorkspaceToolStatus {
  id: string;
  label: string;
  category: 'runtime' | 'package-manager' | 'sdk' | 'service' | 'ml';
  state: CapabilityState;
  version: string | null;
  executable: string | null;
  note: string;
}

export interface WorkspaceDeclaration {
  file: string;
  ecosystem: string;
}

export interface EnvironmentCapabilitySnapshot {
  generatedAt: string;
  projectName: string;
  declarations: WorkspaceDeclaration[];
  tools: WorkspaceToolStatus[];
  safety: {
    mutating: false;
    sourcedShellProfiles: false;
    executedProjectScripts: false;
  };
}

export interface AlchemistCapabilitySnapshot {
  generatedAt: string;
  state: 'ready' | 'partial' | 'unavailable';
  backends: Array<{
    id: 'mlx' | 'coremltools' | 'llama.cpp' | 'ollama';
    label: string;
    role: string;
    state: CapabilityState;
    version: string | null;
  }>;
  workflows: Array<{
    id: 'inspect' | 'quantize' | 'fine-tune' | 'compare' | 'export';
    label: string;
    available: boolean;
    detail: string;
  }>;
  boundary: string;
}

interface Probe {
  id: string;
  label: string;
  category: WorkspaceToolStatus['category'];
  command: string;
  args: string[];
}

const execFileAsync = promisify(execFile);

const PROBES: ReadonlyArray<Probe> = Object.freeze([
  { id: 'node', label: 'Node.js', category: 'runtime', command: 'node', args: ['--version'] },
  { id: 'python3', label: 'Python', category: 'runtime', command: 'python3', args: ['--version'] },
  { id: 'swift', label: 'Swift', category: 'runtime', command: 'swift', args: ['--version'] },
  { id: 'git', label: 'Git', category: 'runtime', command: 'git', args: ['--version'] },
  { id: 'npm', label: 'npm', category: 'package-manager', command: 'npm', args: ['--version'] },
  { id: 'pnpm', label: 'pnpm', category: 'package-manager', command: 'pnpm', args: ['--version'] },
  { id: 'bun', label: 'Bun', category: 'package-manager', command: 'bun', args: ['--version'] },
  { id: 'uv', label: 'uv', category: 'package-manager', command: 'uv', args: ['--version'] },
  { id: 'brew', label: 'Homebrew', category: 'package-manager', command: 'brew', args: ['--version'] },
  { id: 'xcodebuild', label: 'Xcode', category: 'sdk', command: 'xcodebuild', args: ['-version'] },
  { id: 'docker', label: 'Docker', category: 'service', command: 'docker', args: ['--version'] },
  { id: 'ollama', label: 'Ollama', category: 'ml', command: 'ollama', args: ['--version'] },
  { id: 'llama.cpp', label: 'llama.cpp', category: 'ml', command: 'llama-cli', args: ['--version'] },
]);

const DECLARATIONS: ReadonlyArray<{ file: string; ecosystem: string }> = Object.freeze([
  { file: 'package.json', ecosystem: 'Node' },
  { file: 'package-lock.json', ecosystem: 'Node' },
  { file: 'pnpm-lock.yaml', ecosystem: 'Node' },
  { file: 'yarn.lock', ecosystem: 'Node' },
  { file: 'bun.lock', ecosystem: 'Node' },
  { file: 'pyproject.toml', ecosystem: 'Python' },
  { file: 'uv.lock', ecosystem: 'Python' },
  { file: 'requirements.txt', ecosystem: 'Python' },
  { file: 'Package.swift', ecosystem: 'Swift' },
  { file: 'Cargo.toml', ecosystem: 'Rust' },
  { file: 'go.mod', ecosystem: 'Go' },
  { file: 'Dockerfile', ecosystem: 'Containers' },
  { file: 'docker-compose.yml', ecosystem: 'Containers' },
  { file: '.nvmrc', ecosystem: 'Node' },
  { file: '.python-version', ecosystem: 'Python' },
  { file: '.tool-versions', ecosystem: 'Toolchains' },
]);

function firstVersion(text: string): string | null {
  return text.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null;
}

async function executablePath(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/which', [command], {
      timeout: 2_000,
      maxBuffer: 16 * 1024,
      encoding: 'utf8',
    });
    const value = stdout.trim().split('\n')[0];
    return value.startsWith('/') ? value : null;
  } catch {
    return null;
  }
}

async function probeTool(probe: Probe): Promise<WorkspaceToolStatus> {
  const executable = await executablePath(probe.command);
  if (!executable) {
    return {
      id: probe.id, label: probe.label, category: probe.category, state: 'missing',
      version: null, executable: null, note: 'Not found on the app runtime PATH.',
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(executable, probe.args, {
      timeout: 3_000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin' },
    });
    const output = `${stdout}\n${stderr}`.trim();
    return {
      id: probe.id, label: probe.label, category: probe.category, state: 'ready',
      version: firstVersion(output), executable, note: output.split('\n')[0]?.slice(0, 180) || 'Version probe completed.',
    };
  } catch (error) {
    return {
      id: probe.id, label: probe.label, category: probe.category, state: 'unverified',
      version: null, executable,
      note: error instanceof Error ? error.message.slice(0, 180) : 'The fixed version probe failed.',
    };
  }
}

async function mapLimited<T, R>(values: readonly T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await fn(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

async function declarations(projectRoot: string): Promise<WorkspaceDeclaration[]> {
  const found = await Promise.all(DECLARATIONS.map(async (entry) => {
    try {
      await access(path.join(projectRoot, entry.file));
      return entry;
    } catch {
      return null;
    }
  }));
  return found.filter((entry): entry is WorkspaceDeclaration => entry !== null);
}

export async function inspectEnvironmentCapabilities(projectRoot: string): Promise<EnvironmentCapabilitySnapshot> {
  const [projectDeclarations, tools] = await Promise.all([
    declarations(projectRoot),
    mapLimited(PROBES, 4, probeTool),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    projectName: path.basename(projectRoot),
    declarations: projectDeclarations,
    tools,
    safety: { mutating: false, sourcedShellProfiles: false, executedProjectScripts: false },
  };
}

async function pythonPackageVersion(packageName: 'mlx' | 'coremltools'): Promise<string | null> {
  const python = await executablePath('python3');
  if (!python) return null;
  const program = [
    'import importlib.metadata as m',
    `name=${JSON.stringify(packageName)}`,
    'try: print(m.version(name))',
    'except m.PackageNotFoundError: pass',
  ].join('\n');
  try {
    const { stdout } = await execFileAsync(python, ['-I', '-c', program], {
      timeout: 3_000,
      maxBuffer: 16 * 1024,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin' },
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function inspectAlchemistCapabilities(environment?: EnvironmentCapabilitySnapshot): Promise<AlchemistCapabilitySnapshot> {
  const tools = environment?.tools ?? await mapLimited(PROBES, 4, probeTool);
  const [mlx, coremltools] = await Promise.all([
    pythonPackageVersion('mlx'),
    pythonPackageVersion('coremltools'),
  ]);
  const llama = tools.find((tool) => tool.id === 'llama.cpp');
  const ollama = tools.find((tool) => tool.id === 'ollama');
  const backends: AlchemistCapabilitySnapshot['backends'] = [
    { id: 'mlx', label: 'MLX', role: 'Apple-silicon research, fine-tuning and generation', state: mlx ? 'ready' : 'missing', version: mlx },
    { id: 'coremltools', label: 'Core ML Tools', role: 'Conversion, pruning, palettization and deployment', state: coremltools ? 'ready' : 'missing', version: coremltools },
    { id: 'llama.cpp', label: 'llama.cpp', role: 'GGUF quantization and local Metal inference', state: llama?.state ?? 'missing', version: llama?.version ?? null },
    { id: 'ollama', label: 'Ollama', role: 'Optional local model serving', state: ollama?.state ?? 'missing', version: ollama?.version ?? null },
  ];
  const hasResearch = Boolean(mlx);
  const hasDeployment = Boolean(coremltools);
  const hasLocalInference = llama?.state === 'ready' || ollama?.state === 'ready';
  const readyCount = backends.filter((backend) => backend.state === 'ready').length;
  return {
    generatedAt: new Date().toISOString(),
    state: hasResearch && hasDeployment ? 'ready' : readyCount > 0 ? 'partial' : 'unavailable',
    backends,
    workflows: [
      { id: 'inspect', label: 'Inspect architecture', available: hasResearch || hasDeployment || hasLocalInference, detail: 'Read format, parameter graph, size, provenance and compatibility before loading.' },
      { id: 'quantize', label: 'Quantize & compress', available: hasResearch || hasDeployment || llama?.state === 'ready', detail: 'Compare named INT4/INT8, palettization or GGUF candidates against the baseline.' },
      { id: 'fine-tune', label: 'LoRA / QLoRA experiment', available: hasResearch, detail: 'Requires MLX plus a declared dataset and reproducibility contract.' },
      { id: 'compare', label: 'Compare candidates', available: hasResearch || hasDeployment || hasLocalInference, detail: 'Quality, behavior, latency, memory, size, energy proxy and device support.' },
      { id: 'export', label: 'Verify & export', available: hasDeployment || llama?.state === 'ready', detail: 'Export only a candidate whose digest and evaluation contract pass.' },
    ],
    boundary: 'Backends run in isolated workers over immutable artifact handles. Pickle input and in-place checkpoint mutation are refused.',
  };
}

/** Best-effort, bounded project identity used only by tests and diagnostics. */
export async function readProjectPackageName(projectRoot: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')) as { name?: unknown };
    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
}
