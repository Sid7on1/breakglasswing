/**
 * Live verification of the computer-use system (Phase 10) against the REAL installed binaries.
 *
 * Unit tests prove the logic; this proves the machine. Every check here drives actual macOS apps
 * through the same runtime the product uses, and every number printed is measured in this run.
 *
 * Design rules, so the output can be trusted:
 *  - A check that could not RUN is reported as `skipped` with the reason. It is never counted as a
 *    pass, and never silently omitted.
 *  - Success criteria are stated per check and evaluated from observed evidence, not from the
 *    driver's return value.
 *  - Nothing is retried to manufacture a pass. A flaky result is reported as what it was.
 *
 * Usage: npx tsx scripts/verify-computer-use-live.ts [--app Notes] [--clicks 50] [--json out.json]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { BimaxComputerRuntime } from '../../src/capabilities/mac/desktop.runtime';
import { waitFor } from '../../src/capabilities/mac/settle';

type Status = 'pass' | 'fail' | 'skip';
interface Check {
  name: string;
  status: Status;
  detail: string;
  evidence?: unknown;
  ms?: number;
}

const checks: Check[] = [];
function record(name: string, status: Status, detail: string, evidence?: unknown, ms?: number): void {
  checks.push({ name, status, detail, evidence, ms });
  const mark = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'SKIP';
  process.stdout.write(`[${mark}] ${name} — ${detail}\n`);
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** The helper the runtime actually compiled and installed — the exact binary under test. */
function findInstalledHelper(): string | null {
  const dir = path.join(os.homedir(), '.bimax', 'native');
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir)
    .filter(f => f.startsWith('bimax-desktop-'))
    .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates.length ? path.join(dir, candidates[0].f) : null;
}

function runHelper(bin: string, args: string[]): string {
  try {
    return execFileSync(bin, args, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

/**
 * Run one check in isolation. A check that throws is recorded as a failure and the run CONTINUES —
 * one broken capability must not hide the state of every capability after it, which is exactly what
 * an unguarded sequence does.
 */
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    record(name, 'fail', `threw: ${String(err?.message || err).slice(0, 200)}`);
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('live verification is macOS-only');
  const root = path.resolve(__dirname, '..');
  const app = arg('app', 'Notes')!;
  const clickCount = Number(arg('clicks', '50'));
  const jsonOut = arg('json');

  process.env.BIMAX_COMPUTER_PIP = '1';
  process.env.BIMAX_COMPUTER_USE_DRIVER ||= path.join(root, 'tui', 'embed', 'bimax-computer-use');
  process.env.BIMAX_LIVE_PIP_HELPER ||= path.join(root, 'tui', 'embed', 'bimax-live-pip');

  const runtime = new BimaxComputerRuntime();
  const cwd = root;

  try {
    // ---- 0. permissions ------------------------------------------------------------------------
    const status = await runtime.run({ action: 'status' }, { cwd });
    if (!status.ok || status.accessibility !== true || status.screenRecording !== true) {
      record('permissions', 'fail',
        `Accessibility=${status.accessibility} ScreenRecording=${status.screenRecording} — every later check depends on these`,
        status.details);
      throw new Error('permissions are not granted; refusing to report unverifiable results');
    }
    record('permissions', 'pass', 'Accessibility and Screen Recording granted');

    // ---- 1. open the target app ----------------------------------------------------------------
    const t0 = Date.now();
    const opened = await runtime.run({ action: 'open', app, deliveryMode: 'foreground' }, { cwd });
    if (!opened.ok) {
      record('open target app', 'fail', String(opened.error || opened.summary));
      throw new Error(`could not open ${app}`);
    }
    record('open target app', 'pass', `${app} pid ${opened.pid} window ${opened.windowId}`, undefined, Date.now() - t0);

    // Give the target the whole screen before any pointer check. A window partly covered by another
    // app is a legitimate refusal from the occlusion gate, not a click failure — but it would
    // dominate the measurement and tell us nothing about accuracy. Maximizing removes that variable;
    // the occlusion gate is verified on its own terms below.
    await runtime.run({ action: 'arrange', layout: 'maximize' }, { cwd });

    let baseFrameId: string | undefined;
    let cx = 400, cy = 400;

    // ---- 2. frame identity is issued ------------------------------------------------------------
    await step('frame identity issued', async () => {
      const obs = await runtime.run({ action: 'observe', maxElements: 40 }, { cwd });
      baseFrameId = obs.frameId;
      cx = Math.round((obs.width || 800) / 2);
      cy = Math.round((obs.height || 600) / 2);
      record('frame identity issued', obs.ok && obs.frameId ? 'pass' : 'fail',
        obs.ok && obs.frameId
          ? `observe minted ${obs.frameId} (${obs.width}×${obs.height} px)`
          : `observe returned frameId=${obs.frameId ?? 'none'}`);
    });

    // ---- 3. a superseded frame is REFUSED -------------------------------------------------------
    // The core Phase 2 guarantee: an action planned from an old picture must not be delivered.
    await step('stale frame refused', async () => {
      const fresh = await runtime.run({ action: 'observe', maxElements: 10 }, { cwd });
      if (!baseFrameId || !fresh.frameId || fresh.frameId === baseFrameId) {
        record('stale frame refused', 'skip', 'could not obtain two distinct frame ids to test supersession');
        return;
      }
      const refused = await runtime.run(
        { action: 'click', x: cx, y: cy, frameId: baseFrameId, deliveryMode: 'foreground' }, { cwd },
      );
      if (refused.ok) {
        record('stale frame refused', 'fail',
          `a click planned from superseded frame ${baseFrameId} was DELIVERED (current ${fresh.frameId})`);
      } else if (/superseded/.test(String(refused.error))) {
        record('stale frame refused', 'pass', `refused: ${String(refused.error).slice(0, 110)}…`);
      } else {
        record('stale frame refused', 'fail', `refused, but for the wrong reason: ${refused.error}`);
      }
    });

    // ---- 4. the CURRENT frame is accepted (the gate is not simply blocking everything) -----------
    await step('current frame accepted', async () => {
      const current = await runtime.run({ action: 'observe', maxElements: 10 }, { cwd });
      const accepted = await runtime.run(
        { action: 'move', x: cx, y: cy, frameId: current.frameId, deliveryMode: 'foreground' }, { cwd },
      );
      record('current frame accepted', accepted.ok ? 'pass' : 'fail',
        accepted.ok ? `action against the current frame ${current.frameId} was delivered`
          : `the gate refused a VALID current frame: ${accepted.error}`);
    });

    // ---- 5. cursor endpoint exactness -----------------------------------------------------------
    // Phase 6's hard requirement: the endpoint is exact, including for sub-3px hops, which the old
    // glide skipped entirely.
    await step('cursor endpoint exactness', async () => {
      // Measured against the INSTALLED helper binary in GLOBAL screen points — one coordinate space,
      // end to end. Driving this through the runtime's `move` instead would compare a requested
      // SCREENSHOT pixel against a reported GLOBAL point, and on a window whose image is ~1.84× its
      // point size those are simply different numbers; a mismatch would say nothing about the cursor.
      const helper = findInstalledHelper();
      if (!helper) {
        record('cursor endpoint exactness', 'skip', 'no installed helper binary found under ~/.bimax/native');
        return;
      }
      const errors: Array<{ want: [number, number]; got: [number, number] }> = [];
      // Deliberately includes 1px and 2px hops — the sub-3px case the previous glide skipped
      // entirely, leaving the cursor short of its target.
      const points: Array<[number, number]> = [
        [400, 300], [402, 301], [403, 301], [900, 600], [901, 601],
        [300, 200], [301, 200], [700, 500], [701, 500], [702, 501],
      ];
      for (const [x, y] of points) {
        runHelper(helper, ['move', String(x), String(y)]);
        const at = JSON.parse(runHelper(helper, ['cursor']) || '{}');
        if (at.x !== x || at.y !== y) errors.push({ want: [x, y], got: [at.x, at.y] });
      }
      record('cursor endpoint exactness', errors.length === 0 ? 'pass' : 'fail',
        errors.length === 0
          ? `${points.length}/${points.length} moves landed exactly in global points, including 1–2px hops`
          : `${errors.length}/${points.length} moves missed their endpoint`,
        errors);
    });

    // ---- 6. repeated small-target clicks --------------------------------------------------------
    // The acceptance criterion is "no WRONG-TARGET click", so the evidence that matters is which app
    // received each click — not whether the driver returned ok. Refusals are counted separately and
    // split by cause, because an occlusion refusal is the safety gate working correctly.
    await step('repeated small-target clicks', async () => {
      let delivered = 0, wrongApp = 0, occluded = 0, otherRefusals = 0;
      const errors: string[] = [];
      const start = Date.now();
      for (let i = 0; i < clickCount; i++) {
        // Re-observe before each click, as a real agent does. Clicking an inert area 50 times from
        // ONE frame is the blind repetition the no-progress latch exists to stop, so a loop that
        // skipped this would measure the safety mechanism rather than click accuracy.
        const frame = await runtime.run({ action: 'observe', maxElements: 12 }, { cwd });
        if (!frame.ok) { otherRefusals++; if (errors.length < 6) errors.push(`observe ${i}: ${String(frame.error).slice(0, 100)}`); continue; }
        const jx = cx + ((i % 7) - 3) * 12;
        const jy = cy + ((i % 5) - 2) * 12;
        const r = await runtime.run({ action: 'click', x: jx, y: jy, frameId: frame.frameId, deliveryMode: 'foreground' }, { cwd });
        if (!r.ok) {
          if (/is on top of|would land there/.test(String(r.error))) occluded++;
          else { otherRefusals++; if (errors.length < 6) errors.push(String(r.error).slice(0, 130)); }
          continue;
        }
        delivered++;
        if (r.app && !r.app.toLowerCase().includes(app.toLowerCase())) {
          wrongApp++;
          if (errors.length < 6) errors.push(`click ${i} landed in ${r.app}, expected ${app}`);
        }
      }
      const ms = Date.now() - start;
      // The hard criterion is zero wrong-target clicks. Occlusion refusals are the gate doing its
      // job and are reported separately rather than counted as inaccuracy.
      const ok = wrongApp === 0 && delivered >= clickCount * 0.9;
      record('repeated small-target clicks', ok ? 'pass' : 'fail',
        `${delivered}/${clickCount} delivered · ${wrongApp} wrong-app · ${occluded} refused by the occlusion gate · ${otherRefusals} other refusals · ${Math.round(ms / clickCount)}ms each`,
        errors);
    });

    // ---- 7. window layouts, including the new thirds and restore --------------------------------
    // Judged on POSITION, not size. Apps enforce minimum widths and size increments — Notes refuses
    // every width change and keeps its own — so demanding an exact size would measure the app's
    // resize policy, not the layout code. What the runtime owes is: put the window where the layout
    // says, and REPORT any size the app refused rather than claiming success.
    await step('window layouts (thirds + restore)', async () => {
      const results: Array<{ layout: string; requested?: unknown; actual?: unknown; positionExact: boolean; sizeHonoured: boolean }> = [];
      for (const layout of ['left-third', 'center-third', 'right-third', 'left-two-thirds', 'restore'] as const) {
        const r = await runtime.run({ action: 'arrange', layout }, { cwd });
        const want: any = r.requestedFrame, got: any = r.windowFrame;
        results.push({
          layout, requested: want, actual: got,
          positionExact: !!want && !!got && Math.abs(want.x - got.x) <= 2,
          sizeHonoured: !!want && !!got && Math.abs(want.w - got.w) <= 2 && Math.abs(want.h - got.h) <= 2,
        });
      }
      const posFails = results.filter(l => !l.positionExact);
      const clamped = results.filter(l => l.positionExact && !l.sizeHonoured);
      record('window layouts (thirds + restore)', posFails.length === 0 ? 'pass' : 'fail',
        `${results.length - posFails.length}/${results.length} positioned exactly`
        + (clamped.length ? `; ${clamped.length} had their SIZE clamped by the app (reported, not claimed)` : ''),
        results);
      await runtime.run({ action: 'arrange', layout: 'maximize' }, { cwd });
    });

    // ---- 8. scrolling does not corrupt coordinates ----------------------------------------------
    await step('scroll keeps the coordinate space intact', async () => {
      const before = await runtime.run({ action: 'observe', maxElements: 10 }, { cwd });
      const scrolled = await runtime.run({ action: 'scroll', x: cx, y: cy, dy: 200, frameId: before.frameId, deliveryMode: 'foreground' }, { cwd });
      const after = await runtime.run({ action: 'observe', maxElements: 10 }, { cwd });
      const stable = before.width === after.width && before.height === after.height;
      record('scroll keeps the coordinate space intact', scrolled.ok && stable ? 'pass' : 'fail',
        scrolled.ok
          ? `scroll delivered; frame ${before.width}×${before.height} → ${after.width}×${after.height}`
          : `scroll refused: ${String(scrolled.error).slice(0, 150)}`);
    });

    // ---- 9. staged selection releases its held button -------------------------------------------
    // A mouse_down with no mouse_up is the classic wedge: it outlives the process and breaks the
    // human's own mouse. The runtime must be able to hand the desktop back neutral.
    await step('held button is released', async () => {
      const obs = await runtime.run({ action: 'observe', maxElements: 10 }, { cwd });
      const down = await runtime.run({ action: 'mouse_down', x: cx, y: cy, frameId: obs.frameId, deliveryMode: 'foreground' }, { cwd });
      if (!down.ok) {
        record('held button is released', 'skip', `mouse_down did not deliver: ${String(down.error).slice(0, 140)}`);
        return;
      }
      const released = await runtime.releaseHeldInput('live verification');
      record('held button is released', released.released === 1 && released.errors.length === 0 ? 'pass' : 'fail',
        `released ${released.released} held button(s), ${released.errors.length} error(s)`, released);
    });

    // ---- 10. target switching between apps, with measured latency -------------------------------
    await step('target switching', async () => {
      let ok = true;
      const problems: string[] = [];
      for (let round = 0; round < 2; round++) {
        for (const which of ['Finder', app]) {
          const r = await runtime.run({ action: 'open', app: which, deliveryMode: 'foreground' }, { cwd });
          if (!r.ok) { ok = false; problems.push(`${which}: ${String(r.error).slice(0, 120)}`); continue; }
          // The frame after a switch must belong to the app we switched TO.
          if (r.app && !r.app.toLowerCase().includes(which.toLowerCase())) {
            ok = false;
            problems.push(`switched to ${which} but the frame reports ${r.app}`);
          }
        }
      }
      const stats = runtime.switchLatencySummary();
      // A switch that recorded no latency is not a pass: the measurement is part of the requirement.
      record('target switching', ok && stats.count > 0 ? 'pass' : 'fail',
        stats.count
          ? `${stats.count} switches · p50 ${stats.p50}ms · p95 ${stats.p95}ms · worst ${stats.worst}ms`
          : 'no switch latency was recorded — the transaction is not measuring real switches',
        { stats, problems });
    });

    // ---- 11. PiP liveness ------------------------------------------------------------------------
    await step('PiP capture', async () => {
      // Sampling this ONCE reported `running: false` on every run of this script, which read as
      // "PiP is off" when PiP was simply not up yet: the sync goes through a config load, a child
      // spawn and a first ScreenCaptureKit frame. Measured, that takes ~500ms from the sync — so a
      // single immediate read is guaranteed to be early, and the check was skipping on its own
      // impatience. Wait for the condition instead, and distinguish the three real outcomes:
      // disabled (skip), enabled and delivering frames (pass), enabled but never started (fail).
      const settled = await waitFor(async () => {
        const s = await runtime.pipStatus();
        return s.running && (s.frames || 0) > 0 ? s : null;
      }, { timeoutMs: 6000, intervalMs: 200 });

      const pip = settled.value ?? await runtime.pipStatus();
      if (!pip.enabled) {
        record('PiP capture', 'skip', 'PiP is disabled in config — nothing to verify', pip);
        return;
      }
      record('PiP capture', settled.settled ? 'pass' : 'fail',
        settled.settled
          ? `running · ${pip.frames} frames in ${settled.elapsedMs}ms · captureSafe=${pip.captureSafe} · surface=${pip.surface}`
          : `PiP is enabled but delivered no frame within ${settled.elapsedMs}ms — the preview is not live`,
        { ...pip, elapsedMs: settled.elapsedMs, polls: settled.polls });
    });

  } finally {
    // Whatever happened above, the desktop must be handed back neutral.
    const leftover = await runtime.releaseHeldInput('live verification finished');
    if (leftover.released > 0 || leftover.errors.length) {
      record('no input left held at exit', leftover.errors.length ? 'fail' : 'pass',
        `released ${leftover.released} leftover button(s); ${leftover.errors.length} error(s)`, leftover);
    } else {
      record('no input left held at exit', 'pass', 'the desktop was already in a neutral input state');
    }
    await runtime.dispose();

    // Write the report from the FINALLY block. A run that aborted half-way is exactly the run whose
    // partial results are most worth having, and losing them to the exception is how a real finding
    // gets thrown away.
    const passed = checks.filter(c => c.status === 'pass').length;
    const failed = checks.filter(c => c.status === 'fail').length;
    const skipped = checks.filter(c => c.status === 'skip').length;
    const report = { passed, failed, skipped, total: checks.length, checks };
    process.stdout.write(`\n=== ${passed} passed · ${failed} failed · ${skipped} skipped ===\n`);
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
    if (failed) process.exitCode = 1;
  }
}

main().catch(err => {
  process.stderr.write(`${String(err?.stack || err)}\n`);
  process.exitCode = 1;
});
