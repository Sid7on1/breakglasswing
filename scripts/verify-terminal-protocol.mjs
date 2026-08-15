#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const binary = path.resolve(process.argv[2] || 'build/bimax');
const budgets = {
  coldStartMs: Number(process.env.BIMAX_BUDGET_COLD_START_MS || 5000),
  warmStartMs: Number(process.env.BIMAX_BUDGET_WARM_START_MS || 2500),
  pingP95Ms: Number(process.env.BIMAX_BUDGET_INTERACTION_P95_MS || 100),
};
const foreignArchitecture = process.env.BIMAX_FOREIGN_ARCH === '1';
const knownOutbound = new Set(['hello', 'boot', 'event', 'request', 'ready', 'queryResult', 'pong', 'configResult', 'health']);

function fail(message) {
  throw new Error(`terminal protocol gate: FAIL: ${message}`);
}

function percentile95(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
}

async function probe(project, cache, label, pingCount) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(binary, ['--headless'], {
      cwd: project,
      env: {
        ...process.env,
        BIMAX_CACHE_DIR: cache,
        BIMAX_DISABLE_CODEMEM: '1',
        // These hostile inherited values must not reactivate Desktop in Terminal headless mode.
        BIMAX_HOST_PROFILE: 'desktop',
        BIMAX_CU_SERVICE_BINARY: '/tmp/forbidden-service',
        BIMAX_DESKTOP_HELPER: '/tmp/forbidden-helper',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let readyMs = 0;
    let firstOutputMs = 0;
    const bootPhases = [];
    let sent = 0;
    let received = 0;
    let commandBoundary = false;
    let snapshotsChecked = 0;
    const pending = new Map();
    const latencies = [];
    let settled = false;

    const sendPing = () => {
      const id = sent + 1;
      pending.set(id, performance.now());
      child.stdin.write(`${JSON.stringify({ t: 'ping', id })}\n`);
      sent += 1;
    };

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill('SIGTERM');
      if (error) reject(error);
      else resolve({ label, readyMs, firstOutputMs, bootPhases, pingP95Ms: percentile95(latencies), snapshotsChecked });
    };

    const handle = (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return finish(new Error(`${label} emitted non-JSON stdout: ${line.slice(0, 200)}`)); }
      const elapsed = performance.now() - started;
      if (firstOutputMs === 0) firstOutputMs = elapsed;
      if (!message || typeof message !== 'object' || !knownOutbound.has(message.t)) {
        return finish(new Error(`${label} emitted an unknown protocol object: ${line.slice(0, 200)}`));
      }
      if (message.t === 'boot') bootPhases.push(`${message.phase}@${elapsed.toFixed(1)}ms`);
      if (message.t === 'ready') {
        if (message.protocol !== 3) return finish(new Error(`${label} protocol=${message.protocol}, expected 3`));
        readyMs = performance.now() - started;
        sendPing();
        child.stdin.write(`${JSON.stringify({ t: 'query', id: 9001, text: '/comp' })}\n`);
      } else if (message.t === 'event' && message.name === 'ui_snapshot') {
        const snapshot = message.args?.[0];
        if (snapshot && typeof snapshot === 'object' && Object.hasOwn(snapshot, 'computer')) {
          return finish(new Error(`${label} leaked Desktop computer posture in a Terminal snapshot`));
        }
        snapshotsChecked += 1;
      } else if (message.t === 'queryResult' && message.id === 9001) {
        const values = Array.isArray(message.items) ? message.items.map((item) => item?.value) : [];
        if (values.some((value) => typeof value === 'string' && value.startsWith('/computer'))) {
          return finish(new Error(`${label} exposed /computer in Terminal command completion`));
        }
        commandBoundary = true;
        if (received === pingCount) finish();
      } else if (message.t === 'pong') {
        if (typeof message.id !== 'number' || !pending.has(message.id)) {
          return finish(new Error(`${label} returned an uncorrelated pong`));
        }
        latencies.push(performance.now() - pending.get(message.id));
        pending.delete(message.id);
        received += 1;
        if (received < pingCount) sendPing();
        else if (commandBoundary) finish();
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      let index;
      while ((index = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        if (line) handle(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (!settled) finish(new Error(`${label} exited before the protocol probe completed: code=${code} signal=${signal}; ${stderr.slice(-500)}`));
    });
    const timeout = setTimeout(() => finish(new Error(`${label} timed out; ${stderr.slice(-500)}`)), 20_000);
  });
}

const root = mkdtempSync(path.join(tmpdir(), 'bimax-terminal-protocol-'));
try {
  const project = path.join(root, 'project');
  const cache = path.join(root, 'cache');
  mkdirSync(project);
  mkdirSync(cache);
  const cold = await probe(project, cache, 'cold start', 1);
  const warm = await probe(project, cache, 'warm start', 20);
  if (!foreignArchitecture && cold.readyMs > budgets.coldStartMs) fail(`cold start ${cold.readyMs.toFixed(1)}ms > ${budgets.coldStartMs}ms; first output ${cold.firstOutputMs.toFixed(1)}ms; ${cold.bootPhases.join(', ')}`);
  if (warm.readyMs > budgets.warmStartMs) fail(`warm start ${warm.readyMs.toFixed(1)}ms > ${budgets.warmStartMs}ms`);
  if (warm.pingP95Ms > budgets.pingP95Ms) fail(`ping p95 ${warm.pingP95Ms.toFixed(1)}ms > ${budgets.pingP95Ms}ms`);
  if (cold.snapshotsChecked + warm.snapshotsChecked < 1) fail('no Terminal ui_snapshot was observed; posture check would be vacuous');
  console.log(foreignArchitecture
    ? `terminal protocol gate: OBSERVED foreign-architecture cold ready ${cold.readyMs.toFixed(1)}ms (native cold SLO not scored)`
    : `terminal protocol gate: PASS cold ready ${cold.readyMs.toFixed(1)}ms / ${budgets.coldStartMs}ms`);
  console.log(`terminal protocol gate: PASS warm ready ${warm.readyMs.toFixed(1)}ms / ${budgets.warmStartMs}ms`);
  console.log(`terminal protocol gate: PASS 20 correlated NDJSON pings p95 ${warm.pingP95Ms.toFixed(1)}ms / ${budgets.pingP95Ms}ms`);
  console.log('terminal protocol gate: PASS /computer absent from command completion and Desktop posture absent from snapshots');
  console.log('terminal protocol gate: PASS hostile Desktop environment was forced back to Terminal profile');
} finally {
  // The final ui_snapshot can persist task state just after the probe sends SIGTERM. Give the
  // child a bounded shutdown window so cleanup cannot race that last atomic write on macOS.
  await new Promise((resolve) => setTimeout(resolve, 250));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
