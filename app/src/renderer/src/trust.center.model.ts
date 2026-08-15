import type { PermissionDisposition, TrustReport } from './global';
import type { MacSession } from './mac.session.model';
import type { ReviewSnapshot } from './protocol';

export interface TrustCenterSummary {
  coding: 'Available' | 'Unavailable';
  computerUse: 'Available' | 'Needs attention';
  permissions: Array<{
    id: 'screenRecording' | 'accessibility';
    label: string;
    value: PermissionDisposition;
  }>;
}

/** Pure view model so denied/unknown trust facts cannot be made healthy by renderer wording. */
export function summarizeTrustReport(report: TrustReport): TrustCenterSummary {
  return {
    coding: report.coding.available ? 'Available' : 'Unavailable',
    computerUse: report.computerUse.available ? 'Available' : 'Needs attention',
    permissions: [
      // Match the first-Control-Mac journey: first see the app, then operate it. The stable id is
      // also the settings destination; row order can never silently open the wrong pane.
      { id: 'screenRecording', label: 'Screen Recording', value: report.permissions.screenRecording },
      { id: 'accessibility', label: 'Accessibility', value: report.permissions.accessibility },
    ],
  };
}

/**
 * Phase 5 Trust Center: permissions, component/build identity, blockers and action history in one
 * place, as `04_FRONTEND_PLAN.md` describes ("The Trust Center remains available later with grants,
 * permission status, revoke instructions, app version, engine version, native-service version, and
 * a diagnostic export").
 *
 * The history is the *user-relevant* record — approvals the user answered and Mac actions the agent
 * performed — not the app's own log lines. Support diagnostics stay a separate disclosure so a
 * privacy question is never answered with a stack trace.
 */

export type TrustHistoryKind = 'approval' | 'mac-action' | 'takeover';

export interface TrustHistoryEntry {
  id: string;
  kind: TrustHistoryKind;
  title: string;
  detail: string;
  atMs: number | null;
  /** null when the record itself did not state an outcome. */
  ok: boolean | null;
}

export interface TrustCenterView {
  summary: TrustCenterSummary;
  build: string;
  components: Array<{ label: string; present: boolean; source: string; path: string }>;
  /** Everything standing between the user and Mac control, plain language, most actionable first. */
  blockers: string[];
  /** Facts this build could not establish. Never folded into `blockers` — an unknown is not a no. */
  unknowns: string[];
  history: TrustHistoryEntry[];
  /** True when coding works right now regardless of any macOS permission. */
  codingUnaffected: boolean;
}

export function buildTrustCenterView(
  report: TrustReport,
  context: { mac: MacSession; review: ReviewSnapshot | null },
): TrustCenterView {
  const history: TrustHistoryEntry[] = [];

  for (const approval of context.review?.approvals ?? []) {
    history.push({
      id: `approval-${approval.id}`,
      kind: 'approval',
      title: approval.question,
      detail: approval.resolution
        ? `${approval.resolution.approved ? 'Allowed' : 'Declined'} — “${approval.resolution.value}”`
        : 'Still waiting for your answer',
      atMs: approval.resolution?.at ?? approval.requestedAt,
      ok: approval.resolution ? approval.resolution.approved : null,
    });
  }

  for (const entry of context.mac.timeline) {
    history.push({
      id: `mac-${entry.id}`,
      kind: entry.refusedForTakeover ? 'takeover' : 'mac-action',
      title: entry.label,
      detail: entry.refusedForTakeover
        ? 'Refused because you held control'
        : `${entry.executor} · ${entry.focus} · ${entry.postcondition}`,
      atMs: entry.atMs,
      // A performed action is not a proven one: only a matched postcondition says that.
      ok: entry.status === 'error' ? false : entry.postcondition.startsWith('matched') ? true : null,
    });
  }

  history.sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0));

  return {
    summary: summarizeTrustReport(report),
    build: `Bimax ${report.build.appVersion} · ${report.build.packaged ? 'packaged' : 'development'} · Electron ${report.build.electron} · macOS floor ${report.build.minimumMacOS}`,
    components: report.components.map(component => ({
      label: component.label,
      present: component.present,
      source: component.present ? component.source : 'missing',
      path: component.path || '',
    })),
    blockers: report.computerUse.blockers,
    unknowns: report.unknowns,
    history,
    codingUnaffected: report.coding.available,
  };
}
