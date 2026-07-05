import * as fs from 'fs';
import * as path from 'path';
import { getEventLedger } from './event.ledger';
import { mindSingletonRoot } from './self.model';
import { Logger } from '../utils/logger';

/**
 * Harness self-tuner (the Self-Harness pattern, June 2026: agents that mine their own failure
 * patterns into harness patches lifted Terminal-Bench pass rates by 15–21 points).
 *
 * The tuner reads the event ledger's typed tool outcomes — the ground truth the agent already
 * records about itself — and turns RECURRING failure signatures (tool × error class) into
 * concrete steering patches injected into the system prompt. Each patch carries its own
 * effectiveness accounting: the failure rate that justified it (baseline) and the failure rate
 * observed since it went live. A patch that measurably doesn't help is auto-retired, so the
 * prompt only ever carries steering that earns its tokens.
 *
 * Everything is best-effort and file-backed (.bimax/harness-patches.json): a broken tuner can
 * never break the agent, and patches survive across sessions like the rest of the mind layer.
 */

export interface HarnessPatch {
  id: string;
  tool: string;
  errorClass: string;
  rule: string;
  createdAt: number;
  /** Failures in the mining window that justified the patch. */
  evidenceCount: number;
  /** Failure rate for this tool at creation time (the bar the patch must beat). */
  baselineRate: number;
  /** Outcome accounting since the patch went live. */
  samplesSince: number;
  failuresSince: number;
  status: 'active' | 'retired';
  retiredReason?: string;
}

// A failure signature must recur this often in the mining window before it earns a patch.
const MIN_EVIDENCE = 4;
// Effectiveness verdict needs this many post-patch samples of the tool before judging.
const MIN_SAMPLES_TO_JUDGE = 10;
// How much of the recent ledger the miner looks at.
const WINDOW = 500;
const MAX_ACTIVE_PATCHES = 6; // prompt budget — only the strongest patterns get steering

/** Steering text per error-class family. Grounded, imperative, and tool-specific. */
function ruleFor(tool: string, errorClass: string, count: number): string {
  const ec = errorClass.toLowerCase();
  if (/syntax|parse/.test(ec)) {
    return `${tool} has produced ${count} syntax-broken results recently. Before writing, re-read the exact lines you are changing; after writing, immediately run the project's typecheck/build on that file. For symbol-level changes prefer SymbolEditTool (AST-addressed) over raw text edits.`;
  }
  if (/not_?found|enoent|no such file|missing/.test(ec)) {
    return `${tool} keeps failing on paths that don't exist (${count}× recently). Verify the path first — GlobTool or a quick ls — instead of assuming it; never construct paths from memory.`;
  }
  if (/timeout|timed?_?out/.test(ec)) {
    return `${tool} keeps timing out (${count}× recently). Split the work into smaller invocations, add explicit timeouts, and background anything long-running instead of waiting inline.`;
  }
  if (/permission|denied|eacces/.test(ec)) {
    return `${tool} keeps hitting permission errors (${count}× recently). Check ownership/mode before the call and stay inside the workspace root; do not retry the identical call.`;
  }
  if (/conflict|match|old_string|no match/.test(ec)) {
    return `${tool} keeps failing to match its target (${count}× recently). Re-read the file immediately before editing so the anchor text is byte-exact — whitespace included — and keep anchors short but unique.`;
  }
  return `${tool} has failed with '${errorClass}' ${count}× recently. Before the next call, state what will be different from the failed attempts; if it fails twice the same way, switch tools or approach instead of retrying.`;
}

export class HarnessTuner {
  private patches: HarnessPatch[] = [];
  private loaded = false;
  private file: string;

  constructor(root: string) {
    this.file = path.join(root, '.bimax', 'harness-patches.json');
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      if (Array.isArray(raw?.patches)) this.patches = raw.patches;
    } catch { /* first run */ }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ patches: this.patches }, null, 2), 'utf-8');
    } catch { /* best-effort */ }
  }

  /**
   * One mining pass over the recent ledger: create patches for recurring failure signatures,
   * update effectiveness accounting on live ones, retire the ones that don't help.
   * Cheap (tail read + one pass) — safe to call at every episode boundary.
   */
  mine(): { created: number; retired: number } {
    this.load();
    let created = 0, retired = 0;
    try {
      const events = getEventLedger().tail(WINDOW).filter(e => e.type === 'tool_outcome');
      if (events.length === 0) return { created, retired };

      // Per-tool totals and per-signature failures, with timestamps for since-patch accounting.
      const toolTotals = new Map<string, { total: number; failures: number }>();
      const sigFailures = new Map<string, { count: number; tool: string; errorClass: string }>();
      for (const e of events) {
        const p = e.payload || {};
        const tool = String(p.tool || '');
        if (!tool) continue;
        const t = toolTotals.get(tool) || { total: 0, failures: 0 };
        t.total++;
        const failed = p.status === 'error' || p.isError === true;
        if (failed) {
          t.failures++;
          const ec = String(p.errorClass || 'unknown');
          const key = `${tool}|${ec}`;
          const s = sigFailures.get(key) || { count: 0, tool, errorClass: ec };
          s.count++;
          sigFailures.set(key, s);
        }
        toolTotals.set(tool, t);
      }

      // Effectiveness accounting: outcomes AFTER each active patch's creation.
      for (const patch of this.patches) {
        if (patch.status !== 'active') continue;
        let samples = 0, failures = 0;
        for (const e of events) {
          if (e.ts <= patch.createdAt) continue;
          const p = e.payload || {};
          if (String(p.tool || '') !== patch.tool) continue;
          samples++;
          if (p.status === 'error' || p.isError === true) failures++;
        }
        patch.samplesSince = samples;
        patch.failuresSince = failures;
        if (samples >= MIN_SAMPLES_TO_JUDGE) {
          const rate = failures / samples;
          if (rate >= patch.baselineRate) {
            patch.status = 'retired';
            patch.retiredReason = `no improvement (${(rate * 100).toFixed(0)}% failures since vs ${(patch.baselineRate * 100).toFixed(0)}% baseline)`;
            retired++;
            Logger.info(`[HarnessTuner] Retired patch ${patch.id} — ${patch.retiredReason}`);
          }
        }
      }

      // New patches for signatures with enough evidence and no live patch yet.
      const activeCount = () => this.patches.filter(p => p.status === 'active').length;
      const ranked = [...sigFailures.values()].sort((a, b) => b.count - a.count);
      for (const sig of ranked) {
        if (sig.count < MIN_EVIDENCE) break; // ranked — everything after is below threshold
        if (activeCount() >= MAX_ACTIVE_PATCHES) break;
        // Any prior patch for this signature blocks a new one — an ACTIVE patch already covers
        // it, and a RETIRED one is evidence steering didn't help here (re-creating it would
        // ping-pong retire→create forever on a signature steering can't fix).
        const exists = this.patches.some(p => p.tool === sig.tool && p.errorClass === sig.errorClass);
        if (exists) continue;
        const totals = toolTotals.get(sig.tool) || { total: sig.count, failures: sig.count };
        this.patches.push({
          id: `hp-${Date.now().toString(36)}-${this.patches.length}`,
          tool: sig.tool,
          errorClass: sig.errorClass,
          rule: ruleFor(sig.tool, sig.errorClass, sig.count),
          createdAt: Date.now(),
          evidenceCount: sig.count,
          baselineRate: totals.total > 0 ? totals.failures / totals.total : 1,
          samplesSince: 0,
          failuresSince: 0,
          status: 'active',
        });
        created++;
        Logger.info(`[HarnessTuner] New patch: ${sig.tool} × ${sig.errorClass} (${sig.count} failures in window).`);
      }

      if (created || retired) this.save();
      else if (this.patches.some(p => p.status === 'active')) this.save(); // persist accounting updates
    } catch { /* mining must never break the agent */ }
    return { created, retired };
  }

  /** The system-prompt block carrying every active patch ('' when there are none). */
  getPromptBlock(): string {
    this.load();
    const active = this.patches.filter(p => p.status === 'active');
    if (active.length === 0) return '';
    const lines = active.map(p => `- ${p.rule}`);
    return `### HARNESS PATCHES (self-tuned — mined from YOUR OWN recent failures; each is auto-retired if it stops helping)\n${lines.join('\n')}`;
  }

  all(): HarnessPatch[] {
    this.load();
    return [...this.patches];
  }

  /** Manually retire a patch (the /harness command). */
  retire(id: string): boolean {
    this.load();
    const p = this.patches.find(x => x.id === id && x.status === 'active');
    if (!p) return false;
    p.status = 'retired';
    p.retiredReason = 'manually retired';
    this.save();
    return true;
  }
}

let _global: HarnessTuner | null = null;
export function getHarnessTuner(): HarnessTuner {
  if (!_global) _global = new HarnessTuner(mindSingletonRoot());
  return _global;
}
/** Test hook — swap the singleton for per-test isolation. */
export function __setHarnessTuner(t: HarnessTuner | null): void {
  _global = t;
}
