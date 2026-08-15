import React from 'react';
import { AlertTriangle, ArrowRight, RefreshCcw, RotateCcw, ShieldCheck } from 'lucide-react';
import type { RecoveryActionName, SupervisorStatus } from '../global';

/**
 * Human-facing recovery notice. Startup is intentionally silent: opening a project should feel
 * like opening a workspace, not watching infrastructure boot. Technical detail lives in the
 * Trust Center.
 *
 * This component was written during Phase 2 but never rendered by anything — a crashed engine
 * simply produced a task surface that had stopped responding, with no statement and no way back.
 * Phase 5 wires it into the task column, which is the only place a crash is actually in the way.
 */
export function EngineStatusBanner({
  status, onAction, onOpenSupport,
}: {
  status: SupervisorStatus;
  onAction: (action: RecoveryActionName, sessionId?: string) => void;
  onOpenSupport: () => void;
}): React.ReactElement | null {
  const failed = status.phase === 'exited' || status.phase === 'failed';
  const reduced = status.phase === 'degraded';

  if (!failed && !reduced) return null;

  return (
    <section
      aria-label="Bimax status"
      aria-live="polite"
      className={`shrink-0 border-b px-4 py-2.5 ${failed ? 'border-rust/25 bg-rust/8' : 'border-amber/20 bg-amber/7'}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${failed ? 'bg-rust/12 text-rust' : 'bg-amber/12 text-amber'}`}>
          <AlertTriangle size={14} />
        </span>
        <div className="min-w-[220px] flex-1">
          <div className={`text-[12.5px] font-medium ${failed ? 'text-rust' : 'text-amber'}`}>
            {failed ? 'Bimax hit a problem' : 'A few workspace features are unavailable'}
          </div>
          <div className="mt-0.5 text-[11px] text-dim">
            {failed ? 'Your work is safe. Try again to continue.' : 'You can keep working while Bimax uses a lighter setup.'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {failed && (
            <>
              <NoticeButton icon={<RefreshCcw size={12} />} label="Try again" primary onClick={() => onAction('retry')} />
              <NoticeButton icon={<ShieldCheck size={12} />} label="Start safely" onClick={() => onAction('restartSafe')} />
              {status.interruptedSessionId && (
                <NoticeButton icon={<RotateCcw size={12} />} label="Restore last task" onClick={() => onAction('restartSafe', status.interruptedSessionId)} />
              )}
            </>
          )}
          <button onClick={onOpenSupport} className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-dim hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ember">
            Trust Center <ArrowRight size={11} />
          </button>
        </div>
      </div>
    </section>
  );
}

function NoticeButton({ icon, label, primary = false, onClick }: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${primary ? 'bg-ink text-bg hover:bg-white' : 'border border-line bg-raise text-dim hover:bg-hover hover:text-ink'}`}
    >
      {icon}{label}
    </button>
  );
}
