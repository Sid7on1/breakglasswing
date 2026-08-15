import React from 'react';
import {
  SquarePen, Search, FolderOpen, MessageSquare, Plus, Settings, GitBranch,
  ChevronRight, GitCompareArrows, Files, SquareTerminal, Users, Map, BrainCircuit,
  LifeBuoy,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { UiSnapshot } from '../protocol';
import type { DockTab } from './Dock';
import { BrandMark } from './BrandMark';

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 90) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const TOOLS: { id: DockTab; label: string; icon: React.ReactNode }[] = [
  { id: 'review', label: 'Review changes', icon: <GitCompareArrows size={14} /> },
  { id: 'files', label: 'Files', icon: <Files size={14} /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={14} /> },
  { id: 'agents', label: 'Agent team', icon: <Users size={14} /> },
  { id: 'map', label: 'Code map', icon: <Map size={14} /> },
  { id: 'mind', label: 'Memory', icon: <BrainCircuit size={14} /> },
];

export function Sidebar({
  project, snapshot, onNewTask, onOpenPalette, onResume, onOpenSettings, onOpenGallery,
  activeTool, onOpenTool, changedFiles, runningAgents,
}: {
  project: string;
  snapshot: UiSnapshot | null;
  onNewTask: () => void;
  onOpenPalette: () => void;
  onResume: (id: string) => void;
  onOpenSettings: () => void;
  onOpenGallery: () => void;
  activeTool: DockTab | null;
  onOpenTool: (tool: DockTab) => void;
  changedFiles: number;
  runningAgents: number;
}): React.ReactElement {
  const projectName = project.split('/').filter(Boolean).pop() || 'Project';
  const sessions = snapshot?.sessions ?? [];
  const branch = snapshot?.git?.branch ?? '';

  return (
    <aside className="sidebar-shell glass-lens flex h-full flex-col text-[13px]">
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <BrandMark className="size-7 rounded-[8px]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-ink">{projectName}</div>
            {branch && <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-[9.5px] text-faint"><GitBranch size={9} /> {branch}</div>}
          </div>
          <button onClick={() => void window.bimax.pickFolder()} title="Open another project" className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-hover hover:text-ink">
            <FolderOpen size={14} />
          </button>
        </div>

        <button onClick={onNewTask} className="sidebar-primary mt-2 flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-ember">
          <SquarePen size={14} /> New task
        </button>
        <button onClick={onOpenPalette} className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-[9px] px-3 py-2 text-dim hover:bg-hover hover:text-ink">
          <Search size={13} /> Search and open
          <kbd className="ml-auto font-mono text-[9px] text-faint">⌘K</kbd>
        </button>
      </div>

      <div className="px-2.5 pb-2">
        <div className="px-2 pt-2 pb-1 text-[9px] font-semibold tracking-[0.13em] text-faint uppercase">Workspace</div>
        {TOOLS.map((tool) => {
          const badge = tool.id === 'review' ? changedFiles : tool.id === 'agents' ? runningAgents : 0;
          return (
            <button
              key={tool.id}
              onClick={() => onOpenTool(tool.id)}
              className={cn(
                'group flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-left text-[12px] transition-colors',
                activeTool === tool.id ? 'bg-selected text-ink' : 'text-dim hover:bg-hover hover:text-ink',
              )}
            >
              <span className={cn('text-faint group-hover:text-ink', activeTool === tool.id && 'text-ember')}>{tool.icon}</span>
              <span className="min-w-0 flex-1 truncate">{tool.label}</span>
              {badge > 0 && <span className="min-w-5 rounded-full bg-ember/14 px-1.5 text-center font-mono text-[9px] leading-5 text-ember">{badge}</span>}
            </button>
          );
        })}
      </div>

      <div className="mx-3 h-px bg-line/75" />
      <div className="flex items-center px-3.5 pt-3 pb-1.5">
        <span className="flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.13em] text-faint uppercase"><MessageSquare size={10} /> Recent</span>
        <button onClick={onOpenGallery} title="Browse all sessions" className="ml-auto flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-[9.5px] text-faint hover:bg-hover hover:text-ink">All <ChevronRight size={10} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {sessions.length === 0 ? (
          <div className="px-2 py-2 text-[11px] leading-relaxed text-faint">Your conversations will appear here.</div>
        ) : sessions.slice(0, 14).map((session) => (
          <button
            key={session.id}
            disabled={session.current}
            onClick={() => onResume(session.id)}
            className={cn(
              'group mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left',
              session.current ? 'bg-selected text-ink' : 'text-dim hover:bg-hover hover:text-ink',
            )}
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', session.current ? 'bg-ember' : 'bg-transparent group-hover:bg-faint')} />
            <span className="min-w-0 flex-1 truncate text-[11.5px]">{session.title === '(no messages yet)' ? 'Untitled task' : session.title}</span>
            {!session.current && <span className="font-mono text-[9px] text-faint">{relTime(session.startedAt)}</span>}
          </button>
        ))}
      </div>

      <div className="border-t border-line/70 p-2.5">
        <div className="flex items-center gap-1">
          <button onClick={() => void window.bimax.pickFolder()} className="flex flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-faint hover:bg-hover hover:text-ink"><Plus size={12} /> Open project</button>
          <button onClick={() => onOpenTool('health')} title="Help and app status" className={cn('flex size-7 cursor-pointer items-center justify-center rounded-lg hover:bg-hover', activeTool === 'health' ? 'text-ember' : 'text-faint hover:text-ink')}><LifeBuoy size={14} /></button>
          <button onClick={onOpenSettings} title="Settings" className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-hover hover:text-ink"><Settings size={14} /></button>
        </div>
      </div>
    </aside>
  );
}
