import React, { useEffect, useRef, useState } from 'react';
import {
  GitCompareArrows, Files, SquareTerminal, Bot, Map as MapIcon, BrainCircuit,
  CircleDashed, CircleCheck, CircleX, Circle, Loader, ChevronRight, ChevronDown,
  Rocket, Users, Search, Hammer, Sparkles, Moon, Film, ScanEye, FileCode2,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { UiSnapshot, SubAgentClaim } from '../protocol';
import { ReviewPanel } from './ReviewPanel';
import { FilesPanel } from './FilesPanel';
import { TerminalPanel } from './TerminalPanel';
import type { GitStatusResult } from '../global';

export type DockTab = 'review' | 'files' | 'terminal' | 'agents' | 'map' | 'mind';

const TABS: { id: DockTab; label: string; icon: React.ReactNode }[] = [
  { id: 'review', label: 'Review', icon: <GitCompareArrows size={15} /> },
  { id: 'files', label: 'Files', icon: <Files size={15} /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={15} /> },
  { id: 'agents', label: 'Agents', icon: <Bot size={15} /> },
  { id: 'map', label: 'Map', icon: <MapIcon size={15} /> },
  { id: 'mind', label: 'Mind', icon: <BrainCircuit size={15} /> },
];

/**
 * Right utility dock. Map / Mind / Agents render live engine state (ui_snapshot detail,
 * subagent_update, todo_update); Review / Files / Terminal are Electron-native (main-process
 * git/fs/pty — P3). The terminal stays mounted (hidden) across tab switches so the shell and
 * its scrollback survive.
 */
export function Dock({
  tab, onTab, snapshot, subagents, todos, project, gitStatus, onRefreshGit, onCommand,
  onOpenFile, editorFileCount, onShowEditor,
}: {
  tab: DockTab;
  onTab: (t: DockTab) => void;
  snapshot: UiSnapshot | null;
  subagents: SubAgentClaim[];
  todos: { content?: string; status?: string }[];
  project: string;
  gitStatus: GitStatusResult | null;
  onRefreshGit: () => void;
  onCommand: (cmd: string) => void;
  onOpenFile: (rel: string) => void;
  editorFileCount: number;
  onShowEditor: () => void;
}): React.ReactElement {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  return (
    <div className="anim-slide-in-right flex h-full flex-col border-l border-line bg-bg">
      <div className="no-scrollbar flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={tab === t.id ? activeRef : undefined}
            onClick={() => onTab(t.id)}
            title={t.label}
            className={cn(
              'flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-[11.5px] whitespace-nowrap',
              tab === t.id ? 'bg-hover text-ink' : 'text-dim hover:text-ink',
            )}
          >
            <span className="shrink-0">{t.icon}</span>
            <span className="truncate">{t.label}</span>
          </button>
        ))}
        {editorFileCount > 0 && (
          <button
            onClick={onShowEditor}
            title={`Back to editor (⌘E) — ${editorFileCount} file${editorFileCount === 1 ? '' : 's'} open`}
            className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-ember/30 px-2 py-1 text-[11px] text-ember hover:bg-ember/10"
          >
            <FileCode2 size={12} /> {editorFileCount}
          </button>
        )}
      </div>
      <div
        className={cn(
          'min-h-0 flex-1 p-3 text-[12.5px]',
          // Native panels manage their own internal scroll areas; engine panels scroll as a page.
          tab === 'review' || tab === 'files' || tab === 'terminal' ? 'overflow-hidden' : 'overflow-y-auto',
        )}
      >
        {tab === 'review' && <ReviewPanel status={gitStatus} refresh={onRefreshGit} onCommand={onCommand} checkpoints={snapshot?.checkpoints} />}
        {tab === 'files' && <FilesPanel project={project} onOpenFile={onOpenFile} />}
        <div className={tab === 'terminal' ? 'h-full min-h-0' : 'hidden'}>
          {project && <TerminalPanel project={project} visible={tab === 'terminal'} />}
        </div>
        {tab === 'agents' && <AgentsPanel subagents={subagents} todos={todos} goalCount={snapshot?.goalCount ?? 0} onCommand={onCommand} />}
        {tab === 'map' && <MapPanel snapshot={snapshot} onCommand={onCommand} />}
        {tab === 'mind' && <MindPanel snapshot={snapshot} onCommand={onCommand} />}
      </div>
    </div>
  );
}

function Placeholder({
  icon, title, children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center select-none">
      <span className="text-faint">{icon}</span>
      <div className="font-semibold text-ink">{title}</div>
      <div className="text-xs leading-relaxed text-dim">{children}</div>
    </div>
  );
}

function Cmd({ children }: { children: React.ReactNode }): React.ReactElement {
  return <code className="rounded border border-line bg-raise px-1 font-mono text-[11px] text-ember">{children}</code>;
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">{title}</div>
      {children}
    </div>
  );
}

// --- Agents: live sub-agent claims + todos + goals + swarm/beast launchers ---------------------

/** Inline arg form for a one-shot launcher button (swarm/beast) — expands under the button row. */
function LauncherForm({
  placeholder, cta, onLaunch, onCancel,
}: {
  placeholder: string;
  cta: string;
  onLaunch: (task: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [task, setTask] = useState('');
  return (
    <form
      className="mt-2 flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (task.trim()) onLaunch(task.trim());
      }}
    >
      <textarea
        autoFocus
        rows={2}
        value={task}
        onChange={(e) => setTask(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLElement).closest('form')?.requestSubmit();
        }}
        placeholder={placeholder}
        className="w-full resize-none rounded-md border border-line bg-well px-2 py-1.5 text-xs text-ink outline-none placeholder:text-faint focus:border-ember/55"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={!task.trim()}
          className="flex-1 cursor-pointer rounded-md bg-ember/90 py-1 text-xs font-medium text-bg hover:bg-ember disabled:cursor-default disabled:opacity-40"
        >
          {cta}
        </button>
        <button type="button" onClick={onCancel} className="cursor-pointer rounded-md border border-line px-2.5 py-1 text-xs text-dim hover:bg-hover">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AgentsPanel({
  subagents, todos, goalCount, onCommand,
}: {
  subagents: SubAgentClaim[];
  todos: { content?: string; status?: string }[];
  goalCount: number;
  onCommand: (cmd: string) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [launcher, setLauncher] = useState<'swarm' | 'beast' | null>(null);

  return (
    <div>
      <PanelSection title="Launch">
        <div className="flex gap-1.5">
          <button
            onClick={() => setLauncher(launcher === 'swarm' ? null : 'swarm')}
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-xs',
              launcher === 'swarm' ? 'bg-hover text-ink' : 'bg-raise text-dim hover:bg-hover hover:text-ink',
            )}
          >
            <Users size={13} className="text-ember" /> Swarm
          </button>
          <button
            onClick={() => setLauncher(launcher === 'beast' ? null : 'beast')}
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-xs',
              launcher === 'beast' ? 'bg-hover text-ink' : 'bg-raise text-dim hover:bg-hover hover:text-ink',
            )}
          >
            <Rocket size={13} className="text-ember" /> Beast
          </button>
        </div>
        {launcher === 'swarm' && (
          <LauncherForm
            placeholder="Task for the swarm — parallel sub-agents on a shared blackboard…"
            cta="Launch swarm"
            onLaunch={(t) => { onCommand(`/swarm ${t}`); setLauncher(null); }}
            onCancel={() => setLauncher(null)}
          />
        )}
        {launcher === 'beast' && (
          <LauncherForm
            placeholder="Goal for the beast pipeline — swarm → heal → self-critic → checkpoint, on a review branch…"
            cta="Unleash beast"
            onLaunch={(t) => { onCommand(`/beast ${t}`); setLauncher(null); }}
            onCancel={() => setLauncher(null)}
          />
        )}
      </PanelSection>

      <PanelSection title={`Sub-agents${subagents.length ? ` · ${subagents.length}` : ''}`}>
        {subagents.length === 0 ? (
          <div className="text-xs text-faint">
            No sub-agents running. Launch a swarm or beast above, or use <Cmd>/speculate</Cmd> / <Cmd>/heal</Cmd>.
          </div>
        ) : (
          subagents.map((a) => {
            const open = expanded === a.taskId;
            return (
              <div key={a.taskId} className="mb-2 rounded-lg border border-line bg-raise">
                <button
                  onClick={() => setExpanded(open ? null : a.taskId)}
                  className="flex w-full cursor-pointer items-center gap-2 p-2.5 text-left"
                >
                  {a.status === 'running'
                    ? <Loader size={13} className="shrink-0 animate-spin text-amber" />
                    : a.status === 'done'
                      ? <CircleCheck size={13} className="shrink-0 text-moss" />
                      : <CircleX size={13} className="shrink-0 text-rust" />}
                  <span className="font-medium">{a.agentType}</span>
                  <span className="ml-auto font-mono text-[10.5px] text-faint tabular-nums">{a.toolCalls} tools</span>
                  {open ? <ChevronDown size={12} className="shrink-0 text-faint" /> : <ChevronRight size={12} className="shrink-0 text-faint" />}
                </button>
                {!open && (
                  <div className="px-2.5 pb-2.5">
                    <div className="truncate text-xs text-dim" title={a.prompt}>{a.prompt}</div>
                    {a.scope !== '(unscoped)' ? (
                      <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{a.scope}</div>
                    ) : null}
                    {a.error ? <div className="mt-1 truncate text-xs text-rust">{a.error}</div> : null}
                  </div>
                )}
                {open && (
                  <div className="border-t border-line px-2.5 pb-2.5">
                    <SubDetail label="Prompt">
                      <div className="text-xs whitespace-pre-wrap text-dim">{a.prompt}</div>
                    </SubDetail>
                    <SubDetail label="Run">
                      <div className="text-xs text-dim">
                        {a.scope !== '(unscoped)' && <span className="font-mono">{a.scope} · </span>}
                        {a.toolCalls} tool call{a.toolCalls === 1 ? '' : 's'}
                        {a.endedAt && a.startedAt ? ` · ${Math.max(1, Math.round((a.endedAt - a.startedAt) / 1000))}s` : ''}
                      </div>
                    </SubDetail>
                    {(a.result || a.error) && (
                      <SubDetail label={a.error ? 'Error' : 'Output'}>
                        <div className={cn(
                          'max-h-48 overflow-y-auto rounded-md bg-well p-2 font-mono text-[11px] whitespace-pre-wrap',
                          a.error ? 'text-rust' : 'text-dim',
                        )}>
                          {a.error || a.result}
                        </div>
                      </SubDetail>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </PanelSection>

      <PanelSection title={`Tasks${todos.length ? ` · ${todos.length}` : ''}`}>
        {todos.length === 0 ? (
          <div className="text-xs text-faint">The agent's live task list appears here while it works.</div>
        ) : (
          todos.map((t, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              {t.status === 'completed'
                ? <CircleCheck size={13} className="mt-0.5 shrink-0 text-moss" />
                : t.status === 'in_progress'
                  ? <CircleDashed size={13} className="mt-0.5 shrink-0 text-ember" />
                  : <Circle size={13} className="mt-0.5 shrink-0 text-faint" />}
              <span className={cn('text-xs', t.status === 'completed' ? 'text-faint line-through' : t.status === 'in_progress' ? 'text-ink' : 'text-dim')}>
                {t.content}
              </span>
            </div>
          ))
        )}
      </PanelSection>

      <PanelSection title="Goals">
        <div className="text-xs text-dim">
          {goalCount > 0
            ? <>{goalCount} active goal{goalCount === 1 ? '' : 's'} — inspect with <Cmd>/goals</Cmd>.</>
            : <>No active goals. Set one with <Cmd>/goals</Cmd>.</>}
        </div>
      </PanelSection>
    </div>
  );
}

function SubDetail({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] font-medium tracking-[0.08em] text-faint uppercase">{label}</div>
      {children}
    </div>
  );
}

/** Small bordered action button used by the Map / Mind panels to fire a slash command. */
function ActionBtn({
  icon, label, onClick, title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-raise px-2.5 py-1.5 text-xs text-dim hover:bg-hover hover:text-ink"
    >
      <span className="text-ember">{icon}</span> {label}
    </button>
  );
}

// --- Map: codebase graph summary + index/impact actions (live from ui_snapshot) ---------------

function MapPanel({ snapshot, onCommand }: { snapshot: UiSnapshot | null; onCommand: (cmd: string) => void }): React.ReactElement {
  const [impact, setImpact] = useState('');
  const g = snapshot?.graph;

  if (!g || g.engine === 'none' || g.nodeCount === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center select-none">
        <span className="text-faint"><MapIcon size={22} /></span>
        <div className="font-semibold text-ink">Codebase map</div>
        <div className="text-xs leading-relaxed text-dim">
          No graph yet for this project. Build the AST map, then enrich it with the semantic layer.
        </div>
        <ActionBtn icon={<Hammer size={13} />} label="Build map graph" title="/index force" onClick={() => onCommand('/index force')} />
      </div>
    );
  }

  return (
    <div>
      <PanelSection title="Graph">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Symbols" value={g.nodeCount.toLocaleString()} />
          <StatTile label="Files" value={g.fileCount.toLocaleString()} />
          <StatTile label="Engine" value={g.engine === 'codebase-memory' ? 'semantic' : 'native'} />
          <StatTile label="AI layer" value={g.aiGraphBuilt ? 'built' : 'not built'} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ActionBtn icon={<Hammer size={13} />} label="Re-index" title="/index force" onClick={() => onCommand('/index force')} />
          {!g.aiGraphBuilt && (
            <ActionBtn icon={<Sparkles size={13} />} label="Build AI layer" title="/index-ai force — makes API calls" onClick={() => onCommand('/index-ai force')} />
          )}
        </div>
      </PanelSection>

      <PanelSection title="Impact query">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (impact.trim()) { onCommand(`/impact ${impact.trim()}`); setImpact(''); }
          }}
        >
          <input
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
            placeholder="symbol or file — what breaks if it changes?"
            className="min-w-0 flex-1 rounded-md border border-line bg-well px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-faint focus:border-ember/55"
          />
          <button
            type="submit"
            disabled={!impact.trim()}
            className="flex cursor-pointer items-center justify-center rounded-md border border-line bg-raise p-1.5 text-dim hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-40"
            title="Run /impact — result renders in the transcript"
          >
            <Search size={13} />
          </button>
        </form>
      </PanelSection>

      {g.modules.length > 0 && (
        <PanelSection title="Top modules">
          {g.modules.map((m) => (
            <div key={m.name} className="flex items-center justify-between py-1 text-xs">
              <span className="truncate font-mono text-dim">{m.name}</span>
              {m.criticality ? <span className="ml-2 shrink-0 text-faint">{m.criticality}</span> : null}
            </div>
          ))}
        </PanelSection>
      )}
      <div className="text-xs text-faint">
        Explore interactively with <Cmd>/map</Cmd>.
      </div>
    </div>
  );
}

// --- Mind: self-model, drives, habits, epistemic ledger (live from ui_snapshot) ----------------

function MindPanel({ snapshot, onCommand }: { snapshot: UiSnapshot | null; onCommand: (cmd: string) => void }): React.ReactElement {
  const m = snapshot?.mind;
  if (!m) {
    return (
      <Placeholder icon={<BrainCircuit size={22} />} title="Mind">
        The mind layer's self-model appears once the engine reports it.
      </Placeholder>
    );
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <ActionBtn icon={<ScanEye size={13} />} label="Self report" title="/self — full self-model in the transcript" onClick={() => onCommand('/self')} />
        <ActionBtn icon={<Moon size={13} />} label="Dream" title="/dream — self-play in a worktree" onClick={() => onCommand('/dream')} />
        <ActionBtn icon={<Film size={13} />} label="Episodes" title="/episodes — recorded episodes + replay" onClick={() => onCommand('/episodes')} />
      </div>
      <PanelSection title="Self-model">
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Weak spots" value={String(m.weakSpots)} tint={m.weakSpots > 0 ? 'amber' : undefined} />
          <StatTile label="Drives off" value={String(m.driveDeviations)} tint={m.driveDeviations > 0 ? 'amber' : undefined} />
          <StatTile label="Habits" value={String(m.habits)} />
        </div>
      </PanelSection>

      {m.weak && m.weak.length > 0 && (
        <PanelSection title="Weak spots">
          {m.weak.map((w, i) => (
            <div key={i} className="mb-2 rounded-lg border border-line bg-raise p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono text-ink">{w.tool}</span>
                <span className="text-faint tabular-nums">{Math.round(w.failRate * 100)}% fail · n={w.n}</span>
              </div>
              <div className="mt-1 text-dim">{w.advice}</div>
            </div>
          ))}
        </PanelSection>
      )}

      {m.drives && m.drives.length > 0 && (
        <PanelSection title="Drives">
          {m.drives.map((d, i) => (
            <div key={i} className="flex items-center gap-2 py-1 text-xs">
              <span className={cn('size-1.5 shrink-0 rounded-full', d.ok ? 'bg-moss' : 'bg-amber')} />
              <span className="text-ink">{d.label}</span>
              <span className="ml-auto text-dim">{d.value}</span>
              <Sparkline data={d.spark} />
            </div>
          ))}
        </PanelSection>
      )}

      {m.habitNames && m.habitNames.length > 0 && (
        <PanelSection title="Habits">
          {m.habitNames.map((h) => (
            <div key={h} className="py-0.5 text-xs text-dim">{h}</div>
          ))}
        </PanelSection>
      )}

      {m.ledger && (
        <PanelSection title="Epistemic ledger">
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Verified" value={String(m.ledger.resolved)} />
            <StatTile label="Open" value={String(m.ledger.open)} tint={m.ledger.open > 0 ? 'amber' : undefined} />
            <StatTile label="Expired" value={String(m.ledger.expired)} tint={m.ledger.expired > 0 ? 'rust' : undefined} />
            <StatTile label="Coverage" value={`${Math.round(m.ledger.coveragePct * 100)}%`} />
          </div>
        </PanelSection>
      )}

      <div className="text-xs text-faint">
        Deep-dive with <Cmd>/self</Cmd>, <Cmd>/drives</Cmd>, <Cmd>/habits</Cmd>, <Cmd>/ledger</Cmd>.
      </div>
    </div>
  );
}

function StatTile({ label, value, tint }: { label: string; value: string; tint?: 'amber' | 'rust' }): React.ReactElement {
  return (
    <div className="rounded-lg border border-line bg-raise px-2.5 py-2">
      <div className={cn('text-[15px] font-semibold tabular-nums', tint === 'amber' ? 'text-amber' : tint === 'rust' ? 'text-rust' : 'text-ink')}>
        {value}
      </div>
      <div className="text-[10.5px] text-faint">{label}</div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }): React.ReactElement | null {
  if (!data || data.length === 0) return null;
  const w = 36;
  const h = 12;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = data.map((v, i) => `${i * step},${h - 2 - v * (h - 4)}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0 text-ember" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}
