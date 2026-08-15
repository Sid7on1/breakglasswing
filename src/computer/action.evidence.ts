/**
 * One shared reading of "what did the recorded ComputerTool sequence actually prove?".
 *
 * Two independent gates need this answer — the agent loop, which refuses a premature success
 * claim, and the todo tool, which refuses a premature completed status. They were written twice,
 * with subtly different strictness: one accepted any result carrying a screenshot, the other
 * additionally required the frame to have changed. Two gates disagreeing about what counts as
 * proof is worse than either rule, because the looser one silently defines the ceiling. This module
 * is the single definition; both callers import it.
 *
 * Nothing here names an application. The recorded results carry their own `app` field, so the app
 * vocabulary of a session is derived from the evidence rather than from a list this file guesses.
 */

import { Message } from '../core/llm.provider';

/** The subset of a ComputerTool result this module reasons about. Deliberately loose: results
 * arrive as JSON parsed out of the transcript and may have been produced by an older build. */
export interface ComputerActionResult {
  ok?: boolean;
  action?: string;
  app?: string;
  summary?: string;
  screenshot?: string;
  progressCheck?: { outcome?: string };
  targeting?: { label?: string };
  actionReceipt?: { target?: { element?: string } };
  /** The typed ActionResult contract. `confidence: 'proven'` is set ONLY when a semantic
   * postcondition the caller declared (expect/expectMode) actually matched in the fresh frame. */
  actionResult?: { confidence?: string; postcondition?: { query?: string; matched?: boolean } };
  [key: string]: unknown;
}

export interface ComputerToolStep {
  args: Record<string, unknown>;
  result: ComputerActionResult;
}

/** Verbs that put content INTO a surface. A commit must come after the latest one of these. */
const CONTENT_ENTRY_ACTIONS = new Set(['type', 'paste', 'set_value']);

/** Verbs that only move attention. They can never be the proof that a task's effect landed. */
const NAVIGATION_ACTIONS = new Set(['open', 'focus', 'observe', 'screenshot', 'apps', 'windows', 'arrange']);

/** Commit-shaped control names. "ok"/"done"/"confirm" are deliberately absent: dismissing an error
 * dialog is the opposite of committing, and those are exactly the labels such a dialog carries. */
const COMMIT_TARGET = /\b(?:send|submit|post|reply|share|upload|search|go|save|publish)\b/i;

const RETURN_KEY = /\b(?:return|enter)\b/i;

/** Every ComputerTool result still present in the transcript, oldest first. Results lost to context
 * compaction simply are not here, which makes every gate built on this fail OPEN — an absent
 * transcript must not strand a task that really did complete. */
export function computerToolResults(messages: Message[] | undefined): ComputerActionResult[] {
  if (!Array.isArray(messages)) return [];
  const computerCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const call of message.tool_calls || []) {
      if (call.function.name === 'ComputerTool') computerCallIds.add(call.id);
    }
  }
  return messages.flatMap(message => {
    if (message.role !== 'tool' || typeof message.content !== 'string') return [];
    try {
      const parsed = JSON.parse(message.content);
      // Current providers do not all preserve the desktop runtime's driver label. The tool-call id
      // is the authoritative provenance when it is available; the driver remains a compatibility
      // fallback for compacted/legacy transcripts whose assistant call was already discarded.
      const belongsToComputerTool = Boolean(message.tool_call_id && computerCallIds.has(message.tool_call_id));
      return (belongsToComputerTool || String(parsed?.driver || '').startsWith('bimax-computer-use')) && parsed?.action
        ? [parsed as ComputerActionResult]
        : [];
    } catch { return []; /* compacted or non-JSON tool result */ }
  });
}

/** Pair each recorded ComputerTool result with the arguments that caused it. Results alone say that
 * some text was typed, but not which text; completion gates need the pair to distinguish typing a
 * recipient into Search from typing the user's requested message into the composer. Missing or
 * compacted calls are omitted so old transcripts continue to fail open. */
export function computerToolSteps(messages: Message[] | undefined): ComputerToolStep[] {
  if (!Array.isArray(messages)) return [];
  const calls = new Map<string, Record<string, unknown>>();
  const steps: ComputerToolStep[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.tool_calls || []) {
        if (call.function.name !== 'ComputerTool') continue;
        try {
          const args = JSON.parse(call.function.arguments);
          if (args && typeof args === 'object' && !Array.isArray(args)) calls.set(call.id, args);
        } catch { /* malformed calls never executed successfully */ }
      }
      continue;
    }
    if (message.role !== 'tool' || !message.tool_call_id || typeof message.content !== 'string') continue;
    const args = calls.get(message.tool_call_id);
    if (!args) continue;
    try {
      const parsed = JSON.parse(message.content);
      // Pairing to an actual ComputerTool call is stronger evidence than a provider-specific driver
      // string, and keeps compatibility/CUA adapters visible to the same completion gates.
      if (parsed?.action) {
        steps.push({ args, result: parsed as ComputerActionResult });
      }
    } catch { /* compacted result: no evidence */ }
  }
  return steps;
}

/**
 * Did this action visibly move the screen? A result with no fresh frame proves nothing, and the
 * runtime's own verdict (`progressCheck.outcome`, plus the wording it stamps into `summary`) is the
 * authority on whether those fresh pixels differed. This is the project's standing rule — judge by
 * the screen, not by the driver's return — applied here rather than restated.
 */
export function actionChangedTheScreen(result: ComputerActionResult | undefined): boolean {
  if (!result?.screenshot || result.ok === false) return false;
  const outcome = String(result.progressCheck?.outcome || '');
  if (/^(?:no-change|expectation-missed|rejected|failed|wrong-window)$/i.test(outcome)) return false;
  return !/did NOT change|nothing visibly happened/i.test(String(result.summary || ''));
}

/** Distinct application names that appear in the recorded evidence. This is the session's real app
 * vocabulary; a gate that needs to scope evidence to one app matches against THIS, never against a
 * hardcoded list of apps someone happened to test with. */
export function appsInEvidence(results: ComputerActionResult[]): string[] {
  const seen = new Map<string, string>();
  for (const result of results) {
    const app = String(result?.app || '').trim();
    if (app) seen.set(app.toLocaleLowerCase(), app);
  }
  return [...seen.values()];
}

/** The app named in `text`, chosen only from apps that actually appear in the evidence. Returns
 * undefined when the text names none of them, in which case evidence must not be app-scoped. */
export function appMentionedIn(text: string, results: ComputerActionResult[]): string | undefined {
  const haystack = String(text || '');
  return appsInEvidence(results)
    // Longest first, so "WhatsApp Business" wins over "WhatsApp" when both were used.
    .sort((a, b) => b.length - a.length)
    .find(app => new RegExp(`\\b${app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i').test(haystack));
}

/** Results belonging to one app, or all of them when no app was identified. */
export function scopeToApp(results: ComputerActionResult[], app?: string): ComputerActionResult[] {
  if (!app) return results;
  const needle = app.toLocaleLowerCase();
  return results.filter(result => String(result?.app || '').toLocaleLowerCase().includes(needle));
}

/** Index of the newest successful action that entered content, or -1 when nothing was entered. */
export function lastContentEntryIndex(results: ComputerActionResult[]): number {
  for (let index = results.length - 1; index >= 0; index--) {
    const result = results[index];
    if (result?.ok !== false && CONTENT_ENTRY_ACTIONS.has(String(result?.action || '').toLocaleLowerCase())) {
      return index;
    }
  }
  return -1;
}

/**
 * Did the caller DECLARE a postcondition on this action and have the runtime prove it in the fresh
 * frame? `confidence: 'proven'` is reachable no other way — `classifyVerification` only awards it for
 * a matched semantic expectation (see toActionResult in verification.ts).
 *
 * This is the evidence the whole runtime is built around, and it outranks anything a gate can infer
 * from prose. A model that declares `expect="message appears in the transcript"` states its own
 * success criterion and has it checked against pixels+AX; no keyword list can improve on that.
 */
export function postconditionProven(result: ComputerActionResult | undefined): boolean {
  if (!result) return false;
  return String(result.actionResult?.confidence || '') === 'proven'
    || result.actionResult?.postcondition?.matched === true
    || String(result.progressCheck?.outcome || '') === 'confirmed';
}

/**
 * Is there proof that content entered at `entryIndex` was then COMMITTED? The commit must come after
 * the entry, be in the same app as the entry (a Return that submitted a Safari search is not the
 * WhatsApp send), and its fresh frame must have changed. Reaching a composer is not committing;
 * typing into it is not either.
 *
 * Given a commit-shaped action, EITHER kind of evidence qualifies it:
 *
 *   declared  — a postcondition the caller stated was proven in the fresh frame. Primary, because it
 *               is the runtime's own strongest verdict and is language- and app-agnostic.
 *   named     — the control's label reads as a commit. Fallback for when nothing was declared.
 *
 * The declared route is not a nicety, it repairs a real hole in the named route: this project's own
 * persona warns that "commit buttons are frequently unlabeled icons", and `describeUnlabeledControls`
 * names those by position ('bottom-right #3'). Such a click can never match a commit word, so with
 * only the named test a model that correctly clicks an unlabeled send icon could not satisfy this gate
 * at all and would be pushed toward pressing Return in an app that needs the button. Declaring an
 * expectation is the precise, non-guessy way out — and the gate's message says so.
 */
export function commitProvenAfter(results: ComputerActionResult[], entryIndex: number): boolean {
  if (entryIndex < 0) return false;
  const entryApp = String(results[entryIndex]?.app || '');
  return results.slice(entryIndex + 1).some(result => {
    if (!actionChangedTheScreen(result)) return false;
    if (entryApp && result.app && String(result.app) !== entryApp) return false;
    const action = String(result.action || '').toLocaleLowerCase();
    if (action === 'key') return RETURN_KEY.test(String(result.summary || ''));
    if (action !== 'click') return false;
    if (postconditionProven(result)) return true;
    const named = [result.targeting?.label, result.actionReceipt?.target?.element, result.summary]
      .filter(Boolean).join(' ');
    return COMMIT_TARGET.test(named);
  });
}

/** Did anything beyond navigation actually happen, with a changed frame to show for it? This is the
 * floor under any claim that a surface now displays a result: opening an app and looking at it can
 * never satisfy it. */
export function interactionProven(results: ComputerActionResult[]): boolean {
  return results.some(result => !NAVIGATION_ACTIONS.has(String(result?.action || '').toLocaleLowerCase())
    && actionChangedTheScreen(result));
}

/** Did content demonstrably reach the system clipboard? */
export function clipboardWriteProven(results: ComputerActionResult[]): boolean {
  return results.some(result => result?.ok !== false
    && /^(?:copy|clipboard)$/i.test(String(result?.action || '')));
}
