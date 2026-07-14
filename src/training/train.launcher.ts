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
  script: string;     // the python entrypoint (train.py | eval.py)
  cmd: string;        // the command line, for display
  pid: number;
  log: string;        // absolute path to <script>.log
  metrics: string;    // absolute path to metrics.jsonl
  smoke: boolean;
  startedAt: string;
  /** Baselines make readiness belong to this launch, not stale files from an older run. */
  metricsLinesAtStart?: number;
  resultsMtimeAtStart?: number;
}

export interface LaunchStatus {
  run: string;
  pid: number;
  running: boolean;
  script: string;
  cmd: string;
  smoke: boolean;
  startedAt: string;
  log: string;
  metrics: string;
  metricsLines: number;
  results?: Record<string, any>;  // eval_results.json, when present
  tail: string[];     // last lines of the run log
}

export interface LaunchReadiness {
  ready: boolean;
  status: LaunchStatus;
  reason: string;
}

export interface ReadinessOptions {
  timeoutMs?: number;
  pollMs?: number;
  /** Training readiness requires this many new metrics written by the current process. */
  minMetricsLines?: number;
}

const LAUNCH_DIR = '.bimax/launches';

export class TrainLauncher {
  constructor(private projectRoot: string, private python = process.env.BIMAX_PYTHON || 'python3') {}

  private get dir(): string { return path.join(this.projectRoot, LAUNCH_DIR); }
  private recPath(run: string): string { return path.join(this.dir, `${run}.json`); }

  private resolveDir(dir: string): string {
    return path.isAbsolute(dir) ? dir : path.join(this.projectRoot, dir);
  }

  private validRun(run: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(run);
  }

  /** Spawn `python <script> [--smoke]` in the build dir, detached, logging to <script>.log. */
  launch(run: string, dir: string, opts: { smoke?: boolean; script?: string } = {}): LaunchSpec | { error: string } {
    if (!this.validRun(run)) return { error: 'Run names may contain only letters, numbers, dot, underscore, and dash (max 128 characters).' };
    const buildDir = this.resolveDir(dir);
    const scriptName = opts.script || 'train.py';
    const script = path.join(buildDir, scriptName);
    if (!fs.existsSync(script)) return { error: `No ${scriptName} in ${dir}. Build the Blueprint first (BlueprintTool build).` };

    const existing = this.load(run);
    if (existing && this.isAlive(existing.pid)) {
      return { error: `Run "${run}" is already running (pid ${existing.pid}). Stop it first with action "stop".` };
    }

    fs.mkdirSync(this.dir, { recursive: true });
    const base = scriptName.replace(/\.py$/, '');
    const log = path.join(buildDir, `${base}.log`);
    const metrics = path.join(buildDir, 'metrics.jsonl');
    const resultsPath = path.join(buildDir, 'eval_results.json');
    const metricsLinesAtStart = this.countLines(metrics);
    const resultsMtimeAtStart = this.mtime(resultsPath);
    const out = fs.openSync(log, 'a');
    const args = ['-u', scriptName, ...(opts.smoke ? ['--smoke'] : [])];

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
      run, dir: buildDir, script: scriptName,
      cmd: `${this.python} ${args.join(' ')}`,
      pid: child.pid, log, metrics, smoke: !!opts.smoke,
      startedAt: new Date().toISOString(),
      metricsLinesAtStart,
      resultsMtimeAtStart,
    };
    fs.writeFileSync(this.recPath(run), JSON.stringify(spec, null, 2), 'utf8');
    return spec;
  }

  status(run: string): LaunchStatus | { error: string } {
    if (!this.validRun(run)) return { error: 'Invalid run name.' };
    const spec = this.load(run);
    if (!spec) return { error: `No launch "${run}". Start one with action "launch".` };
    return {
      run: spec.run, pid: spec.pid, running: this.isAlive(spec.pid),
      script: spec.script || 'train.py',
      cmd: spec.cmd, smoke: spec.smoke, startedAt: spec.startedAt,
      log: spec.log, metrics: spec.metrics,
      metricsLines: this.countLines(spec.metrics),
      results: this.readJson(path.join(spec.dir, 'eval_results.json')),
      tail: this.tail(spec.log, 12),
    };
  }

  /**
   * Wait for observable output from this exact launch. This is the readiness contract callers can
   * use instead of guessing how long Python, imports, or accelerator setup will take.
   */
  async waitUntilReady(run: string, opts: ReadinessOptions = {}): Promise<LaunchReadiness | { error: string }> {
    if (!this.validRun(run)) return { error: 'Invalid run name.' };
    const spec = this.load(run);
    if (!spec) return { error: `No launch "${run}". Start one with action "launch".` };

    const timeoutMs = Math.max(100, opts.timeoutMs ?? 30_000);
    const pollMs = Math.max(25, opts.pollMs ?? 100);
    const minMetricsLines = Math.max(1, opts.minMetricsLines ?? 1);
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const status = this.status(run);
      if ('error' in status) return status;
      const isEval = /eval/.test(spec.script || '');
      const ready = isEval
        ? !!status.results && this.mtime(path.join(spec.dir, 'eval_results.json')) > (spec.resultsMtimeAtStart ?? 0)
        : status.metricsLines - (spec.metricsLinesAtStart ?? 0) >= minMetricsLines;
      if (ready) {
        return {
          ready: true,
          status,
          reason: isEval ? 'eval_results.json written by this launch' : `${minMetricsLines} new metric line(s) written`,
        };
      }
      if (!status.running) {
        return {
          ready: false,
          status,
          reason: status.tail.length ? `Process exited before readiness: ${status.tail.at(-1)}` : 'Process exited before producing readiness evidence.',
        };
      }
      if (Date.now() >= deadline) {
        return {
          ready: false,
          status,
          reason: `Timed out after ${timeoutMs}ms waiting for readiness.`,
        };
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
    }
  }

  stop(run: string): string | { error: string } {
    if (!this.validRun(run)) return { error: 'Invalid run name.' };
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

  private readJson(p: string): Record<string, any> | undefined {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return undefined; }
  }

  private mtime(p: string): number {
    try { return fs.statSync(p).mtimeMs; } catch { return 0; }
  }

  private tail(p: string, n: number): string[] {
    try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; }
  }

  format(s: LaunchStatus): string {
    const isEval = /eval/.test(s.script);
    const progress = isEval
      ? (s.results ? `  eval_results.json: ${Object.entries(s.results).map(([k, v]) => `${k}=${v}`).join('  ·  ')}` : `  eval_results.json: not written yet`)
      : `  metrics.jsonl: ${s.metricsLines} step(s) written  →  TrainMonitorTool status run="${s.run}"`;
    return [
      `🚀 Launch "${s.run}" (${s.script})  ·  pid ${s.pid}  ·  ${s.running ? 'RUNNING' : 'stopped'}${s.smoke ? '  ·  [smoke]' : ''}`,
      `  cmd: ${s.cmd}   (started ${s.startedAt})`,
      progress,
      ...(s.tail.length ? [`  log tail:`, ...s.tail.map(l => `    ${l}`)] : [`  (no log output yet)`]),
    ].join('\n');
  }
}

let _launcher: TrainLauncher | null = null;
export function getTrainLauncher(): TrainLauncher | null { return _launcher; }
export function setTrainLauncher(l: TrainLauncher): void { _launcher = l; }
