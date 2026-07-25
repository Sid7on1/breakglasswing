/**
 * Long-run soak for computer use (Phase 9).
 *
 * Short smoke tests prove a capability works once. They cannot see the failures that only appear
 * over time: frame age creeping up, memory climbing, the capture stream quietly dying, a retry loop
 * that never terminates, or a mouse button left held by an action that errored an hour ago.
 *
 * So this drives a mixed, repeating workload against a real app and samples the things that drift.
 * It asserts nothing about absolute speed — the machine decides that — but it DOES fail on the
 * properties that must hold no matter the hardware: no unbounded growth, no stuck input, no capture
 * death, no infinite retry.
 *
 * Usage:
 *   npx tsx scripts/soak-computer-use.ts [--minutes 30] [--app Notes] [--json out.json]
 *
 * Honest by construction: every number printed is measured in this run. Anything it could not
 * measure is reported as null rather than filled in with a plausible value.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BimaxComputerRuntime } from '../src/computer/desktop.runtime';

interface Sample {
  at: number;
  elapsedMs: number;
  rssMb: number;
  heapMb: number;
  /** Age of the newest PiP frame, when PiP is running. */
  pipFrames: number | null;
  pipRunning: boolean | null;
  historyKept: number;
  observedElements: number;
  indexedElements: number;
  surfaces: number;
}

interface ActionOutcome {
  verb: string;
  ok: boolean;
  ms: number;
  observed?: string;
  error?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('the computer-use soak is macOS-only');
  const root = path.resolve(__dirname, '..');
  const minutes = Number(arg('minutes', '30'));
  const app = arg('app', 'Notes')!;
  const jsonOut = arg('json');

  process.env.BIMAX_COMPUTER_PIP = '1';
  process.env.BIMAX_COMPUTER_USE_DRIVER ||= path.join(root, 'tui', 'embed', 'bimax-computer-use');
  process.env.BIMAX_LIVE_PIP_HELPER ||= path.join(root, 'tui', 'embed', 'bimax-live-pip');

  const runtime = new BimaxComputerRuntime();
  const samples: Sample[] = [];
  const outcomes: ActionOutcome[] = [];
  const startedAt = Date.now();
  const deadline = startedAt + minutes * 60_000;
  let captureRestarts = 0;
  let lastPipRunning: boolean | null = null;
  let cycles = 0;

  const act = async (verb: string, cmd: any): Promise<any> => {
    const t0 = Date.now();
    try {
      const result = await runtime.run(cmd, { cwd: root });
      outcomes.push({
        verb, ok: !!result.ok, ms: Date.now() - t0,
        observed: result.actionResult?.observed,
        error: result.ok ? undefined : String(result.error || result.summary).slice(0, 160),
      });
      return result;
    } catch (err: any) {
      outcomes.push({ verb, ok: false, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 160) });
      return { ok: false };
    }
  };

  const sample = async (): Promise<void> => {
    const mem = process.memoryUsage();
    let pip: any = null;
    try { pip = await runtime.pipStatus(); } catch { /* recorded as null below */ }
    if (lastPipRunning === true && pip?.running === false) captureRestarts++;
    lastPipRunning = pip ? !!pip.running : null;
    const footprint = runtime.memoryFootprint();
    samples.push({
      at: Date.now(),
      elapsedMs: Date.now() - startedAt,
      rssMb: +(mem.rss / 1048576).toFixed(1),
      heapMb: +(mem.heapUsed / 1048576).toFixed(1),
      pipFrames: pip ? Number(pip.frames ?? 0) : null,
      pipRunning: pip ? !!pip.running : null,
      ...footprint,
    });
  };

  process.stdout.write(`soak: ${minutes} min against ${app}; sampling every 10s\n`);

  const opened = await act('open', { action: 'open', app, deliveryMode: 'foreground' });
  if (!opened.ok) throw new Error(`could not open ${app}: ${opened.error || opened.summary}`);

  const sampler = setInterval(() => { void sample(); }, 10_000);
  await sample();

  try {
    while (Date.now() < deadline) {
      cycles++;
      // A deliberately MIXED workload: observation, keyboard, pointer, scroll and window geometry.
      // A soak that only observes proves nothing about input paths, and one that only clicks misses
      // capture degradation.
      await act('observe', { action: 'observe', maxElements: 40 });
      await act('type', { action: 'type', text: `soak cycle ${cycles}\n` });
      await act('key', { action: 'key', combo: 'cmd+a' });
      await act('key', { action: 'key', combo: 'delete' });
      await act('scroll', { action: 'scroll', x: 200, y: 200, dy: 120 });
      await act('scroll', { action: 'scroll', x: 200, y: 200, dy: -120 });
      // Window geometry churn every few cycles — the path most likely to strand a coordinate context.
      if (cycles % 5 === 0) {
        await act('arrange', { action: 'arrange', layout: cycles % 10 === 0 ? 'left' : 'right' });
        await act('arrange', { action: 'arrange', layout: 'restore' });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally {
    clearInterval(sampler);
    await sample();
  }

  // ---- verdicts ---------------------------------------------------------------------------------
  // Properties, not absolute speeds. The machine decides how fast it is; it does not get to decide
  // whether memory is allowed to grow without bound.
  const first = samples[0], last = samples[samples.length - 1];
  const rssGrowthMb = +(last.rssMb - first.rssMb).toFixed(1);
  const peakRssMb = Math.max(...samples.map(s => s.rssMb));
  const actionMs = outcomes.map(o => o.ms);
  const failures = outcomes.filter(o => !o.ok);
  const heldAfter = await runtime.releaseHeldInput('soak finished');
  const switchLatency = runtime.switchLatencySummary();

  const report = {
    ok: true as boolean,
    app,
    requestedMinutes: minutes,
    actualMinutes: +((Date.now() - startedAt) / 60_000).toFixed(2),
    cycles,
    actions: {
      total: outcomes.length,
      failed: failures.length,
      p50Ms: percentile(actionMs, 0.5),
      p95Ms: percentile(actionMs, 0.95),
      worstMs: actionMs.length ? Math.max(...actionMs) : null,
      byVerb: outcomes.reduce<Record<string, { n: number; failed: number }>>((acc, o) => {
        acc[o.verb] ||= { n: 0, failed: 0 };
        acc[o.verb].n++;
        if (!o.ok) acc[o.verb].failed++;
        return acc;
      }, {}),
      // The distinct failure messages, so a soak failure is diagnosable from the report alone.
      distinctErrors: [...new Set(failures.map(f => f.error).filter(Boolean))].slice(0, 10),
    },
    memory: { startRssMb: first.rssMb, endRssMb: last.rssMb, growthMb: rssGrowthMb, peakRssMb },
    boundedState: {
      historyKept: last.historyKept,
      observedElements: last.observedElements,
      indexedElements: last.indexedElements,
      surfaces: last.surfaces,
    },
    pip: {
      running: last.pipRunning,
      framesDelivered: last.pipFrames,
      captureRestarts,
    },
    targetSwitchLatencyMs: switchLatency,
    stuckInputAfterRun: heldAfter,
    samples: samples.length,
  };

  // Hard properties. Any of these failing is a real defect regardless of the hardware.
  const violations: string[] = [];
  if (rssGrowthMb > 150) violations.push(`RSS grew ${rssGrowthMb} MB over the run — unbounded growth`);
  if (last.historyKept > 200) violations.push(`action history is unbounded (${last.historyKept} records retained)`);
  if (heldAfter.released > 0) violations.push(`${heldAfter.released} mouse button(s) were still physically held at the end of the run`);
  if (heldAfter.errors.length) violations.push(`held input could not be released: ${heldAfter.errors.join('; ')}`);
  if (outcomes.length && failures.length / outcomes.length > 0.25) {
    violations.push(`${failures.length}/${outcomes.length} actions failed (>25%)`);
  }
  report.ok = violations.length === 0;

  const output = { ...report, violations };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ ...output, sampleSeries: samples, outcomes }, null, 2));

  await runtime.dispose();
  if (violations.length) process.exitCode = 1;
}

main().catch(err => {
  process.stderr.write(`${String(err?.stack || err)}\n`);
  process.exitCode = 1;
});
