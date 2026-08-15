import React, { useId, useMemo, useState } from 'react';
import {
  GitCompareArrows, Files, SquareTerminal, Bot, Map as MapIcon, BrainCircuit,
  Activity, AlertTriangle, X,
  CircleDashed, CircleCheck, CircleX, Circle, Loader, ChevronRight, ChevronDown,
  Rocket, Users, Search, Hammer, Sparkles, Moon, Film, ScanEye, FileCode2,
  Orbit, Layers3, ShieldCheck,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { UiSnapshot, SubAgentClaim, ReviewSnapshot } from '../protocol';
import { ReviewPanel } from './ReviewPanel';
import { FilesPanel } from './FilesPanel';
import { TerminalPanel } from './TerminalPanel';
import type { GitStatusResult, SupervisorStatus } from '../global';
import type { DiagnosticEntry } from '../useEngine';

export type DockTab = 'review' | 'files' | 'terminal' | 'agents' | 'map' | 'mind' | 'health';

const TABS: { id: DockTab; label: string; description: string; group: 'workspace' | 'intelligence' | 'system'; icon: React.ReactNode }[] = [
  { id: 'review', label: 'Review changes', description: 'Inspect, verify, and save your work', group: 'workspace', icon: <GitCompareArrows size={16} /> },
  { id: 'files', label: 'Files', description: 'Project explorer', group: 'workspace', icon: <Files size={16} /> },
  { id: 'terminal', label: 'Terminal', description: 'Project shell', group: 'workspace', icon: <SquareTerminal size={16} /> },
  { id: 'agents', label: 'Agent team', description: 'Parallel work and task progress', group: 'intelligence', icon: <Bot size={16} /> },
  { id: 'map', label: 'Code map', description: 'See how the project fits together', group: 'intelligence', icon: <MapIcon size={16} /> },
  { id: 'mind', label: 'Memory', description: 'Learning and workspace context', group: 'intelligence', icon: <BrainCircuit size={16} /> },
  { id: 'health', label: 'Support', description: 'App status and diagnostics', group: 'system', icon: <Activity size={16} /> },
];

const GROUP_LABELS: Record<(typeof TABS)[number]['group'], string> = {
  workspace: 'Workspace',
  intelligence: 'Intelligence',
  system: 'System',
};

/**
 * Right utility dock. Map / Mind / Agents render live engine state (ui_snapshot detail,
 * subagent_update, todo_update); Review / Files / Terminal are Electron-native (main-process
 * git/fs/pty — P3). The terminal stays mounted (hidden) across tab switches so the shell and
 * its scrollback survive.
 */
export function Dock({
  tab, onTab, snapshot, review, subagents, todos, project, gitStatus, onRefreshGit, onCommand,
  onOpenFile, editorFileCount, onShowEditor,
  diagnostics, runtime,
  onClose,
}: {
  tab: DockTab;
  onTab: (t: DockTab) => void;
  snapshot: UiSnapshot | null;
  review: ReviewSnapshot | null;
  subagents: SubAgentClaim[];
  todos: { content?: string; status?: string }[];
  project: string;
  gitStatus: GitStatusResult | null;
  onRefreshGit: () => void;
  onCommand: (cmd: string) => void;
  onOpenFile: (rel: string) => void;
  editorFileCount: number;
  onShowEditor: () => void;
  diagnostics: DiagnosticEntry[];
  runtime: SupervisorStatus | null;
  onClose: () => void;
}): React.ReactElement {
  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0];
  const runningAgents = subagents.filter((agent) => agent.status === 'running').length;
  const liveSignal = tab === 'health'
    ? runtime?.phase === 'ready' || runtime?.phase === 'degraded' ? 'Bimax is ready' : 'Checking status'
    : tab === 'map'
      ? snapshot?.graph.nodeCount ? `${snapshot.graph.nodeCount.toLocaleString()} symbols` : 'not indexed'
      : tab === 'agents'
        ? runningAgents ? `${runningAgents} specialist${runningAgents === 1 ? '' : 's'} working` : 'team is ready'
        : tab === 'review'
          ? review?.state === 'awaiting_approval' ? 'decision waiting' : gitStatus?.files.length ? `${gitStatus.files.length} changed` : 'working tree clean'
          : activeTab.description;

  return (
    <div className="workspace-panel anim-slide-in-right flex h-full min-w-0 flex-col border-l border-line bg-bg">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-selected text-ember">{activeTab.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{activeTab.label}</h2>
              <span className="truncate text-[10.5px] text-faint">{liveSignal}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-dim">{activeTab.description}</div>
          </div>
          {editorFileCount > 0 && (
            <button onClick={onShowEditor} title="Return to open files" className="relative flex size-8 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-hover hover:text-ink">
              <FileCode2 size={14} />
              <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-ember px-1 text-center font-mono text-[8px] leading-4 text-white">{editorFileCount}</span>
            </button>
          )}
          <button onClick={onClose} title="Close workspace panel" className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-hover hover:text-ink"><X size={15} /></button>
        </div>
      </header>

      <div className={cn(
        'min-h-0 flex-1 p-3 text-[12.5px]',
        tab === 'review' || tab === 'files' || tab === 'terminal' ? 'overflow-hidden' : 'overflow-y-auto',
      )}>
          {tab === 'review' && <ReviewPanel status={gitStatus} review={review} refresh={onRefreshGit} onCommand={onCommand} checkpoints={snapshot?.checkpoints} />}
          {tab === 'files' && <FilesPanel project={project} onOpenFile={onOpenFile} />}
          <div className={tab === 'terminal' ? 'h-full min-h-0' : 'hidden'}>
            {project && <TerminalPanel project={project} visible={tab === 'terminal'} />}
          </div>
          {tab === 'agents' && <AgentsPanel subagents={subagents} todos={todos} goalCount={snapshot?.goalCount ?? 0} onCommand={onCommand} />}
          {tab === 'map' && <MapPanel snapshot={snapshot} onCommand={onCommand} />}
          {tab === 'mind' && <MindPanel snapshot={snapshot} onCommand={onCommand} />}
          {tab === 'health' && <HealthPanel diagnostics={diagnostics} runtime={runtime} /* the wire has no computer field at this protocol version — the card owns the empty state */
            computer={undefined} onCommand={onCommand} />}
      </div>
    </div>
  );
}

function HealthPanel({ diagnostics, runtime, computer, onCommand }: {
  diagnostics: DiagnosticEntry[];
  runtime: SupervisorStatus | null;
  computer?: DockComputerSummary;
  onCommand: (cmd: string) => void;
}): React.ReactElement {
  const problems = diagnostics.filter((d) => d.level !== 'info');
  const ready = runtime?.phase === 'ready' || runtime?.phase === 'degraded';
  return (
    <div>
      <RuntimePulse runtime={runtime} issueCount={problems.length} />
      <ComputerUseCard computer={computer} onCommand={onCommand} />
      <PanelSection title="App status">
        <div className="mb-3 rounded-lg border border-line bg-raise px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className={cn('size-2 rounded-full', ready ? 'bg-moss' : problems.length ? 'bg-amber' : 'bg-faint')} />
            <span className="font-medium text-ink">
              {ready ? 'Bimax is ready' : problems.length ? `${problems.length} issue${problems.length === 1 ? '' : 's'} needs attention` : 'Checking Bimax'}
            </span>
          </div>
          {runtime && runtime.degradedCapabilities.length > 0 && (
            <div className="mt-2 rounded-md border border-amber/25 bg-amber/8 px-2 py-1.5 text-[11px] text-amber">
              {runtime.degradedCapabilities.length} optional feature{runtime.degradedCapabilities.length === 1 ? ' is' : 's are'} paused. You can continue working normally.
            </div>
          )}
          <div className="mt-2 text-[11px] leading-relaxed text-faint">
            If something feels wrong, copy the relevant activity below when contacting support.
          </div>
        </div>
      </PanelSection>

      <PanelSection title={`Activity${diagnostics.length ? ` · ${diagnostics.length}` : ''}`}>
        {diagnostics.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-faint">Nothing needs your attention.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {[...diagnostics].reverse().map((entry) => (
              <div key={entry.id} className="rounded-lg border border-line bg-raise px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
                  {entry.level === 'error' || entry.level === 'warn'
                    ? <AlertTriangle size={11} className={entry.level === 'error' ? 'text-rust' : 'text-amber'} />
                    : <Activity size={11} className="text-moss" />}
                  <span className={entry.level === 'error' ? 'text-rust' : entry.level === 'warn' ? 'text-amber' : 'text-faint'}>{entry.level}</span>
                  <span className="ml-auto normal-case text-faint">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="mt-1 break-words text-xs leading-relaxed text-dim">{entry.text.replace(/engine/gi, 'Bimax').replace(/supervisor/gi, 'app')}</div>
              </div>
            ))}
          </div>
        )}
      </PanelSection>
    </div>
  );
}

/**
 * Computer-use posture (Runtime lane, capability-matrix slice): browser session, desktop-control
 * companion, model vision, session grants, context taint. Every value comes from the engine's
 * ui_snapshot — the card renders an honest empty state when the engine hasn't reported one.
 */
/**
 * The computer-use summary this panel renders.
 *
 * It used to be typed as `UiSnapshot['computer']`, but the engine's current ui_snapshot does not
 * carry that field — this component predates the protocol it is reading. Declaring the shape here
 * keeps the panel honest: it renders its empty state until something genuinely supplies one, rather
 * than reaching for a field the wire never sends.
 */
export interface DockComputerSummary {
  browserUrl?: string;
  desktop?: 'connected' | 'configured' | 'unavailable' | string;
  desktopTools?: number;
  grants?: string[];
  tainted?: boolean;
  vision?: string;
}

function ComputerUseCard({ computer, onCommand }: {
  computer?: DockComputerSummary;
  onCommand: (cmd: string) => void;
}): React.ReactElement {
  if (!computer) {
    return (
      <PanelSection title="Computer use">
        <div className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-faint">
          The engine hasn&apos;t reported computer-use status yet. It appears here once Bimax is connected.
        </div>
      </PanelSection>
    );
  }
  const row = (dot: string, label: string, detail: string, action?: { label: string; cmd: string }) => (
    <div className="flex items-start gap-2 py-1">
      <span className={cn('mt-1 size-2 shrink-0 rounded-full', dot)} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-ink">{label}</div>
        <div className="truncate text-[11px] text-dim" title={detail}>{detail}</div>
      </div>
      {action && (
        <button
          onClick={() => onCommand(action.cmd)}
          className="shrink-0 cursor-pointer rounded-md border border-line px-2 py-0.5 text-[10.5px] text-faint hover:bg-hover hover:text-ink"
        >
          {action.label}
        </button>
      )}
    </div>
  );
  return (
    <PanelSection title="Computer use">
      <div className="mb-3 rounded-lg border border-line bg-raise px-3 py-2">
        {row(
          computer.browserUrl ? 'bg-ember' : 'bg-moss',
          'Browser automation',
          computer.browserUrl ? `driving ${computer.browserUrl}` : 'ready — persistent Chromium profile',
        )}
        {row(
          computer.desktop === 'connected' ? 'bg-moss' : computer.desktop === 'configured' ? 'bg-amber' : 'bg-faint',
          'Desktop control',
          computer.desktop === 'connected'
            ? `connected — ${computer.desktopTools} native tool${computer.desktopTools === 1 ? '' : 's'}`
            : computer.desktop === 'configured'
              ? 'configured but not connected'
              : 'not installed — native app control is off',
          computer.desktop === 'not-installed' ? { label: 'Install', cmd: '/computer install-desktop' } : undefined,
        )}
        {row(
          computer.vision ? 'bg-moss' : 'bg-faint',
          'Model vision',
          computer.vision
            ? 'active model sees screenshots — visual operation available'
            : 'active model is text-only — screenshots stay on disk',
          computer.vision ? undefined : { label: 'Pick model', cmd: '/model one' },
        )}
        {/*
          No grants reported and an empty grants list are the same thing to a reader — "nothing is
          standing granted" — so both take the reassuring branch. Treating absent as unknown would
          make the row hedge about a state it can describe exactly.
        */}
        {((grants) => row(
          grants.length ? 'bg-amber' : 'bg-moss',
          `Session grants${grants.length ? ` · ${grants.length}` : ''}`,
          grants.length ? grants.join(' · ') : 'none — every domain/app asks first',
          grants.length ? { label: 'Revoke', cmd: '/computer revoke-grants' } : undefined,
        ))(computer.grants ?? [])}
        {row(
          computer.tainted ? 'bg-amber' : 'bg-moss',
          computer.tainted ? 'Context taint active' : 'Context clean',
          computer.tainted
            ? 'untrusted web/page/MCP content in context — network commands are narrowed'
            : 'no untrusted content in the conversation window',
        )}
      </div>
    </PanelSection>
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
      <CapabilityHero
        icon={<Orbit size={17} />}
        eyebrow="Teamwork"
        title={subagents.some((agent) => agent.status === 'running') ? 'Execution in motion' : 'Parallel workbench'}
        detail={subagents.some((agent) => agent.status === 'running')
          ? `${subagents.filter((agent) => agent.status === 'running').length} specialist${subagents.filter((agent) => agent.status === 'running').length === 1 ? '' : 's'} working across ${todos.length || 1} task lane${todos.length === 1 ? '' : 's'}.`
          : 'Split difficult work into visible lanes, then converge it through review and verification.'}
        metrics={[
          { label: 'Running', value: String(subagents.filter((agent) => agent.status === 'running').length) },
          { label: 'Finished', value: String(subagents.filter((agent) => agent.status === 'done').length) },
          { label: 'Goals', value: String(goalCount) },
        ]}
      />

      <PanelSection title="Launch">
        <div className="flex gap-1.5">
          <button
            onClick={() => setLauncher(launcher === 'swarm' ? null : 'swarm')}
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-xs',
              launcher === 'swarm' ? 'bg-hover text-ink' : 'bg-raise text-dim hover:bg-hover hover:text-ink',
            )}
          >
            <Users size={13} className="text-ember" /> Parallel team
          </button>
          <button
            onClick={() => setLauncher(launcher === 'beast' ? null : 'beast')}
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line py-1.5 text-xs',
              launcher === 'beast' ? 'bg-hover text-ink' : 'bg-raise text-dim hover:bg-hover hover:text-ink',
            )}
          >
            <Rocket size={13} className="text-ember" /> Full build loop
          </button>
        </div>
        {launcher === 'swarm' && (
          <LauncherForm
            placeholder="Describe the work that should be split across specialists…"
            cta="Start team"
            onLaunch={(t) => { onCommand(`/swarm ${t}`); setLauncher(null); }}
            onCancel={() => setLauncher(null)}
          />
        )}
        {launcher === 'beast' && (
          <LauncherForm
            placeholder="Describe the outcome. Bimax will build, repair, review, and save a checkpoint…"
            cta="Start build loop"
            onLaunch={(t) => { onCommand(`/beast ${t}`); setLauncher(null); }}
            onCancel={() => setLauncher(null)}
          />
        )}
        {!launcher && (
          <div className="mt-2 flex items-center gap-1 overflow-hidden rounded-md border border-line/70 bg-well px-2 py-1.5 text-[9.5px] tracking-[0.06em] text-faint uppercase">
            {['Split work', 'Build', 'Review', 'Checkpoint'].map((step, index) => (
              <React.Fragment key={step}>
                {index > 0 && <ChevronRight size={9} className="shrink-0 text-line" />}
                <span className={cn('truncate', index === 0 && 'text-ember')}>{step}</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection title={`Specialists${subagents.length ? ` · ${subagents.length}` : ''}`}>
        {subagents.length === 0 ? (
          <div className="text-xs text-faint">
            No specialists are running. Start a parallel team or a full build loop above.
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
                  <span className="ml-auto font-mono text-[10.5px] text-faint tabular-nums">{a.toolCalls} actions</span>
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
                        {a.toolCalls} action{a.toolCalls === 1 ? '' : 's'}
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
            ? <>{goalCount} active goal{goalCount === 1 ? '' : 's'} guiding the current work.</>
            : <>Long-running goals will appear here when a task needs them.</>}
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
        <ActionBtn icon={<Hammer size={13} />} label="Build code map" onClick={() => onCommand('/index force')} />
      </div>
    );
  }

  return (
    <div>
      <GraphField graph={g} />
      <PanelSection title="Graph">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Symbols" value={g.nodeCount.toLocaleString()} />
          <StatTile label="Files" value={g.fileCount.toLocaleString()} />
          <StatTile label="Index" value={g.engine === 'codebase-memory' ? 'semantic' : 'native'} />
          <StatTile label="AI layer" value={g.aiGraphBuilt ? 'built' : 'not built'} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ActionBtn icon={<Hammer size={13} />} label="Refresh map" onClick={() => onCommand('/index force')} />
          {!g.aiGraphBuilt && (
            <ActionBtn icon={<Sparkles size={13} />} label="Add semantic map" title="Uses your selected model to understand relationships" onClick={() => onCommand('/index-ai force')} />
          )}
        </div>
      </PanelSection>

      <PanelSection title="Change impact">
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
            title="Analyze what this change could affect"
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
      <div className="text-xs text-faint">Select a module above to inspect its place in the workspace.</div>
    </div>
  );
}

// --- Mind: self-model, drives, habits, epistemic ledger (live from ui_snapshot) ----------------

function MindPanel({ snapshot, onCommand }: { snapshot: UiSnapshot | null; onCommand: (cmd: string) => void }): React.ReactElement {
  const m = snapshot?.mind;
  if (!m) {
    return (
      <Placeholder icon={<BrainCircuit size={22} />} title="Mind">
        Bimax learns from completed work and shows useful patterns here.
      </Placeholder>
    );
  }
  return (
    <div>
      <MindPulse mind={m} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <ActionBtn icon={<ScanEye size={13} />} label="Learning report" title="See what Bimax has learned from this workspace" onClick={() => onCommand('/self')} />
        <ActionBtn icon={<Moon size={13} />} label="Practice" title="Let Bimax safely practice in an isolated copy" onClick={() => onCommand('/dream')} />
        <ActionBtn icon={<Film size={13} />} label="Past work" title="Browse recorded work and outcomes" onClick={() => onCommand('/episodes')} />
      </div>
      <PanelSection title="Self-model">
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Weak spots" value={String(m.weakSpots)} tint={m.weakSpots > 0 ? 'amber' : undefined} />
          <StatTile label="Drives off" value={String(m.driveDeviations)} tint={m.driveDeviations > 0 ? 'amber' : undefined} />
          <StatTile label="Habits" value={String(m.habits)} />
        </div>
      </PanelSection>

      <PanelSection title="Context memory">
        <ContextMemory snapshot={snapshot} />
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
            <StatTile
              label="Coverage"
              value={`${Math.round(m.ledger.coveragePct <= 1 ? m.ledger.coveragePct * 100 : m.ledger.coveragePct)}%`}
            />
          </div>
        </PanelSection>
      )}

      <div className="text-xs text-faint">Learning signals are based on completed work and verification, not guesses.</div>
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

function CapabilityHero({
  icon, eyebrow, title, detail, metrics,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  detail: string;
  metrics: { label: string; value: string }[];
}): React.ReactElement {
  return (
    <section className="relative mb-4 overflow-hidden rounded-xl border border-line bg-raise p-3">
      <div className="pointer-events-none absolute -top-10 -right-8 size-28 rounded-full border border-ember/10" />
      <div className="pointer-events-none absolute -top-4 right-3 size-14 rounded-full border border-ember/15" />
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-ember/20 bg-ember/10 text-ember">{icon}</div>
        <div className="min-w-0">
          <div className="text-[9.5px] font-semibold tracking-[0.1em] text-faint uppercase">{eyebrow}</div>
          <div className="mt-0.5 text-[14px] font-semibold text-ink">{title}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-dim">{detail}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 border-t border-line/70 pt-2.5">
        {metrics.map((metric) => (
          <div key={metric.label} className="border-l border-line/70 px-2 first:border-l-0 first:pl-0">
            <div className="font-mono text-[13px] text-ink tabular-nums">{metric.value}</div>
            <div className="text-[9.5px] text-faint">{metric.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GraphField({ graph }: { graph: UiSnapshot['graph'] }): React.ReactElement {
  const modules = graph.modules.slice(0, 6);
  const [selected, setSelected] = useState(0);
  const rawId = useId();
  const id = rawId.replace(/:/g, '');
  const positions = [[24, 31], [52, 23], [79, 34], [77, 62], [48, 69], [20, 60]];
  const center = [49, 47];
  const selectedModule = modules[selected] ?? modules[0];
  const symbolShare = modules.length ? Math.max(1, Math.round(graph.nodeCount / modules.length)) : graph.nodeCount;
  const satellites = useMemo(() => modules.flatMap((_, moduleIndex) => {
    const [x, y] = positions[moduleIndex];
    const offsets = moduleIndex % 2 === 0
      ? [[-8, -7], [7, -9], [10, 6]]
      : [[-9, 5], [8, -5], [-3, 10]];
    return offsets.map(([dx, dy], satelliteIndex) => ({
      moduleIndex,
      satelliteIndex,
      x: x + dx,
      y: y + dy,
    }));
  }), [modules.length]);

  return (
    <section className="graph-observatory relative mb-4 h-[270px] overflow-hidden rounded-2xl border border-line bg-well" aria-label="Interactive codebase topology">
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between px-3.5 py-3">
        <div>
          <div className="flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.15em] text-faint uppercase">
            <span className="signal-beacon size-1.5 rounded-full bg-moss" /> Live topology
          </div>
          <div className="mt-1 text-[13px] font-medium text-ink">{graph.engine === 'codebase-memory' ? 'Semantic signal field' : 'Native symbol field'}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[13px] text-ink tabular-nums">{graph.nodeCount.toLocaleString()}</div>
          <div className="text-[8.5px] tracking-[0.1em] text-faint uppercase">mapped symbols</div>
        </div>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0%" stopColor="var(--color-ember)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--color-ember)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-signal`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-ember)" stopOpacity="0.12" />
            <stop offset="50%" stopColor="var(--color-ember-bright)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--color-moss)" stopOpacity="0.14" />
          </linearGradient>
          <pattern id={`${id}-grid`} width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 8 0 L 0 0 0 8" fill="none" stroke="var(--color-line)" strokeWidth="0.25" opacity="0.42" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill={`url(#${id}-grid)`} />
        <circle cx={center[0]} cy={center[1]} r="29" fill={`url(#${id}-glow)`} />
        <circle cx={center[0]} cy={center[1]} r="22" fill="none" stroke="var(--color-line)" strokeWidth="0.35" strokeDasharray="1.5 2.5" opacity="0.7" />
        {modules.map((_, index) => {
          const [x, y] = positions[index];
          const [nextX, nextY] = positions[(index + 1) % modules.length];
          return (
            <React.Fragment key={index}>
              <line className="graph-link" x1={center[0]} y1={center[1]} x2={x} y2={y} stroke={`url(#${id}-signal)`} strokeWidth={selected === index ? '1.1' : '0.55'} strokeDasharray="2.5 1.5" />
              {modules.length > 1 && <line x1={x} y1={y} x2={nextX} y2={nextY} stroke="var(--color-line)" strokeWidth="0.4" opacity="0.8" />}
            </React.Fragment>
          );
        })}
        {satellites.map((sat) => {
          const [x, y] = positions[sat.moduleIndex];
          return (
            <g key={`${sat.moduleIndex}-${sat.satelliteIndex}`}>
              <line x1={x} y1={y} x2={sat.x} y2={sat.y} stroke="var(--color-line)" strokeWidth="0.35" opacity="0.8" />
              <circle cx={sat.x} cy={sat.y} r={selected === sat.moduleIndex ? '1.05' : '0.75'} fill={selected === sat.moduleIndex ? 'var(--color-ember-bright)' : 'var(--color-dim)'} opacity={selected === sat.moduleIndex ? '0.95' : '0.55'} />
            </g>
          );
        })}
        <circle cx={center[0]} cy={center[1]} r="3.2" fill="var(--color-well)" stroke="var(--color-ember)" strokeWidth="1" />
        <circle className="graph-core-ring" cx={center[0]} cy={center[1]} r="7" fill="none" stroke="var(--color-ember)" strokeOpacity="0.26" strokeWidth="0.7" />
        <circle cx={center[0]} cy={center[1]} r="1.15" fill="var(--color-ember-bright)" />
        {modules.map((module, index) => (
          <g key={module.name}>
            {selected === index && <circle className="graph-node-ring" cx={positions[index][0]} cy={positions[index][1]} r="5" fill="none" stroke="var(--color-ember)" strokeWidth="0.7" />}
            <circle cx={positions[index][0]} cy={positions[index][1]} r={selected === index ? '2.8' : '2.1'} fill={module.criticality === 'critical' || module.criticality === 'high' ? 'var(--color-amber)' : 'var(--color-moss)'} stroke="var(--color-well)" strokeWidth="1" />
          </g>
        ))}
      </svg>
      {modules.map((module, index) => (
        <button
          key={module.name}
          onClick={() => setSelected(index)}
          aria-pressed={selected === index}
          className={cn(
            'absolute z-10 max-w-[37%] -translate-x-1/2 cursor-pointer truncate rounded-md border px-1.5 py-0.5 font-mono text-[8.5px] backdrop-blur-sm transition-all focus-visible:outline-2 focus-visible:outline-ember',
            selected === index ? 'border-ember/35 bg-raise/95 text-ink' : 'border-transparent bg-well/65 text-faint hover:border-line hover:text-ink',
          )}
          style={{ left: `${positions[index][0]}%`, top: `${positions[index][1] + 4.5}%` }}
          title={`${module.name}${module.criticality ? ` · ${module.criticality}` : ''}`}
        >
          {module.name}
        </button>
      ))}
      <div className="absolute inset-x-3 bottom-3 z-20 flex items-center gap-3 rounded-xl border border-line/80 bg-raise/90 px-3 py-2 backdrop-blur-md">
        <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-ember/25 bg-well">
          <span className="size-2 rounded-full bg-ember" />
          <span className="graph-core-ring absolute inset-1 rounded-full border border-ember/20" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[10.5px] text-ink">{selectedModule?.name ?? 'workspace core'}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[9px] text-faint">
            <span>~{symbolShare.toLocaleString()} symbols</span>
            <span className="size-0.5 rounded-full bg-faint" />
            <span>{selectedModule?.criticality ?? 'mapped'} signal</span>
          </div>
        </div>
        <div className="flex items-end gap-0.5" aria-hidden>
          {[6, 11, 8, 15, 10, 17, 7].map((height, index) => <span key={index} className="w-0.5 rounded-full bg-ember/60" style={{ height }} />)}
        </div>
      </div>
    </section>
  );
}

function MindPulse({ mind }: { mind: UiSnapshot['mind'] }): React.ReactElement {
  const total = mind.weakSpots + mind.driveDeviations + mind.habits;
  const healthy = Math.max(0, mind.habits + ((mind.drives?.length ?? 0) - mind.driveDeviations));
  return (
    <section className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-raise p-3">
      <div className="relative flex size-16 shrink-0 items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-ember/25" />
        <div className="absolute inset-2 rounded-full border border-moss/25" />
        <div className="absolute inset-4 rounded-full border border-dashed border-faint/40" />
        <BrainCircuit size={19} className="text-ember" />
        <span className="absolute top-0 right-1 size-2 rounded-full bg-moss shadow-[0_0_0_3px_rgba(156,179,128,0.12)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9.5px] font-semibold tracking-[0.1em] text-faint uppercase">Adaptive mind</div>
        <div className="mt-0.5 text-[14px] font-semibold text-ink">Learning from this workspace</div>
        <div className="mt-1 text-[11px] leading-relaxed text-dim">
          {total > 0 ? `${healthy} healthy signals · ${mind.weakSpots + mind.driveDeviations} need attention.` : 'Signals appear as Bimax observes work, outcomes, and verification.'}
        </div>
      </div>
    </section>
  );
}

function ContextMemory({ snapshot }: { snapshot: UiSnapshot | null }): React.ReactElement {
  const windowTokens = snapshot?.contextWindow ?? 0;
  const baseline = snapshot?.tokensBaseline ?? 0;
  const saved = snapshot?.compressionSaved ?? 0;
  const pct = windowTokens > 0 ? Math.min(100, Math.round((baseline / windowTokens) * 100)) : 0;
  return (
    <div className="rounded-lg border border-line bg-well p-2.5">
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="flex items-center gap-1.5 text-dim"><Layers3 size={12} className="text-ember" /> Prompt foundation</span>
        <span className="font-mono text-ink tabular-nums">{windowTokens > 0 ? `${pct}%` : '—'}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-ember transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-faint">
        <span><strong className="font-mono font-normal text-dim">{baseline.toLocaleString()}</strong> base tokens</span>
        <span className="text-right"><strong className="font-mono font-normal text-moss">{saved.toLocaleString()}</strong> compressed away</span>
      </div>
    </div>
  );
}

function RuntimePulse({ runtime, issueCount }: { runtime: SupervisorStatus | null; issueCount: number }): React.ReactElement {
  const healthy = runtime?.phase === 'ready' || runtime?.phase === 'degraded';
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-line bg-well">
      <div className="flex items-center gap-3 p-3">
        <div className="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-raise">
          <Activity size={17} className={healthy ? 'text-moss' : 'text-amber'} />
          <span className={cn('absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-well', healthy ? 'bg-moss' : runtime ? 'bg-amber' : 'bg-faint')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-ink">{healthy ? 'Everything looks good' : 'Bimax needs attention'}</span>
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-dim">
            {issueCount ? `${issueCount} recorded issue${issueCount === 1 ? '' : 's'}` : 'No recent problems'}
          </div>
        </div>
        <ShieldCheck size={16} className={healthy ? 'text-moss' : 'text-faint'} />
      </div>
      <div className="border-t border-line/70 bg-raise/35 px-3 py-1.5 text-[9.5px] text-faint">Support information stays out of your task history.</div>
    </section>
  );
}
