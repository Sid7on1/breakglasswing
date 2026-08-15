import React, { useCallback, useEffect, useState } from 'react';
import { CircleCheck, CircleX, Eye, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react';
import type { EvidenceTimeline, RetentionControl, TimelineRow } from '../../../shared/evidence.timeline';
import { cn } from '../lib/cn';

/**
 * The contextual evidence timeline inside the Trust Center — Phase 8, owner section 28.
 *
 * §2.4 requires the Trust Center to show "collection scope and retention", "last use and recent
 * decisions", and "disable, delete, revoke, and diagnostic controls". This panel is that, and it is
 * deliberately boring: every value it renders was derived in main by
 * `app/src/shared/evidence.timeline.ts`, so the renderer cannot compute a friendlier verdict than
 * the evidence supports.
 *
 * Three things are non-negotiable in the presentation:
 *
 *   - **A gap is not a pass.** A row whose evidence is incomplete gets its own chip and its own
 *     colour, never the same treatment as a measured row, and the header refuses to say all-clear.
 *   - **A model's words are labelled.** §6 F requires model output to be "labeled model explanation";
 *     it is rendered in its own block with the version attached, never mixed into a finding.
 *   - **Delete says what it deletes.** The control's blast radius is shown before it is used, not
 *     confirmed after.
 */

const CONFIDENCE_LABEL: Record<TimelineRow['confidence'], string> = {
  measured: 'measured',
  declared: 'from the operation’s own declaration',
  incomplete: 'evidence incomplete',
};

function confidenceClass(confidence: TimelineRow['confidence']): string {
  return confidence === 'measured' ? 'text-moss'
    : confidence === 'declared' ? 'text-faint'
      : 'text-amber';
}

function dispositionClass(disposition: TimelineRow['disposition']): string {
  if (disposition === 'block' || disposition === 'isolate') return 'text-rust';
  if (disposition === 'require-approval' || disposition === 'repair') return 'text-amber';
  if (disposition === 'recommend' || disposition === 'explain') return 'text-dim';
  return 'text-faint';
}

export function EvidencePanel({ taskIntentId }: { taskIntentId?: string }): React.ReactElement {
  const [timeline, setTimeline] = useState<EvidenceTimeline | null>(null);
  const [controls, setControls] = useState<RetentionControl[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [next, nextControls] = await Promise.all([
      window.bimax.evidence.timeline(taskIntentId),
      window.bimax.evidence.retentionControls(taskIntentId),
    ]);
    setTimeline(next);
    setControls(nextControls);
  }, [taskIntentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const remove = useCallback(async (scope: 'task' | 'observations' | 'all') => {
    setBusy(true);
    try {
      await window.bimax.evidence.remove(scope, taskIntentId);
      await refresh();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }, [refresh, taskIntentId]);

  if (!timeline) {
    return <p className="text-[11.5px] text-faint">Loading the evidence timeline…</p>;
  }

  const notable = timeline.rows.filter(row => (
    row.findings.length > 0 || row.evidenceGap !== null || row.verification?.satisfied === false
  ));

  return (
    <div>
      <div
        className={cn(
          'mb-2 rounded border px-2 py-1.5 text-[11.5px]',
          timeline.hasEvidenceGap ? 'border-amber/40 text-amber' : 'border-line/60 text-dim',
        )}
      >
        {headline(timeline)}
      </div>

      {timeline.hasEvidenceGap && timeline.retention.evictions.length > 0 && (
        <p className="mb-2 text-[10.5px] text-faint">
          {timeline.retention.evictions.reduce((sum, e) => sum + e.droppedRecords, 0)} record(s) were
          removed by retention or capacity, so this history is shorter than what actually happened.
        </p>
      )}

      {notable.length === 0 ? (
        <p className="mb-3 text-[11.5px] text-faint">
          No operation in this task raised a finding.
        </p>
      ) : (
        <div className="mb-3">
          {notable.map(row => <EvidenceRow key={row.operationId} row={row} />)}
        </div>
      )}

      <h3 className="mb-1.5 text-[10px] font-medium tracking-[0.08em] text-faint uppercase">
        Retention and deletion
      </h3>
      <p className="mb-1.5 text-[10.5px] text-faint">
        {timeline.retention.totalRecords} record(s) retained
        {timeline.retention.oldestAt
          ? `, oldest from ${new Date(timeline.retention.oldestAt).toLocaleString()}`
          : ''}.
      </p>
      <div className="space-y-1">
        {controls.map((control, index) => {
          const scope = (['task', 'observations', 'all'] as const)[index] ?? 'all';
          const armed = confirming === scope;
          return (
            <div key={control.label} className="rounded border border-line/60 px-2 py-1.5">
              <div className="flex items-start gap-2">
                <Trash2 size={11} className="mt-0.5 shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] text-ink">{control.label}</div>
                  <div className="text-[10.5px] text-dim">{control.effect}</div>
                  <div className="text-[10.5px] text-faint">
                    {control.affectedRecords} record(s) would be removed.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy || control.affectedRecords === 0}
                  onClick={() => (armed ? void remove(scope) : setConfirming(scope))}
                  className={cn(
                    'shrink-0 rounded px-2 py-0.5 text-[10.5px]',
                    armed ? 'bg-rust/20 text-rust' : 'text-faint hover:text-ink',
                    (busy || control.affectedRecords === 0) && 'opacity-40',
                  )}
                >
                  {armed ? 'Confirm delete' : 'Delete'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mirrors `timelineHeadline` so the panel reads the same as the diagnostic export. */
function headline(timeline: EvidenceTimeline): string {
  const findings = timeline.rows.reduce((sum, row) => sum + row.findings.length, 0);
  const blocked = timeline.rows.filter(row => row.disposition === 'block').length;
  if (blocked) return `${blocked} operation(s) refused; ${findings} finding(s) recorded`;
  if (findings) return `${findings} finding(s) recorded, none of which stopped an operation`;
  if (timeline.hasEvidenceGap) {
    return 'No findings — but some evidence is incomplete, so this is not a clean bill of health.';
  }
  if (!timeline.rows.length) return 'No operations recorded for this task yet.';
  return `${timeline.rows.length} operation(s) recorded, all within the approved boundary.`;
}

function EvidenceRow({ row }: { row: TimelineRow }): React.ReactElement {
  return (
    <div className="border-t border-line/60 py-1.5 first:border-t-0 text-[11.5px]">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          {row.disposition === 'block'
            ? <ShieldAlert size={11} className="text-rust" />
            : row.evidenceGap
              ? <TriangleAlert size={11} className="text-amber" />
              : <Eye size={11} className="text-faint" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-ink">{row.operation}</div>
          {row.causalPath.length > 1 && (
            <div className="text-[10.5px] text-faint">
              caused by {row.causalPath.slice(1).join(' ← ')}
            </div>
          )}
          {row.findings.map(finding => (
            <div key={`${finding.ruleId}-${finding.what}`} className="mt-1">
              <div className="text-dim">{finding.what}</div>
              <div className="text-[10.5px] text-faint">
                {finding.violated} · <span className="font-mono">{finding.ruleId}</span>
              </div>
              {finding.benignExplanations.length > 0 && (
                <div className="text-[10.5px] text-faint">
                  could also be: {finding.benignExplanations.join('; ')}
                </div>
              )}
            </div>
          ))}
          {row.evidenceGap && (
            <div className="mt-1 text-[10.5px] text-amber">Evidence gap: {row.evidenceGap}</div>
          )}
          {row.modelExplanation && (
            <div className="mt-1 rounded border border-line/60 px-1.5 py-1 text-[10.5px] text-dim">
              <span className="text-faint">Model explanation ({row.modelExplanation.version}), not a verdict:</span>{' '}
              {row.modelExplanation.text}
            </div>
          )}
          {row.verification && (
            <div className="mt-1 flex items-center gap-1 text-[10.5px]">
              {row.verification.satisfied === true
                ? <CircleCheck size={10} className="text-moss" />
                : row.verification.satisfied === false
                  ? <CircleX size={10} className="text-rust" />
                  : <TriangleAlert size={10} className="text-amber" />}
              <span className="text-faint">
                {row.verification.satisfied === null ? 'Unknown: ' : ''}{row.verification.reason}
              </span>
            </div>
          )}
        </div>
        <span className={cn('shrink-0 text-[10px]', dispositionClass(row.disposition))}>
          {row.disposition ?? '—'}
        </span>
      </div>
      <div className={cn('ml-5 text-[10px]', confidenceClass(row.confidence))}>
        {CONFIDENCE_LABEL[row.confidence]}
      </div>
    </div>
  );
}
