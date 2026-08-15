import React, { useState } from 'react';
import {
  AppWindow, Hand, Play, CircleCheck, CircleX, CircleDashed, Clock3, Eye, ShieldAlert, X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { SeedPanel, useSeed } from './ui/seed-expand';
import { describeEvidenceAge, type MacSession, type MacTimelineEntry } from '../mac.session.model';

/**
 * Mac Live Target.
 *
 * The contract from `04_FRONTEND_PLAN.md`: app and exact window being operated, whether Bimax is
 * observing in the background or holding the foreground, the last verified state AND the age of
 * that evidence, Pause / Take Control / Resume, and a readable action timeline. "Raw JSON, element
 * handles, coordinates, AX/OCR source, retries, and fallback codes are inside a Diagnostics
 * disclosure. Normal users see intent and evidence, not plumbing."
 *
 * So the visible surface uses ordinary words and the executor/mechanism vocabulary lives inside a
 * collapsed disclosure per action.
 */

function focusWords(focus: MacTimelineEntry['focus']): string {
  switch (focus) {
    case 'background': return 'without taking over your screen';
    case 'foreground': return 'by bringing the app to the front';
    case 'none': return 'without needing your screen';
    default: return 'delivery not recorded';
  }
}

function executorWords(executor: MacTimelineEntry['executor']): string {
  switch (executor) {
    case 'semantic': return 'used the app’s own controls';
    case 'physical': return 'used a real click or keystroke';
    case 'visual': return 'found the target by looking at the screen';
    case 'stop': return 'stopped instead of guessing';
    default: return 'the route was not recorded';
  }
}

export function LiveTarget({
  session, onPause, onResume,
}: {
  session: MacSession;
  onPause: () => void;
  onResume: () => void;
}): React.ReactElement {
  const { target, evidence, paused } = session;
  const stale = evidence?.freshness === 'stale';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section
        className={cn(
          'shrink-0 rounded-xl border px-3 py-2.5',
          paused ? 'border-amber/40 bg-amber/8' : 'border-line bg-raise',
        )}
        aria-label="Current Mac target"
      >
        <div className="flex items-start gap-2.5">
          <span className={cn('mt-0.5 shrink-0', paused ? 'text-amber' : 'text-ember')}>
            {paused ? <Hand size={16} /> : <AppWindow size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-ink">
              {target?.app || 'No app selected yet'}
            </div>
            <div className="mt-0.5 text-[11px] text-dim">
              {target
                ? target.windowId !== null
                  ? `Window ${target.windowId}${target.pid !== null ? ` · process ${target.pid}` : ''}`
                  : target.pid !== null ? `Process ${target.pid} · window not reported` : 'Window not reported'
                : 'Bimax has not opened or focused an app in this task.'}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-2 border-t border-line/70 pt-2.5">
          <span className={cn('flex items-center gap-1.5 text-[11px]', stale ? 'text-amber' : 'text-dim')}>
            {stale ? <Clock3 size={12} /> : <Eye size={12} />}
            {evidence
              ? `Last look ${describeEvidenceAge(evidence)}${stale ? ' — Bimax will look again before acting' : ''}`
              : 'No observation yet'}
          </span>
          <span className="flex-1" />
          {paused ? (
            <button
              onClick={onResume}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-ember px-3 py-1.5 text-[11.5px] font-medium text-bg hover:bg-ember-bright focus-visible:outline-2 focus-visible:outline-ember"
            >
              <Play size={12} /> Let Bimax continue
            </button>
          ) : (
            <button
              onClick={onPause}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-dim hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
            >
              <Hand size={12} /> Take control
            </button>
          )}
        </div>

        {paused && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber">
            <ShieldAlert size={12} className="mt-0.5 shrink-0" />
            You have control. Bimax will not click or type on your Mac until you let it continue
            {session.refusedWhilePaused > 0
              ? ` — it has already been stopped ${session.refusedWhilePaused} time${session.refusedWhilePaused === 1 ? '' : 's'}.`
              : '.'}
          </p>
        )}
      </section>

      {evidence?.screenshot ? (
        <figure className="mt-3 shrink-0">
          <img
            src={localImageUrl(evidence.screenshot)}
            alt={`Latest view of ${target?.app || 'the target app'}`}
            className={cn(
              'max-h-[260px] w-full rounded-lg border border-line object-contain',
              stale && 'opacity-70',
            )}
          />
          <figcaption className="mt-1 text-[10px] text-faint">
            {stale ? 'This picture is older than Bimax trusts for acting.' : 'What Bimax last saw.'}
          </figcaption>
        </figure>
      ) : null}

      <div className="mt-3 mb-1.5 shrink-0 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">
        What Bimax did
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto pr-1">
        {session.timeline.length === 0 ? (
          <li className="rounded-lg border border-dashed border-line px-3 py-4 text-[11.5px] text-faint">
            No actions yet.
          </li>
        ) : (
          [...session.timeline].reverse().map((entry) => <TimelineRow key={entry.id} entry={entry} />)
        )}
      </ol>
    </div>
  );
}

function statusIcon(entry: MacTimelineEntry, verified: boolean, size = 13): React.ReactElement {
  if (entry.status === 'running') return <CircleDashed size={size} className="text-amber" />;
  if (entry.refusedForTakeover) return <Hand size={size} className="text-amber" />;
  if (entry.status === 'error') return <CircleX size={size} className="text-rust" />;
  return verified
    ? <CircleCheck size={size} className="text-moss" />
    : <CircleDashed size={size} className="text-faint" />;
}

function outcomeWords(entry: MacTimelineEntry, verified: boolean): string {
  if (entry.refusedForTakeover) return 'Nothing was sent to your Mac.';
  if (verified) return `Confirmed ${focusWords(entry.focus)}.`;
  if (entry.status === 'running') return 'In progress…';
  return `Not confirmed — ${entry.postcondition}.`;
}

/**
 * One action, and the surface it becomes.
 *
 * This used to be a `<details>` disclosure, which pushed every row below it down the list — reading
 * one action cost you the position of all the others. The row now expands into its own panel,
 * seeded from the row's own rect, so the detail arrives where the attention already is and the list
 * behind it never moves.
 */
function TimelineRow({ entry }: { entry: MacTimelineEntry }): React.ReactElement {
  const verified = entry.postcondition.startsWith('matched');
  const [open, setOpen] = useState(false);
  const { seed, seedFrom } = useSeed();

  const facts: Array<[string, string]> = [
    ['How', executorWords(entry.executor)],
    ['Screen', focusWords(entry.focus)],
    ['Result', entry.outcome],
    ['Check', entry.postcondition],
  ];

  return (
    <li className="mb-1.5">
      <button
        type="button"
        onClick={(event) => { seedFrom(event); setOpen(true); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'timeline-row pressable w-full cursor-pointer text-left',
          // The row hands its content to the panel; keeping it at full strength underneath reads as
          // two copies of the same card.
          open && 'timeline-row--lifted',
        )}
      >
        <span className="mt-0.5 shrink-0">{statusIcon(entry, verified)}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-ink">{entry.label}</span>
          <span className="mt-0.5 block text-[10.5px] text-dim">{outcomeWords(entry, verified)}</span>
        </span>
        <span className="timeline-row-chevron" aria-hidden>Details</span>
      </button>

      <SeedPanel
        open={open}
        onClose={() => setOpen(false)}
        seed={seed}
        title={entry.label}
        description={`Evidence for ${entry.label}`}
      >
        <header className="flex items-start gap-2.5 border-b border-line px-4 py-3.5">
          <span className="mt-0.5 shrink-0">{statusIcon(entry, verified, 15)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-ink">{entry.label}</div>
            <div className="mt-0.5 text-[11px] text-dim">{outcomeWords(entry, verified)}</div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close details"
            className="evidence-close pressable shrink-0"
          >
            <X size={14} />
          </button>
        </header>
        <dl className="grid grid-cols-[86px_minmax(0,1fr)] gap-x-3 gap-y-2 overflow-y-auto px-4 py-3.5 text-[11.5px]">
          {facts.map(([term, value]) => (
            <React.Fragment key={term}>
              <dt className="text-faint">{term}</dt>
              <dd className="min-w-0 break-words text-dim">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </SeedPanel>
    </li>
  );
}

function localImageUrl(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  return `file://${normalized.startsWith('/') ? '' : '/'}${encodeURI(normalized)}`;
}
