import { BashStaticAnalyzer } from '../governor/bash.analyzer';
import { Logger } from '../utils/logger';

/**
 * YoloClassifier — static bash command safety gate for 'auto' governor mode.
 *
 * Replaced the original two-LLM-call approach (64 + 1024 token round-trips per command)
 * with a deterministic rule-based classifier backed by BashStaticAnalyzer. Zero API cost,
 * zero hallucination risk, and consistent results.
 *
 * Risk threshold: 'none' or 'low' → safe; anything else → require explicit user approval.
 *   none  — read-only (ls, cat, grep…)                            → auto-approve
 *   low   — benign writes (git add, touch, npm run…)              → auto-approve
 *   medium — destructive potential (npm install, pip install…)    → ask user
 *   high  — highly dangerous (rm -rf /, curl | bash…)            → ask user
 *   unknown — unrecognized; unknown risk = not auto-approved       → ask user
 */
export class YoloClassifier {
  private readonly analyzer = new BashStaticAnalyzer();

  // LlmAdapter parameter kept for API compatibility but no longer used.
  constructor(_llm?: unknown) {}

  public async evaluateAction(action: string, _context?: unknown): Promise<boolean> {
    const { risk } = this.analyzer.analyze(action);
    const safe = risk === 'none' || risk === 'low';
    Logger.info(`[YoloClassifier] ${action.slice(0, 80)} → risk=${risk} → ${safe ? 'SAFE' : 'BLOCKED'}`);
    return safe;
  }
}
