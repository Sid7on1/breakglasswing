import React from 'react';
import { Square, Hand, Play, CircleCheck, CircleX, Loader, CircleDashed } from 'lucide-react';
import { cn } from '../lib/cn';
import type { TaskStateView } from '../task.state';

/**
 * The current task's one state, its plan progress, and the controls that change the run.
 *
 * `examples/CURRENT_BIMAX_UI.md` — "Model, autonomy, mode, token/context, graph, subagent and
 * verification states all compete near the composer/footer. Keep the one control that changes the
 * current task and move the rest to details." So this strip carries the state, the progress, Stop,
 * and the Mac takeover control; model/tier/permission pickers stay in the composer where they
 * change the next instruction rather than the current one.
 */

const TINT: Record<TaskStateView['state'], string> = {
  idle: 'text-dim',
  working: 'text-ember',
  'needs-you': 'text-amber',
  failed: 'text-rust',
  verified: 'text-moss',
};

function StateIcon({ state }: { state: TaskStateView['state'] }): React.ReactElement {
  switch (state) {
    case 'working': return <Loader size={13} className="animate-spin text-ember" />;
    case 'needs-you': return <Hand size={13} className="text-amber" />;
    case 'failed': return <CircleX size={13} className="text-rust" />;
    case 'verified': return <CircleCheck size={13} className="text-moss" />;
    default: return <CircleDashed size={13} className="text-faint" />;
  }
}

export function TaskHeader({
  view, macActive, macPaused, onInterrupt, onPause, onResume, onOpenMac,
}: {
  view: TaskStateView;
  macActive: boolean;
  macPaused: boolean;
  onInterrupt: () => void;
  onPause: () => void;
  onResume: () => void;
  onOpenMac: () => void;
}): React.ReactElement {
  const progress = view.progress;

  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-line/70 px-6 py-2"
      aria-label="Current task"
    >
      <span className="flex shrink-0 items-center gap-2">
        <StateIcon state={view.state} />
        <span className={cn('text-[12.5px] font-medium', TINT[view.state])} data-task-state={view.state}>
          {view.label}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim" title={view.detail}>{view.detail}</span>

      {progress && (
        <span className="flex shrink-0 items-center gap-2" title={`${progress.done} of ${progress.total} steps complete`}>
          <span className="h-1 w-16 overflow-hidden rounded-full bg-line">
            <span
              className="block h-full rounded-full bg-ember transition-[width] duration-200"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </span>
          <span className="font-mono text-[10px] text-faint tabular-nums">{progress.done}/{progress.total}</span>
        </span>
      )}

      {macActive && (
        macPaused ? (
          <button
            onClick={onResume}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-ember px-2.5 py-1 text-[11px] font-medium text-bg hover:bg-ember-bright focus-visible:outline-2 focus-visible:outline-ember"
          >
            <Play size={11} /> Let Bimax continue
          </button>
        ) : (
          <button
            onClick={onPause}
            title="Stop Bimax acting on your Mac (⌘⇧P)"
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] text-dim hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
          >
            <Hand size={11} /> Take control
          </button>
        )
      )}
      {macActive && (
        <button
          onClick={onOpenMac}
          className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-[11px] text-faint hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
        >
          Live target
        </button>
      )}

      {view.interruptible && (
        <button
          onClick={onInterrupt}
          title="Stop this task (Esc)"
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-rust/35 px-2.5 py-1 text-[11px] text-rust hover:bg-rust/8 focus-visible:outline-2 focus-visible:outline-ember"
        >
          <Square size={10} fill="currentColor" /> Stop
        </button>
      )}
    </header>
  );
}
