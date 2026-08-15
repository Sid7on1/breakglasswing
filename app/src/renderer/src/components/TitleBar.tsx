import React from 'react';
import {
  PanelLeft, PanelRight, FolderOpen, GitBranch, Palette, Sun, Moon, Monitor, ShieldCheck,
} from 'lucide-react';
import { cn } from '../lib/cn';
import type { GitStatusResult } from '../global';
import { BrandMark } from './BrandMark';
import { Dropdown, DropdownItem } from './ui/dropdown';
import { APPEARANCES, Appearance } from '../appearance';

/**
 * Standard hidden-inset title bar: project identity, repository state, and the two pane toggles.
 *
 * The task's own state moved to `TaskHeader` — `examples/CURRENT_BIMAX_UI.md` recorded the defect
 * of a verification badge living up here, far from the evidence it referred to. What remains is
 * window-level: which project, which branch, and which panes are showing.
 */
export function TitleBar({
  project, protocolMismatch, gitStatus, sidebarOpen, inspectorOpen,
  onToggleSidebar, onPeekSidebar, onToggleInspector, onOpenChanges, onOpenTrust, appearance, onAppearance,
}: {
  project: string;
  protocolMismatch: number | null;
  gitStatus: GitStatusResult | null;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  onToggleSidebar: () => void;
  /** Hover intent: reveal the panel transiently, without pinning it. */
  onPeekSidebar?: () => void;
  onToggleInspector: () => void;
  onOpenChanges: () => void;
  onOpenTrust: () => void;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => void;
}): React.ReactElement {
  const projectName = project ? project.split('/').filter(Boolean).pop() : '';
  const insertions = gitStatus?.files.reduce((total, file) => total + file.insertions, 0) ?? 0;
  const deletions = gitStatus?.files.reduce((total, file) => total + file.deletions, 0) ?? 0;

  return (
    <header className="titlebar-shell drag-region flex h-11 shrink-0 items-center gap-2 border-b border-line/80 pr-3 pl-[80px] select-none">
      {project && (
        <IconBtn
          title={sidebarOpen ? 'Unpin tasks (⌘B)' : 'Pin tasks open (⌘B)'}
          active={sidebarOpen}
          /*
            Hover and click are DIFFERENT actions, and conflating them was the bug: `onHover` used
            to call this same toggle, so pointing at the button latched the panel open with no way
            back — "it comes but it never goes".
              hover → peek   (transient; ends when the pointer leaves the panel)
              click → pin    (sticky; only another click releases it)
          */
          onClick={onToggleSidebar}
          onHover={onPeekSidebar}
        >
          <PanelLeft size={16} />
        </IconBtn>
      )}
      <BrandMark className="mr-1 text-[12px]" />
      <button
        title={project || 'Open a project'}
        onClick={() => void window.bimax.pickFolder()}
        className="no-drag flex max-w-[320px] cursor-pointer items-center gap-1.5 truncate rounded-lg px-2 py-1 text-dim hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
      >
        <FolderOpen size={13} />
        <span className="truncate">{projectName || 'Open Project…'}</span>
      </button>
      {gitStatus && (
        <button
          title={gitStatus.files.length
            ? `${gitStatus.files.length} changed file${gitStatus.files.length === 1 ? '' : 's'} — open Changes`
            : `On ${gitStatus.branch} — nothing changed`}
          onClick={onOpenChanges}
          className="no-drag flex max-w-[220px] cursor-pointer items-center gap-1.5 truncate rounded-lg px-2 py-1 text-xs text-dim hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
        >
          <GitBranch size={12} className="shrink-0 text-ember/80" />
          <span className="truncate">{gitStatus.branch || '(detached)'}</span>
          {gitStatus.files.length > 0 && (
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
              <span className="text-moss">+{insertions}</span> <span className="text-rust">−{deletions}</span>
            </span>
          )}
        </button>
      )}
      <span className="flex-1" />
      {protocolMismatch !== null && (
        <span className="rounded-lg border border-rust/25 bg-rust/8 px-2 py-1 text-xs text-rust">
          Bimax needs an update
        </span>
      )}
      {project && (
        <IconBtn title="Trust Center (⌘⇧T)" onClick={onOpenTrust}>
          <ShieldCheck size={15} />
        </IconBtn>
      )}
      <Dropdown
        direction="down"
        align="right"
        ariaLabel="Change appearance"
        trigger={(open) => (
          <span
            title="Change appearance"
            className={cn(
              'no-drag flex size-7 items-center justify-center rounded-lg transition-colors',
              open ? 'bg-hover text-ember' : 'text-faint hover:bg-hover hover:text-ink',
            )}
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
                icon={item.id === 'starlight' ? <Sun size={13} /> : item.id === 'moonlight' ? <Moon size={13} /> : <Monitor size={13} />}
                label={item.label}
                desc={item.description}
                onClick={() => { onAppearance(item.id); close(); }}
              />
            ))}
          </>
        )}
      </Dropdown>
      {project && (
        <IconBtn title="Show or hide evidence (⌘J)" active={inspectorOpen} onClick={onToggleInspector}>
          <PanelRight size={16} />
        </IconBtn>
      )}
    </header>
  );
}

function IconBtn({
  title, active, onClick, onHover, children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  onHover?: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      onMouseEnter={onHover}
      className={cn(
        'no-drag flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-hover focus-visible:outline-2 focus-visible:outline-ember',
        active ? 'text-ink' : 'text-faint',
      )}
    >
      {children}
    </button>
  );
}
