import * as fs from 'fs';
import * as path from 'path';
import { mindSingletonRoot } from './self.model';
import { getEventLedger, EventLedger } from './event.ledger';

/**
 * Policy arms (v2 §4.4) — every learned prompt intervention becomes an ARM whose effect
 * is measurable from the ledger instead of assumed.
 *
 * The mechanism the whole plan leans on: when a mind block (self-model hints, habits,
 * user model, drives, calibration escalation, exemplars) is about to enter the prompt,
 * the arm DECIDES (show / hold out) and the decision is logged as a `policy_active`
 * event WITH ITS PROPENSITY. Active arms show with P = 1 − holdout (a small randomized
 * holdout is the price of ever knowing the counterfactual); shadow arms never show but
 * still log what they would have said. Rewards are folded from the ledger per episode
 * (boundary-to-boundary tool-outcome success), and self-normalized IPS gives the
 * off-policy answer — "does showing this block make episodes go better?" — from
 * historical traffic, at zero token cost.
 *
 * Honest scope: reward = episode tool-success ratio ≥ 0.8 (a proxy the ledger can
 * compute today; verified-claim reward joins when TDM coverage deepens), and demotion
 * is surfaced as evidence in `/arms` rather than auto-flipped — the human stays in the
 * loop until the estimator has history behind it.
 */

export const ARM_IDS = ['self-knowledge', 'habits', 'user-model', 'drives', 'calibration', 'exemplars'] as const;
export type ArmId = typeof ARM_IDS[number];

const DEFAULT_HOLDOUT = 0.1;   // active arms hide their block this often — the counterfactual budget
const REWARD_OK_RATIO = 0.8;   // an episode "went well" when ≥80% of its tool calls succeeded
const MIN_EPISODE_TOOLS = 2;   // fewer tool calls than this = no signal, episode skipped

export interface ArmDecision { show: boolean; propensity: number }

interface ArmsFile {
  version: 1;
  status: Partial<Record<ArmId, 'active' | 'shadow'>>;
}

export interface ArmReport {
  arm: ArmId;
  status: 'active' | 'shadow';
  decisions: number;      // policy_active events with a reward-scored episode
  shownRate: number;
  vShow: number | null;   // self-normalized IPS value of "always show"
  vHide: number | null;   // …and of "never show"
  lift: number | null;    // vShow − vHide
}

export class PolicyArms {
  private filePath: string;
  private data: ArmsFile = { version: 1, status: {} };
  private loaded = false;
  private rng: () => number;
  private holdout: number;

  constructor(projectRoot: string = mindSingletonRoot(), opts?: { rng?: () => number; holdout?: number }) {
    this.filePath = path.join(projectRoot, '.bimax', 'policy-arms.json');
    this.rng = opts?.rng ?? Math.random;
    const env = Number(process.env.BIMAX_POLICY_HOLDOUT);
    this.holdout = opts?.holdout ?? (Number.isFinite(env) && env >= 0 && env < 1 ? env : DEFAULT_HOLDOUT);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (parsed?.status) this.data.status = parsed.status;
    } catch { /* first run */ }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch { /* best-effort */ }
  }

  status(arm: ArmId): 'active' | 'shadow' {
    this.load();
    return this.data.status[arm] || 'active';
  }

  setStatus(arm: ArmId, status: 'active' | 'shadow'): void {
    this.load();
    this.data.status[arm] = status;
    this.save();
    try { getEventLedger().append('policy_status', { arm, status }); } catch { /* best-effort */ }
  }

  /**
   * The per-injection gate. Call ONLY when the arm actually has content (an empty block
   * is not a decision). Logs the propensity-carrying event and answers show/hide.
   */
  decide(arm: ArmId, ledger: EventLedger = getEventLedger()): ArmDecision {
    const st = this.status(arm);
    const propensity = st === 'shadow' ? 0 : 1 - this.holdout;
    const show = st === 'shadow' ? false : this.rng() >= this.holdout;
    try { ledger.append('policy_active', { arm, shown: show, propensity }); } catch { /* best-effort */ }
    return { show, propensity };
  }

  /**
   * Fold (decision, reward) pairs from the ledger: each policy_active event joins the
   * episode it sits in (boundary-to-boundary), whose reward is its tool-success ratio.
   */
  foldRewards(ledger: EventLedger = getEventLedger()): Record<ArmId, { shown: boolean; propensity: number; reward: number }[]> {
    const out = Object.fromEntries(ARM_IDS.map(a => [a, [] as { shown: boolean; propensity: number; reward: number }[]])) as Record<ArmId, { shown: boolean; propensity: number; reward: number }[]>;
    let events: { type: string; payload: any }[];
    try { events = ledger.all() as any; } catch { return out; }

    let pending: { arm: ArmId; shown: boolean; propensity: number }[] = [];
    let ok = 0;
    let total = 0;
    const closeEpisode = () => {
      if (pending.length > 0 && total >= MIN_EPISODE_TOOLS) {
        const reward = ok / total >= REWARD_OK_RATIO ? 1 : 0;
        for (const p of pending) {
          if ((ARM_IDS as readonly string[]).includes(p.arm)) out[p.arm].push({ shown: p.shown, propensity: p.propensity, reward });
        }
      }
      pending = [];
      ok = 0;
      total = 0;
    };

    for (const e of events) {
      if (e.type === 'boundary') closeEpisode();
      else if (e.type === 'policy_active' && e.payload?.arm) {
        pending.push({ arm: e.payload.arm, shown: !!e.payload.shown, propensity: Number(e.payload.propensity) || 0 });
      } else if (e.type === 'tool_outcome') {
        const s = e.payload?.status;
        if (s === 'rejected' || s === 'blocked') continue; // policy/preference, not competence
        total++;
        if (s === 'ok') ok++;
      }
    }
    closeEpisode();
    return out;
  }

  /**
   * Self-normalized IPS for one arm: value of the "always show" policy vs "never show",
   * from logged propensities. Null until both sides have observations to weight.
   */
  ipsEstimate(samples: { shown: boolean; propensity: number; reward: number }[]): { vShow: number | null; vHide: number | null; lift: number | null } {
    let wS = 0, rS = 0, wH = 0, rH = 0;
    for (const s of samples) {
      if (s.shown && s.propensity > 0) {
        const w = 1 / s.propensity;
        wS += w; rS += w * s.reward;
      } else if (!s.shown && s.propensity < 1) {
        const w = 1 / (1 - s.propensity);
        wH += w; rH += w * s.reward;
      }
    }
    const vShow = wS > 0 ? rS / wS : null;
    const vHide = wH > 0 ? rH / wH : null;
    return { vShow, vHide, lift: vShow !== null && vHide !== null ? vShow - vHide : null };
  }

  report(ledger: EventLedger = getEventLedger()): ArmReport[] {
    const folded = this.foldRewards(ledger);
    return ARM_IDS.map(arm => {
      const samples = folded[arm];
      const { vShow, vHide, lift } = this.ipsEstimate(samples);
      return {
        arm,
        status: this.status(arm),
        decisions: samples.length,
        shownRate: samples.length > 0 ? samples.filter(s => s.shown).length / samples.length : 0,
        vShow, vHide, lift,
      };
    });
  }
}

let _global: PolicyArms | null = null;
export function getPolicyArms(): PolicyArms {
  if (!_global) _global = new PolicyArms(mindSingletonRoot());
  return _global;
}
export function __setPolicyArms(p: PolicyArms | null): void { _global = p; }
