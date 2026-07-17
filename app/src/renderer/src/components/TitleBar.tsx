import React from 'react';
import { PanelLeft, PanelRight, FolderOpen, GitBranch, CircleCheck, CircleX, Clock3, Wrench, Palette, Sun, Moon, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';
import type { GitStatusResult } from '../global';
import type { ReviewSnapshot } from '../protocol';
import { BrandMark } from './BrandMark';
import { Dropdown, DropdownItem } from './ui/dropdown';
import { APPEARANCES, Appearance } from '../appearance';

export function TitleBar({
  project, protocolMismatch, gitStatus, review, sidebarOpen, dockOpen,
  onToggleSidebar, onToggleDock, onOpenReview, appearance, onAppearance,
}: {
  project: string;
  protocolMismatch: number | null;
  gitStatus: GitStatusResult | null;
  review: ReviewSnapshot | null;
  sidebarOpen: boolean;
  dockOpen: boolean;
  onToggleSidebar: () => void;
  onToggleDock: () => void;
  onOpenReview: () => void;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => void;
}): React.ReactElement {
  const projectName = project ? project.split('/').filter(Boolean).pop() : '';
  const ins = gitStatus?.files.reduce((n, f) => n + f.insertions, 0) ?? 0;
  const del = gitStatus?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;
  return (
    <header className="titlebar-shell drag-region flex h-11 shrink-0 items-center gap-2 border-b border-line/80 pr-3 pl-[80px] select-none">
      {project && (
        <IconBtn title="Toggle sidebar (⌘B)" active={sidebarOpen} onClick={onToggleSidebar}>
          <PanelLeft size={16} />
        </IconBtn>
      )}
      <BrandMark className="size-5 rounded-[7px]" />
      <span className="mr-1 text-[12.5px] font-semibold tracking-[-0.01em] text-ink">Bimax</span>
      <button
        title={project}
        onClick={() => void window.bimax.pickFolder()}
        className="no-drag flex max-w-[320px] cursor-pointer items-center gap-1.5 truncate rounded-lg px-2 py-1 text-dim hover:bg-hover hover:text-ink"
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
          className="no-drag flex max-w-[220px] cursor-pointer items-center gap-1.5 truncate rounded-lg px-2 py-1 text-xs text-dim hover:bg-hover hover:text-ink"
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
      {review && review.state !== 'idle' && (
        <button
          title={review.nextAction}
          onClick={onOpenReview}
          className={cn(
            'no-drag flex max-w-[230px] cursor-pointer items-center gap-1.5 truncate rounded-full border px-2.5 py-[3px] text-[11px] hover:bg-hover',
            review.state === 'verification_failed' ? 'border-rust/35 text-rust'
              : review.state === 'awaiting_approval' ? 'border-amber/35 text-amber'
                : review.state === 'verified' || review.state === 'checkpointed' ? 'border-moss/35 text-moss'
                  : 'border-line text-dim',
          )}
        >
          {review.state === 'verification_failed' ? <CircleX size={12} />
            : review.state === 'awaiting_approval' ? <Clock3 size={12} />
              : review.state === 'verified' || review.state === 'checkpointed' ? <CircleCheck size={12} />
                : <Wrench size={12} />}
          <span className="truncate">{review.state.replace(/_/g, ' ')}</span>
        </button>
      )}
      {protocolMismatch !== null && (
        <span className="rounded-lg border border-rust/25 bg-rust/8 px-2 py-1 text-xs text-rust">
          Bimax needs an update
        </span>
      )}
      <Dropdown
        direction="down"
        align="right"
        ariaLabel="Change appearance"
        trigger={(open) => (
          <span
            title="Change appearance"
            className={cn('no-drag flex size-7 items-center justify-center rounded-lg transition-colors', open ? 'bg-hover text-ember' : 'text-faint hover:bg-hover hover:text-ink')}
          >
            <Palette size={15} />
          </span>
        )}
      >
        {(close) => (
          <>
            <div className="px-2.5 pt-1.5 pb-1 text-[9.5px] font-semibold tracking-[0.1em] text-faint uppercase">Appearance</div>
            {APPEARANCES.map((item) => (
              <DropdownItem
                key={item.id}
                selected={appearance === item.id}
                icon={item.id === 'linen' ? <Sun size={13} /> : item.id === 'graphite' ? <Moon size={13} /> : <Sparkles size={13} />}
                label={item.label}
                desc={item.description}
                onClick={() => { onAppearance(item.id); close(); }}
              />
            ))}
          </>
        )}
      </Dropdown>
      {project && (
        <IconBtn title="Toggle panel (⌘J)" active={dockOpen} onClick={onToggleDock}>
          <PanelRight size={16} />
        </IconBtn>
      )}
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
