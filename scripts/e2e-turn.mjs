#!/usr/bin/env node
// End-to-end headless-turn probe: spawns the REAL engine (dist/index.js, BIMAX_HEADLESS=1),
// sends a prompt over the NDJSON protocol, and reports the same timeline a TUI user feels:
//   spawn → ready → input-sent → first engine event → first visible token → turn end,
// plus the inter-token gap distribution (streaming proof) and the full event census.
//
//   node scripts/e2e-turn.mjs [prompt] [--runs=N] [--json]
//
// Point it at any provider with BGW_BASE_URL / BGW_MODEL (e.g. the mock: scripts/mock-provider.mjs).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const PROMPT = args[0] || 'hi';
const RUNS = parseInt((process.argv.find((a) => a.startsWith('--runs=')) || '=1').split('=')[1], 10);
const JSON_OUT = process.argv.includes('--json');

function pct(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0; }

async function oneRun(runIdx) {
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const p = spawn('node', ['dist/index.js'], { cwd: ROOT, env: { ...process.env, BIMAX_HEADLESS: '1' } });
  const timeline = { spawn: 0, ready: -1, inputSent: -1, firstEvent: -1, firstToken: -1, turnEnd: -1 };
  const tokenTimes = [];
  const eventCensus = new Map();
  let visible = '';
  let done, fail;
  const finished = new Promise((res, rej) => { done = res; fail = rej; });
  const timeout = setTimeout(() => fail(new Error(`timeout at ${now()}ms; census=${JSON.stringify([...eventCensus])}`)), 120_000);

  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      const key = m.t + (m.name ? ':' + m.name : '');
      eventCensus.set(key, (eventCensus.get(key) || 0) + 1);
      if (m.t === 'ready' && timeline.ready < 0) {
        timeline.ready = now();
        p.stdin.write(JSON.stringify({ t: 'input', text: PROMPT }) + '\n');
        timeline.inputSent = now();
      }
      if (timeline.inputSent >= 0 && timeline.firstEvent < 0 && m.t === 'event') timeline.firstEvent = now();
      if (m.t === 'event' && (m.name === 'stream_token' || m.name === 'message_delta')) {
        const text = typeof m.args?.[0] === 'string' ? m.args[0] : (m.args?.[0]?.text ?? m.args?.[0]?.delta ?? '');
        if (text) {
          if (timeline.firstToken < 0) timeline.firstToken = now();
          tokenTimes.push(now());
          visible += text;
        }
      }
      // Turn end = spinner_state returning to "idle" AFTER the input went out (the TUI's own signal).
      if (m.t === 'event' && m.name === 'spinner_state' && timeline.inputSent >= 0) {
        const state = typeof m.args?.[0] === 'string' ? m.args[0] : '';
        if (state === 'idle' && timeline.firstEvent >= 0) {
          timeline.turnEnd = now();
          clearTimeout(timeout);
          p.kill();
          done();
        }
      }
    }
  });
  p.stderr.on('data', () => {});
  p.on('exit', () => { clearTimeout(timeout); done(); });

  try { await finished; } catch (e) { p.kill(); throw e; }

  const gaps = tokenTimes.slice(1).map((t, i) => t - tokenTimes[i]);
  return { runIdx, timeline, tokens: tokenTimes.length, chars: visible.length, gaps, census: [...eventCensus.entries()] };
}

const results = [];
for (let i = 0; i < RUNS; i++) {
  try { results.push(await oneRun(i)); }
  catch (e) { console.error(`run ${i + 1} failed:`, e.message); }
}
if (results.length === 0) process.exit(1);

if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

console.log(`\nE2E headless turn — prompt=${JSON.stringify(PROMPT)}, runs=${results.length}`);
console.log('run | ready | in→1stEvt | in→1stTok | in→end | tokens | maxGap | p95gap');
for (const r of results) {
  const t = r.timeline;
  const sg = [...r.gaps].sort((a, b) => a - b);
  console.log(
    `${String(r.runIdx + 1).padStart(3)} | ${String(t.ready).padStart(5)} | ${String(t.firstEvent - t.inputSent).padStart(9)} | ${String(t.firstToken < 0 ? -1 : t.firstToken - t.inputSent).padStart(9)} | ${String(t.turnEnd - t.inputSent).padStart(6)} | ${String(r.tokens).padStart(6)} | ${String(sg.length ? sg[sg.length - 1] : 0).padStart(6)} | ${String(pct(sg, 0.95)).padStart(6)}`,
  );
}
const last = results[results.length - 1];
console.log('\nevent census (last run):', last.census.map(([k, v]) => `${k}×${v}`).join('  '));
