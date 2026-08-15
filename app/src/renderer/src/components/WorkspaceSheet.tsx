import React, { useState } from 'react';
import { Map as MapIcon, BrainCircuit, Hammer, Sparkles, Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import type { UiSnapshot } from '../protocol';

/**
 * Code map and memory, on request.
 *
 * These were two of the seven peer destinations `04_FRONTEND_PLAN.md` removes. They still have a
 * live consumer — the engine keeps emitting `graph` and `mind` in `ui_snapshot` — so they are not
 * deleted; they become a palette-opened sheet. That is the "progressive disclosure" half of the
 * plan: available when asked for, never competing with the current task.
 *
 * The old animated "graph observatory" (three infinite CSS animations behind a decorative SVG
 * field) is not carried over. It rendered no evidence the numbers below do not, and a permanently
 * animating panel is exactly what the Phase 5 performance constraint rules out.
 */

export type WorkspaceSheetTab = 'map' | 'memory';

export function WorkspaceSheet({
  open, tab, onTab, onClose, snapshot, onCommand,
}: {
  open: boolean;
  tab: WorkspaceSheetTab;
  onTab: (tab: WorkspaceSheetTab) => void;
  onClose: () => void;
  snapshot: UiSnapshot | null;
  onCommand: (cmd: string) => void;
}): React.ReactElement {
  const [impact, setImpact] = useState('');
  const graph = snapshot?.graph;
  const mind = snapshot?.mind;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="w-[min(640px,calc(100vw-min(64px,40vw)))] p-0">
        <header className="flex items-center gap-1 border-b border-line px-4 py-3">
          <DialogTitle className="sr-only">Workspace knowledge</DialogTitle>
          {(['map', 'memory'] as const).map((id) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-selected={tab === id}
              role="tab"
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] focus-visible:outline-2 focus-visible:outline-ember',
                tab === id ? 'bg-selected text-ink' : 'text-dim hover:bg-hover hover:text-ink',
              )}
            >
              {id === 'map' ? <MapIcon size={13} /> : <BrainCircuit size={13} />}
              {id === 'map' ? 'Code map' : 'Memory'}
            </button>
          ))}
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-4">
          {tab === 'map' ? (
            !graph || graph.engine === 'none' || graph.nodeCount === 0 ? (
              <Empty
                title="No map yet"
                detail="Bimax can build a map of this project's symbols and how they connect."
                action={{ label: 'Build code map', onClick: () => onCommand('/index force') }}
              />
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2">
                  <Stat label="Symbols" value={graph.nodeCount.toLocaleString()} />
                  <Stat label="Files" value={graph.fileCount.toLocaleString()} />
                  <Stat label="Index" value={graph.engine === 'codebase-memory' ? 'semantic' : 'native'} />
                  <Stat label="Meaning layer" value={graph.aiGraphBuilt ? 'built' : 'not built'} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <SmallAction icon={<Hammer size={12} />} label="Refresh map" onClick={() => onCommand('/index force')} />
                  {!graph.aiGraphBuilt && (
                    <SmallAction icon={<Sparkles size={12} />} label="Add meaning layer" onClick={() => onCommand('/index-ai force')} />
                  )}
                </div>
                <form
                  className="mt-4 flex items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (impact.trim()) { onCommand(`/impact ${impact.trim()}`); setImpact(''); onClose(); }
                  }}
                >
                  <input
                    value={impact}
                    onChange={(event) => setImpact(event.target.value)}
                    placeholder="What breaks if this file or symbol changes?"
                    aria-label="Change impact query"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-well px-2.5 py-1.5 font-mono text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-ember/55"
                  />
                  <button
                    type="submit"
                    disabled={!impact.trim()}
                    aria-label="Analyze change impact"
                    className="flex cursor-pointer items-center justify-center rounded-lg border border-line bg-raise p-1.5 text-dim hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ember"
                  >
                    <Search size={13} />
                  </button>
                </form>
                {graph.modules.length > 0 && (
                  <section className="mt-4">
                    <h3 className="mb-1.5 text-[10px] font-medium tracking-[0.08em] text-faint uppercase">Main areas</h3>
                    {graph.modules.map((module) => (
                      <div key={module.name} className="flex items-center justify-between py-1 text-[11.5px]">
                        <span className="truncate font-mono text-dim">{module.name}</span>
                        {module.criticality ? <span className="ml-2 shrink-0 text-faint">{module.criticality}</span> : null}
                      </div>
                    ))}
                  </section>
                )}
              </>
            )
          ) : !mind ? (
            <Empty title="Nothing learned yet" detail="Bimax records what it learns from completed, verified work." />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Weak spots" value={String(mind.weakSpots)} tint={mind.weakSpots > 0 ? 'amber' : undefined} />
                <Stat label="Off target" value={String(mind.driveDeviations)} tint={mind.driveDeviations > 0 ? 'amber' : undefined} />
                <Stat label="Habits" value={String(mind.habits)} />
              </div>
              {mind.weak && mind.weak.length > 0 && (
                <section className="mt-4">
                  <h3 className="mb-1.5 text-[10px] font-medium tracking-[0.08em] text-faint uppercase">Weak spots</h3>
                  {mind.weak.map((weak, index) => (
                    <div key={index} className="mb-2 rounded-lg border border-line bg-raise p-2.5 text-[11.5px]">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-ink">{weak.tool}</span>
                        <span className="text-faint tabular-nums">{Math.round(weak.failRate * 100)}% fail · n={weak.n}</span>
                      </div>
                      <div className="mt-1 text-dim">{weak.advice}</div>
                    </div>
                  ))}
                </section>
              )}
              {mind.ledger && (
                <section className="mt-4">
                  <h3 className="mb-1.5 text-[10px] font-medium tracking-[0.08em] text-faint uppercase">Verified knowledge</h3>
                  <div className="grid grid-cols-4 gap-2">
                    <Stat label="Verified" value={String(mind.ledger.resolved)} />
                    <Stat label="Open" value={String(mind.ledger.open)} tint={mind.ledger.open > 0 ? 'amber' : undefined} />
                    <Stat label="Expired" value={String(mind.ledger.expired)} tint={mind.ledger.expired > 0 ? 'rust' : undefined} />
                    <Stat
                      label="Coverage"
                      value={`${Math.round(mind.ledger.coveragePct <= 1 ? mind.ledger.coveragePct * 100 : mind.ledger.coveragePct)}%`}
                    />
                  </div>
                </section>
              )}
              <p className="mt-3 text-[10.5px] text-faint">
                These signals come from completed work and verification, not guesses.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: 'amber' | 'rust' }): React.ReactElement {
  return (
    <div className="rounded-lg border border-line bg-raise px-2.5 py-2">
      <div className={cn('text-[15px] font-semibold tabular-nums', tint === 'amber' ? 'text-amber' : tint === 'rust' ? 'text-rust' : 'text-ink')}>
        {value}
      </div>
      <div className="text-[10.5px] text-faint">{label}</div>
    </div>
  );
}

function SmallAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-raise px-2.5 py-1.5 text-[11.5px] text-dim hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
    >
      <span className="text-ember">{icon}</span> {label}
    </button>
  );
}

function Empty({
  title, detail, action,
}: {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="text-[13px] font-semibold text-ink">{title}</div>
      <div className="max-w-[380px] text-[11.5px] leading-relaxed text-dim">{detail}</div>
      {action && <SmallAction icon={<Hammer size={12} />} label={action.label} onClick={action.onClick} />}
    </div>
  );
}
