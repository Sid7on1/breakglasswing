import React from 'react';
import { SquarePen, Search, FolderGit2, MessageSquare, Plus, Settings } from 'lucide-react';
import { cn } from '../lib/cn';
import { UiSnapshot } from '../protocol';

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * Left rail: task actions, projects (multi-repo workspace from ui_snapshot), sessions (live from
 * ui_snapshot.sessions — protocol v2; hidden section content degrades to an empty state on v1
 * engines), settings at the bottom.
 */
export function Sidebar({
  project, snapshot, onNewTask, onOpenPalette, onCommand, onOpenSettings, onOpenGallery,
}: {
  project: string;
  snapshot: UiSnapshot | null;
  onNewTask: () => void;
  onOpenPalette: () => void;
  onCommand: (cmd: string) => void;
  onOpenSettings: () => void;
  onOpenGallery: () => void;
}): React.ReactElement {
  const projectName = project ? project.split('/').filter(Boolean).pop() : '';
  const workspaceNames = snapshot?.workspace.names?.length
    ? snapshot.workspace.names
    : projectName ? [projectName] : [];
  const sessions = snapshot?.sessions ?? [];

  return (
    <aside className="flex h-full flex-col border-r border-line bg-bg text-[13px]">
      <div className="flex flex-col gap-0.5 p-2">
        <RailButton icon={<SquarePen size={15} />} label="New task" onClick={onNewTask} />
        <RailButton
          icon={<Search size={15} />}
          label="Search"
          hint="⌘K"
          onClick={onOpenPalette}
        />
      </div>

      <SectionLabel>Projects</SectionLabel>
      <div className="flex flex-col gap-0.5 px-2">
        {workspaceNames.map((name, i) => (
          <div
            key={name + i}
            className="flex items-center gap-2 rounded-md bg-hover/60 px-2.5 py-1.5 text-ink"
          >
            <FolderGit2 size={15} className="shrink-0 text-ember" />
            <span className="truncate">{name}</span>
          </div>
        ))}
        <button
          onClick={() => void window.bimax.pickFolder()}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-dim hover:bg-hover hover:text-ink"
        >
          <Plus size={15} className="shrink-0" />
          <span>Open project…</span>
        </button>
      </div>

      <div className="flex items-center pr-2">
        <SectionLabel>Sessions</SectionLabel>
        <button
          onClick={onOpenGallery}
          title="Browse all sessions"
          className="mt-2.5 ml-auto cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-faint hover:bg-hover hover:text-ink"
        >
          view all
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-start gap-1 rounded-md px-2.5 py-2 text-xs text-faint">
            <MessageSquare size={15} />
            <span>Past sessions appear here as you work. The current session lives in the transcript.</span>
          </div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              disabled={s.current}
              onClick={() => onCommand(`/resume ${s.id}`)}
              title={s.current
                ? 'Current session'
                : `Resume: inject this session's messages into the current context (${s.messageCount} msgs)`}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left',
                s.current ? 'cursor-default bg-hover/60' : 'cursor-pointer hover:bg-hover',
              )}
            >
              <span className={cn('w-full truncate text-xs', s.current ? 'text-ink' : 'text-dim')}>
                {s.title === '(no messages yet)' ? 'Untitled session' : s.title}
              </span>
              <span className="flex w-full items-baseline gap-1.5 text-[10.5px] text-faint tabular-nums">
                {s.current ? <span className="text-ember">current</span> : relTime(s.startedAt)}
                {s.messageCount > 0 && <span>· {s.messageCount} msgs</span>}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-faint">
        <span className="truncate">{snapshot?.models.coding || ''}</span>
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-hover hover:text-ink"
        >
          <Settings size={14} />
        </button>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="px-4 pt-4 pb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">
      {children}
    </div>
  );
}

function RailButton({
  icon, label, hint, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-dim hover:bg-hover hover:text-ink"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint ? <kbd className="rounded border border-line bg-raise px-1 text-[10px] text-faint">{hint}</kbd> : null}
    </button>
  );
}
