import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

// Actually launches a generated LLM training scaffold. Spawns `python3 train.py [--smoke]` in the
// build dir as a detached background process so it survives the agent turn, captures stdout/stderr to
// train.log, and records {pid, cmd, log, metrics, startedAt} to .bimax/launches/<run>.json. The Verify
// stage (TrainMonitorTool) tails the metrics.jsonl the script writes alongside its log.

export interface LaunchSpec {
  run: string;
  dir: string;        // build dir (absolute)
  cmd: string;        // the command line, for display
  pid: number;
  log: string;        // absolute path to train.log
  metrics: string;    // absolute path to metrics.jsonl
  smoke: boolean;
  startedAt: string;
}

export interface LaunchStatus {
  run: string;
  pid: number;
  running: boolean;
  cmd: string;
  smoke: boolean;
  startedAt: string;
  log: string;
  metrics: string;
  metricsLines: number;
  tail: string[];     // last lines of train.log
}

const LAUNCH_DIR = '.bimax/launches';

export class TrainLauncher {
  constructor(private projectRoot: string, private python = process.env.BIMAX_PYTHON || 'python3') {}

  private get dir(): string { return path.join(this.projectRoot, LAUNCH_DIR); }
  private recPath(run: string): string { return path.join(this.dir, `${run}.json`); }

  private resolveDir(dir: string): string {
    return path.isAbsolute(dir) ? dir : path.join(this.projectRoot, dir);
  }

  /** Spawn `python train.py [--smoke]` in the build dir, detached, logging to train.log. */
  launch(run: string, dir: string, opts: { smoke?: boolean } = {}): LaunchSpec | { error: string } {
    const buildDir = this.resolveDir(dir);
    const script = path.join(buildDir, 'train.py');
    if (!fs.existsSync(script)) return { error: `No train.py in ${dir}. Build the Blueprint first (BlueprintTool build).` };

    const existing = this.load(run);
    if (existing && this.isAlive(existing.pid)) {
      return { error: `Run "${run}" is already running (pid ${existing.pid}). Stop it first with action "stop".` };
    }

    fs.mkdirSync(this.dir, { recursive: true });
    const log = path.join(buildDir, 'train.log');
    const metrics = path.join(buildDir, 'metrics.jsonl');
    const out = fs.openSync(log, 'a');
    const args = ['-u', 'train.py', ...(opts.smoke ? ['--smoke'] : [])];

    let child;
    try {
      child = spawn(this.python, args, { cwd: buildDir, detached: true, stdio: ['ignore', out, out] });
    } catch (e: any) {
      fs.closeSync(out);
      return { error: `Could not start ${this.python}: ${e.message}. Set BIMAX_PYTHON to your interpreter.` };
    }
    fs.closeSync(out);
    if (typeof child.pid !== 'number') return { error: 'Process failed to start (no pid).' };
    child.unref();

    const spec: LaunchSpec = {
      run, dir: buildDir,
      cmd: `${this.python} ${args.join(' ')}`,
      pid: child.pid, log, metrics, smoke: !!opts.smoke,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.recPath(run), JSON.stringify(spec, null, 2), 'utf8');
    return spec;
  }

  status(run: string): LaunchStatus | { error: string } {
    const spec = this.load(run);
    if (!spec) return { error: `No launch "${run}". Start one with action "launch".` };
    return {
      run: spec.run, pid: spec.pid, running: this.isAlive(spec.pid),
      cmd: spec.cmd, smoke: spec.smoke, startedAt: spec.startedAt,
      log: spec.log, metrics: spec.metrics,
      metricsLines: this.countLines(spec.metrics),
      tail: this.tail(spec.log, 12),
    };
  }

  stop(run: string): string | { error: string } {
    const spec = this.load(run);
    if (!spec) return { error: `No launch "${run}".` };
    if (!this.isAlive(spec.pid)) return `Run "${run}" (pid ${spec.pid}) is already stopped.`;
    try {
      // Detached child is its own process-group leader; kill the group.
      try { process.kill(-spec.pid, 'SIGTERM'); } catch { process.kill(spec.pid, 'SIGTERM'); }
      return `Sent SIGTERM to "${run}" (pid ${spec.pid}).`;
    } catch (e: any) {
      return { error: `Could not stop pid ${spec.pid}: ${e.message}` };
    }
  }

  list(): LaunchSpec[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as LaunchSpec; } catch { return null; } })
      .filter((s): s is LaunchSpec => s !== null);
  }

  private load(run: string): LaunchSpec | null {
    try { return JSON.parse(fs.readFileSync(this.recPath(run), 'utf8')); } catch { return null; }
  }

  private isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; }
  }

  private countLines(p: string): number {
    try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
  }

  private tail(p: string, n: number): string[] {
    try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; }
  }

  format(s: LaunchStatus): string {
    return [
      `🚀 Launch "${s.run}"  ·  pid ${s.pid}  ·  ${s.running ? 'RUNNING' : 'stopped'}${s.smoke ? '  ·  [smoke]' : ''}`,
      `  cmd: ${s.cmd}   (started ${s.startedAt})`,
      `  metrics.jsonl: ${s.metricsLines} step(s) written  →  TrainMonitorTool status run="${s.run}"`,
      ...(s.tail.length ? [`  log tail:`, ...s.tail.map(l => `    ${l}`)] : [`  (no log output yet)`]),
    ].join('\n');
  }
}

let _launcher: TrainLauncher | null = null;
export function getTrainLauncher(): TrainLauncher | null { return _launcher; }
export function setTrainLauncher(l: TrainLauncher): void { _launcher = l; }
