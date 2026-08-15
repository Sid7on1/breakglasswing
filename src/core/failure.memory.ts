import * as crypto from 'crypto';

// ─── Generalized failure memory ─────────────────────────────────────────────────────────────────
// Provider- and tool-independent detection of repeated ineffective actions, across every tool the
// agent can call (shell, files, network, MCP providers, builds, installs…). Replaces nothing:
// the browser runtime keeps its specialized page-state-aware loop detector (it can see URL and
// element indexes this layer can't); this covers the rest of the toolbox at the agent-loop choke
// point. Research-informed (docs/RESEARCH_LEDGER.md):
//   • Brooker "Fixing retries…" + Azure retry-storm antipattern: budgets on RETRIES, never on
//     first attempts; the breaker breaks repetition, not fresh work.
//   • Google SRE retry budgets: budgets are per operation class, since a flaky network op and a
//     deterministic compile error deserve different patience.
//
// Differentiation rules (mandate §5):
//   same action + same failure      → counts toward the budget
//   same action + CHANGED state     → counter resets (the world moved; retrying is legitimate)
//   similar action, different target → different fingerprint, separate budget
//   transient error classes         → higher budget (429/timeout/reset genuinely recover)
//   permanent error classes         → lower budget (404/EACCES/syntax do not fix themselves)
//   user-requested repetition       → a new user turn resets all counters (the human re-asked)

export interface ActionDescriptor {
  tool: string;
  /** Operation within the tool (subcommand/action). */
  operation?: string;
  /** Target resource: file path, URL, command — normalized before hashing. */
  target?: string;
  /** Raw args JSON — used (normalized) when no explicit target is available. */
  args?: string;
}

export interface OutcomeDescriptor {
  ok: boolean;
  errorClass?: string;
  exitCode?: number;
  /** Hash-worthy sample of the result — detects "same failure" vs "different failure". */
  resultSample?: string;
}

export interface FailureVerdict {
  fingerprint: string;
  repeatCount: number;
  budget: number;
  exhausted: boolean;
  /** Set when exhausted — one short paragraph the agent loop appends to the tool result. */
  note?: string;
}

// Retry budgets by operation class: how many CONSECUTIVE identical failures before the loop is
// told to change strategy. Transient-looking failures get more patience than deterministic ones.
export const DEFAULT_BUDGETS: Record<string, number> = {
  network: 4,     // fetches, MCP calls — genuinely flaky
  shell: 3,
  install: 2,     // package installs repeat expensively
  build: 2,       // a failing build fails again until something changes
  test: 2,
  file: 2,        // ENOENT/EACCES do not heal on retry
  auth: 2,        // hammering credentials is never right
  routing: 2,
  generic: 3,
};

const TRANSIENT = /timeout|timed? ?out|429|rate.?limit|reset|econnreset|econnrefused|eai_again|socket|temporarily|unavailable|503|502/i;
const TRANSIENT_BONUS = 2; // extra patience for genuinely transient error classes

const CLASS_BY_TOOL: Array<[RegExp, string]> = [
  [/bash|shell/i, 'shell'],
  [/webfetch|websearch|mcp__|network/i, 'network'],
  [/read|write|edit|delete|glob|grep|directory|notebook/i, 'file'],
  [/install/i, 'install'],
  [/test/i, 'test'],
  [/auth|key/i, 'auth'],
];

export function operationClass(tool: string, target?: string): string {
  if (tool === 'BashTool' && target) {
    // Match on the first couple of words so runner prefixes (npx, bunx, pnpm dlx) still classify.
    const head = target.trim().split(/\s+/).slice(0, 3).join(' ');
    if (/\b(npm|pnpm|yarn|pip3?|brew|cargo|gem|apt(-get)?)\b/.test(head) && /\b(install|add)\b/.test(target)) return 'install';
    if (/\b(make|tsc|go|cargo|gradle|mvn|npm|bun)\b/.test(head) && /\b(build|compile)\b/.test(target)) return 'build';
    if (/\b(jest|vitest|pytest|go test|npm test)\b/.test(head)) return 'test';
  }
  for (const [re, cls] of CLASS_BY_TOOL) if (re.test(tool)) return cls;
  return 'generic';
}

/** Stable fingerprint of an action: tool + operation + normalized target/args. Free text the user
 *  typed (message bodies, file CONTENT) is deliberately excluded — only the action's shape counts. */
export function actionFingerprint(a: ActionDescriptor): string {
  let target = a.target || '';
  if (!target && a.args) {
    try {
      const parsed = JSON.parse(a.args);
      // Common target-bearing fields across the toolbox, in preference order.
      target = parsed.command ?? parsed.path ?? parsed.file_path ?? parsed.url ?? parsed.selector ?? parsed.query ?? '';
      if (typeof target !== 'string') target = JSON.stringify(target);
    } catch { target = a.args.slice(0, 200); }
  }
  // Normalize: collapse whitespace, strip numbers that churn (timestamps, ports, PIDs) so
  // "retry with a different timestamp" doesn't dodge the fingerprint.
  const norm = target.trim().replace(/\s+/g, ' ').replace(/\b\d{4,}\b/g, 'N').slice(0, 300);
  const h = crypto.createHash('sha1').update(`${a.tool}|${a.operation || ''}|${norm}`).digest('hex').slice(0, 12);
  return `${a.tool}:${h}`;
}

interface Entry {
  count: number;
  errorClass?: string;
  exitCode?: number;
  sampleHash?: string;
  lastAt: number;
}

export class FailureMemory {
  private entries = new Map<string, Entry>();
  private budgets: Record<string, number>;

  constructor(budgets: Record<string, number> = DEFAULT_BUDGETS) {
    this.budgets = { ...budgets };
  }

  setBudget(cls: string, n: number): void { this.budgets[cls] = n; }

  /** A fresh user instruction legitimizes repetition — all counters reset. */
  newUserTurn(): void { this.entries.clear(); }

  /** Report an action outcome; returns the verdict the caller may surface to the model. */
  report(action: ActionDescriptor, outcome: OutcomeDescriptor): FailureVerdict {
    const fp = actionFingerprint(action);
    if (outcome.ok) {
      this.entries.delete(fp);
      return { fingerprint: fp, repeatCount: 0, budget: 0, exhausted: false };
    }
    const sampleHash = outcome.resultSample
      ? crypto.createHash('sha1').update(outcome.resultSample.slice(0, 500)).digest('hex').slice(0, 8)
      : undefined;
    const prev = this.entries.get(fp);
    let count: number;
    if (
      prev &&
      prev.errorClass === outcome.errorClass &&
      prev.exitCode === outcome.exitCode &&
      (prev.sampleHash === undefined || sampleHash === undefined || prev.sampleHash === sampleHash)
    ) {
      count = prev.count + 1; // same action, same failure
    } else {
      count = 1; // first failure, or the failure CHANGED (world moved / different error) — restart
    }
    this.entries.set(fp, { count, errorClass: outcome.errorClass, exitCode: outcome.exitCode, sampleHash, lastAt: Date.now() });

    const cls = operationClass(action.tool, action.target || tryTarget(action.args));
    let budget = this.budgets[cls] ?? this.budgets.generic;
    if (outcome.errorClass && TRANSIENT.test(outcome.errorClass)) budget += TRANSIENT_BONUS;
    else if (outcome.resultSample && TRANSIENT.test(outcome.resultSample.slice(0, 300))) budget += TRANSIENT_BONUS;

    const exhausted = count >= budget;
    return {
      fingerprint: fp, repeatCount: count, budget, exhausted,
      note: exhausted
        ? `This exact ${cls} action has now failed ${count} times with the same error. Repeating it again is unlikely to work — change strategy: try a different approach, inspect the state that's failing, or ask the user if genuinely blocked. (The failed attempts are preserved; the task stays resumable.)`
        : undefined,
    };
  }

  /** Current consecutive-failure count for an action (0 = clean slate). */
  countFor(action: ActionDescriptor): number {
    return this.entries.get(actionFingerprint(action))?.count ?? 0;
  }
}

function tryTarget(args?: string): string | undefined {
  if (!args) return undefined;
  try { const p = JSON.parse(args); return p.command ?? p.path ?? p.file_path ?? p.url; } catch { return undefined; }
}

let singleton: FailureMemory | null = null;
export function getFailureMemory(): FailureMemory {
  if (!singleton) singleton = new FailureMemory();
  return singleton;
}
export function __resetFailureMemoryForTests(): FailureMemory {
  singleton = new FailureMemory();
  return singleton;
}
