import type { MacSession } from './mac.session.model';
import type { ReviewSnapshot, SubAgentClaim } from './protocol';
import type { GitStatusResult } from './global';

/**
 * Which evidence lanes the current task actually has.
 *
 * `04_FRONTEND_PLAN.md`: "Review, Files, Terminal, Agents, Map, Memory and Health stop being seven
 * peer destinations. The right inspector is contextual… Evidence tabs appear only after that
 * evidence exists." This module is the whole rule, kept pure so a tab can never appear because a
 * component happened to render.
 *
 * `available: false` tabs are still returned, with the reason they are empty. The inspector shows
 * them dimmed rather than hiding them entirely, because a tab that silently disappears reads as a
 * bug — but nothing may auto-open an unavailable tab.
 */

export type InspectorTabId =
  | 'code' | 'mac' | 'browser' | 'receipt' | 'team' | 'runtime' | 'files'
  | 'environment' | 'alchemist';

export interface InspectorTab {
  id: InspectorTabId;
  label: string;
  available: boolean;
  /** Why the tab is empty, in plain language. Shown as the tab's empty state. */
  emptyReason: string;
  /** Small count badge, when the evidence is countable. */
  count: number | null;
  /** Set when this lane needs the user's attention right now. */
  attention: boolean;
}

export interface InspectorInput {
  review: ReviewSnapshot | null;
  gitStatus: GitStatusResult | null;
  mac: MacSession;
  subagents: SubAgentClaim[];
  /** A project is open, so the file tree can be read. */
  hasProject: boolean;
  /** The last browser URL the task reported, when any. */
  browserUrl: string;
  runtimeAvailable?: boolean;
  processCount?: number;
  environmentAvailable?: boolean;
  environmentToolCount?: number;
  alchemistAvailable?: boolean;
  alchemistBackendCount?: number;
}

export function inspectorTabs(input: InspectorInput): InspectorTab[] {
  const changed = input.gitStatus?.files.length ?? 0;
  const reviewChanges = input.review?.changes.length ?? 0;
  const codeCount = Math.max(changed, reviewChanges);
  const verificationFailed = input.review?.state === 'verification_failed';
  const runningAgents = input.subagents.filter(agent => agent.status === 'running').length;
  const finalReceiptReady = hasFinalReceipt(input);

  return [
    {
      id: 'code',
      label: 'Changes',
      available: codeCount > 0 || !!input.review && input.review.state !== 'idle',
      emptyReason: 'Bimax has not changed any files in this task yet.',
      count: codeCount || null,
      attention: verificationFailed,
    },
    {
      id: 'mac',
      label: 'Mac',
      available: input.mac.active,
      emptyReason: 'This task has not operated any Mac app.',
      count: input.mac.timeline.length || null,
      attention: input.mac.paused || input.mac.state === 'blocked' || input.mac.evidence?.freshness === 'stale',
    },
    {
      id: 'browser',
      label: 'Browser',
      available: input.browserUrl.length > 0,
      emptyReason: 'This task has not opened a browser page.',
      count: null,
      attention: false,
    },
    {
      id: 'team',
      label: 'Team',
      available: input.subagents.length > 0,
      emptyReason: 'This task is not running parallel work.',
      count: runningAgents || input.subagents.length || null,
      attention: input.subagents.some(agent => agent.status === 'failed'),
    },
    {
      id: 'runtime',
      label: 'Runtime',
      available: input.runtimeAvailable === true,
      emptyReason: 'Runtime intelligence is unavailable; BiMAX is using bounded defaults.',
      count: input.processCount || null,
      attention: false,
    },
    {
      id: 'environment',
      label: 'Environment',
      available: input.environmentAvailable === true,
      emptyReason: 'Open a project to inspect its declared runtimes and developer tools.',
      count: input.environmentToolCount || null,
      attention: false,
    },
    {
      id: 'alchemist',
      label: 'Alchemist',
      available: input.alchemistAvailable === true,
      emptyReason: 'Local model backends have not been inspected for this project.',
      count: input.alchemistBackendCount || null,
      attention: false,
    },
    {
      id: 'receipt',
      label: 'Receipt',
      available: finalReceiptReady,
      emptyReason: 'A receipt appears when the task has a result to prove.',
      count: null,
      attention: false,
    },
    {
      id: 'files',
      label: 'Files',
      available: input.hasProject,
      emptyReason: 'Open a project to browse its files.',
      count: null,
      attention: false,
    },
  ];
}

/** A receipt needs something to prove: a verification, an applied change, or a Mac action. */
export function hasFinalReceipt(input: Pick<InspectorInput, 'review' | 'mac'>): boolean {
  const review = input.review;
  const provedCode = !!review && (review.verifications.length > 0 || review.changes.length > 0);
  const provedMac = input.mac.timeline.length > 0;
  return provedCode || provedMac;
}

/**
 * Pick the tab to show.
 *
 * A user's explicit choice always wins while it is still available. Otherwise the lane that needs
 * attention wins, then the first available lane. Never returns an unavailable tab.
 */
export function resolveActiveTab(
  tabs: InspectorTab[],
  requested: InspectorTabId | null,
): InspectorTabId | null {
  const chosen = requested ? tabs.find(tab => tab.id === requested) : undefined;
  if (chosen?.available) return chosen.id;
  return tabs.find(tab => tab.available && tab.attention)?.id
    ?? tabs.find(tab => tab.available)?.id
    ?? null;
}
