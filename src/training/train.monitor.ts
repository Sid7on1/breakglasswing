import * as fs from 'fs';
import * as path from 'path';

// Real training monitor for the LLM-domain Verify stage. Two sources, both genuinely wired:
//   - jsonl: a metrics file the training loop appends to, one JSON object per step
//            ({ step, loss, grad_norm, tokens_per_sec, lr, ... }). We tail it.
//   - wandb: a run path "entity/project/run_id" — polled via the W&B GraphQL API (WANDB_API_KEY).
// The registry of watched runs persists to .bimax/monitors/<run>.json so monitoring survives restarts.

export interface MetricPoint {
  step?: number;
  loss?: number;
  grad_norm?: number;
  tokens_per_sec?: number;
  lr?: number;
  [k: string]: any;
}

export interface MonitorSpec {
  run: string;
  source: string; // jsonl path, or "wandb:entity/project/run_id"
  createdAt: string;
}

export interface MonitorStatus {
  run: string;
  source: string;
  points: number;
  latest?: MetricPoint;
  lossTrend?: 'down' | 'up' | 'flat' | 'unknown';
  avgTokensPerSec?: number;
  alerts: string[];
}

const MONITOR_DIR = '.bimax/monitors';

export class TrainMonitor {
  constructor(private projectRoot: string) {}

  private get dir(): string { return path.join(this.projectRoot, MONITOR_DIR); }

  watch(run: string, source: string): MonitorSpec {
    fs.mkdirSync(this.dir, { recursive: true });
    const spec: MonitorSpec = { run, source, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(this.dir, `${run}.json`), JSON.stringify(spec, null, 2), 'utf8');
    return spec;
  }

  list(): MonitorSpec[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as MonitorSpec; } catch { return null; } })
      .filter((s): s is MonitorSpec => s !== null);
  }

  stop(run: string): boolean {
    try { fs.unlinkSync(path.join(this.dir, `${run}.json`)); return true; } catch { return false; }
  }

  private load(run: string): MonitorSpec | null {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, `${run}.json`), 'utf8')); } catch { return null; }
  }

  async status(run: string, lastN = 50): Promise<MonitorStatus | { error: string }> {
    const spec = this.load(run);
    if (!spec) return { error: `No monitor "${run}". Start one with action "watch".` };
    let points: MetricPoint[];
    try {
      points = spec.source.startsWith('wandb:')
        ? await this.readWandb(spec.source.slice('wandb:'.length))
        : this.readJsonl(spec.source);
    } catch (e: any) {
      return { error: `Could not read metrics from ${spec.source}: ${e.message}` };
    }
    return this.analyze(spec, points, lastN);
  }

  private readJsonl(source: string): MetricPoint[] {
    const p = path.isAbsolute(source) ? source : path.join(this.projectRoot, source);
    if (!fs.existsSync(p)) throw new Error(`metrics file not found: ${source}`);
    return fs.readFileSync(p, 'utf8').split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l) as MetricPoint; } catch { return null; } })
      .filter((m): m is MetricPoint => m !== null);
  }

  // W&B public GraphQL API — pull a run's history. Best-effort; needs WANDB_API_KEY.
  private async readWandb(runPath: string): Promise<MetricPoint[]> {
    const key = process.env.WANDB_API_KEY;
    if (!key) throw new Error('WANDB_API_KEY not set');
    const [entity, project, runId] = runPath.split('/');
    if (!entity || !project || !runId) throw new Error('wandb source must be entity/project/run_id');
    const host = process.env.WANDB_BASE_URL || 'https://api.wandb.ai';
    const query = `query Run($entity:String!,$project:String!,$run:String!){project(name:$project,entityName:$entity){run(name:$run){history(samples:500)}}}`;
    const res = await fetch(`${host}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`api:${key}`).toString('base64') },
      body: JSON.stringify({ query, variables: { entity, project, run: runId } }),
    });
    if (!res.ok) throw new Error(`W&B API ${res.status}`);
    const json: any = await res.json();
    const rows: string[] = json?.data?.project?.run?.history ?? [];
    return rows.map(r => { try { return JSON.parse(r) as MetricPoint; } catch { return null; } })
      .filter((m): m is MetricPoint => m !== null)
      .map(m => ({ step: m.step ?? m._step, loss: m.loss ?? m['train/loss'], grad_norm: m.grad_norm ?? m['grad_norm'], tokens_per_sec: m.tokens_per_sec ?? m['throughput'], lr: m.lr ?? m['learning_rate'], ...m }));
  }

  private analyze(spec: MonitorSpec, points: MetricPoint[], lastN: number): MonitorStatus {
    const alerts: string[] = [];
    const status: MonitorStatus = { run: spec.run, source: spec.source, points: points.length, alerts };
    if (!points.length) { alerts.push('No metric points yet — is the run writing to its source?'); return status; }

    const window = points.slice(-lastN);
    const latest = points[points.length - 1];
    status.latest = latest;

    const losses = window.map(p => p.loss).filter((x): x is number => typeof x === 'number');
    if (losses.length) {
      const last = losses[losses.length - 1];
      if (!Number.isFinite(last)) alerts.push(`🚨 Loss is ${last} (NaN/Inf) — divergence. Lower LR or check the data pipeline.`);
      const first = losses[0];
      const delta = last - first;
      const rel = first !== 0 ? delta / Math.abs(first) : 0;
      status.lossTrend = rel < -0.01 ? 'down' : rel > 0.01 ? 'up' : 'flat';
      if (status.lossTrend === 'up') alerts.push(`⚠️ Loss rose over the last ${losses.length} points (${first.toFixed(3)} → ${last.toFixed(3)}). Possible instability.`);
      if (status.lossTrend === 'flat' && losses.length >= 20) alerts.push(`⚠️ Loss plateaued (${last.toFixed(3)}) over ${losses.length} points — consider LR/schedule/data changes.`);
    }

    const grads = window.map(p => p.grad_norm).filter((x): x is number => typeof x === 'number');
    if (grads.length) {
      const g = grads[grads.length - 1];
      if (!Number.isFinite(g) || g > 1000) alerts.push(`🚨 Grad-norm ${Number.isFinite(g) ? g.toFixed(1) : g} — exploding gradients. Tighten clipping or lower LR.`);
    }

    const tps = window.map(p => p.tokens_per_sec).filter((x): x is number => typeof x === 'number');
    if (tps.length) {
      status.avgTokensPerSec = tps.reduce((a, b) => a + b, 0) / tps.length;
      const recent = tps.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, tps.length);
      if (status.avgTokensPerSec > 0 && recent < status.avgTokensPerSec * 0.6)
        alerts.push(`⚠️ Throughput dropped to ${recent.toFixed(0)} tok/s (avg ${status.avgTokensPerSec.toFixed(0)}) — check for stragglers / I/O stalls.`);
    }

    if (!alerts.length) alerts.push('✅ Healthy — no anomalies in the recent window.');
    return status;
  }

  format(s: MonitorStatus): string {
    const l = s.latest || {};
    const lines = [
      `📊 Monitor "${s.run}"  (${s.source})  ·  ${s.points} point(s)`,
      `  step ${l.step ?? '—'}  ·  loss ${typeof l.loss === 'number' ? l.loss.toFixed(4) : '—'}` +
      `  ·  grad ${typeof l.grad_norm === 'number' ? l.grad_norm.toFixed(2) : '—'}` +
      `  ·  ${typeof l.tokens_per_sec === 'number' ? l.tokens_per_sec.toFixed(0) + ' tok/s' : '— tok/s'}` +
      `  ·  lr ${typeof l.lr === 'number' ? l.lr.toExponential(2) : '—'}`,
      `  loss trend: ${s.lossTrend ?? 'unknown'}${s.avgTokensPerSec ? `  ·  avg ${s.avgTokensPerSec.toFixed(0)} tok/s` : ''}`,
      ...s.alerts.map(a => `  ${a}`),
    ];
    return lines.join('\n');
  }
}

let _monitor: TrainMonitor | null = null;
export function getTrainMonitor(): TrainMonitor | null { return _monitor; }
export function setTrainMonitor(m: TrainMonitor): void { _monitor = m; }
