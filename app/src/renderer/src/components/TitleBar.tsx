import React from 'react';
import { PanelLeft, PanelRight, FolderOpen, GitBranch } from 'lucide-react';
import { cn } from '../lib/cn';
import { PROTOCOL_VERSION } from '../protocol';
import type { GitStatusResult } from '../global';

export function TitleBar({
  project, engineState, protocolMismatch, gitStatus, sidebarOpen, dockOpen,
  onToggleSidebar, onToggleDock, onOpenReview,
}: {
  project: string;
  engineState: string;
  protocolMismatch: number | null;
  gitStatus: GitStatusResult | null;
  sidebarOpen: boolean;
  dockOpen: boolean;
  onToggleSidebar: () => void;
  onToggleDock: () => void;
  onOpenReview: () => void;
}): React.ReactElement {
  const projectName = project ? project.split('/').filter(Boolean).pop() : '';
  const ins = gitStatus?.files.reduce((n, f) => n + f.insertions, 0) ?? 0;
  const del = gitStatus?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;
  return (
    <header className="drag-region flex h-11 shrink-0 items-center gap-2 border-b border-line pr-3 pl-[84px] select-none">
      <IconBtn title="Toggle sidebar (⌘B)" active={sidebarOpen} onClick={onToggleSidebar}>
        <PanelLeft size={16} />
      </IconBtn>
      <span className="text-sm font-semibold tracking-wide">
        bi<span className="text-ember">max</span>
      </span>
      <button
        title={project}
        onClick={() => void window.bimax.pickFolder()}
        className="no-drag flex max-w-[320px] cursor-pointer items-center gap-1.5 truncate rounded-full border border-line bg-raise px-3 py-[3px] text-dim hover:bg-hover hover:text-ink"
      >
        <FolderOpen size={13} />
        <span className="truncate">{projectName || 'Open Project…'}</span>
      </button>
      {gitStatus && (
        <button
          title={gitStatus.files.length
            ? `${gitStatus.files.length} changed file${gitStatus.files.length === 1 ? '' : 's'} — open Review`
            : `On ${gitStatus.branch} — working tree clean`}
          onClick={onOpenReview}
          className="no-drag flex max-w-[220px] cursor-pointer items-center gap-1.5 truncate rounded-full border border-line bg-raise px-2.5 py-[3px] text-xs text-dim hover:bg-hover hover:text-ink"
        >
          <GitBranch size={12} className="shrink-0 text-ember/80" />
          <span className="truncate">{gitStatus.branch || '(detached)'}</span>
          {gitStatus.files.length > 0 && (
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
              <span className="text-moss">+{ins}</span> <span className="text-rust">−{del}</span>
            </span>
          )}
        </button>
      )}
      <span className="flex-1" />
      {engineState === 'starting' && <span className="text-xs text-dim">engine starting…</span>}
      {protocolMismatch !== null && (
        <span className="text-xs text-rust">
          protocol v{protocolMismatch} ≠ app v{PROTOCOL_VERSION} — rebuild the engine
        </span>
      )}
      <IconBtn title="Toggle panel (⌘J)" active={dockOpen} onClick={onToggleDock}>
        <PanelRight size={16} />
      </IconBtn>
    </header>
  );
}

function IconBtn({
  title, active, onClick, children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'no-drag flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-hover',
        active ? 'text-ink' : 'text-faint',
      )}
    >
      {children}
    </button>
  );
}
