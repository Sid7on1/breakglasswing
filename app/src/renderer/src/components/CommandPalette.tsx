import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, FolderOpen, GitCompareArrows, Files, SquareTerminal, Users, Map,
  BrainCircuit, LifeBuoy, Settings, SquarePen,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { DockTab } from './Dock';
import { cn } from '../lib/cn';

interface PaletteAction {
  id: string;
  label: string;
  group: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({
  open, onClose, onOpenTab, onOpenSettings, onNewTask,
}: {
  open: boolean;
  onClose: () => void;
  onOpenTab: (t: DockTab) => void;
  onOpenSettings: () => void;
  onNewTask: () => void;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo<PaletteAction[]>(() => [
    { id: 'new', label: 'Start a new task', group: 'Task', icon: <SquarePen size={14} />, run: onNewTask },
    { id: 'project', label: 'Open another project', group: 'Project', icon: <FolderOpen size={14} />, run: () => { void window.bimax.pickFolder(); } },
    { id: 'review', label: 'Review changes', group: 'Workspace', icon: <GitCompareArrows size={14} />, run: () => onOpenTab('review') },
    { id: 'files', label: 'Browse files', group: 'Workspace', icon: <Files size={14} />, run: () => onOpenTab('files') },
    { id: 'terminal', label: 'Open terminal', group: 'Workspace', icon: <SquareTerminal size={14} />, run: () => onOpenTab('terminal') },
    { id: 'agents', label: 'View agent team', group: 'Intelligence', icon: <Users size={14} />, run: () => onOpenTab('agents') },
    { id: 'map', label: 'Explore code map', group: 'Intelligence', icon: <Map size={14} />, run: () => onOpenTab('map') },
    { id: 'mind', label: 'Open memory', group: 'Intelligence', icon: <BrainCircuit size={14} />, run: () => onOpenTab('mind') },
    { id: 'support', label: 'Help and app status', group: 'App', icon: <LifeBuoy size={14} />, run: () => onOpenTab('health') },
    { id: 'settings', label: 'Open settings', group: 'App', icon: <Settings size={14} />, run: onOpenSettings },
  ], [onNewTask, onOpenSettings, onOpenTab]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? actions.filter((action) => `${action.label} ${action.group}`.toLowerCase().includes(needle)) : actions;
  }, [actions, query]);

  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const id = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [open]);

  const execute = (action: PaletteAction | undefined): void => {
    if (!action) return;
    action.run();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="top-[18%] max-h-[64vh] w-[min(560px,calc(100vw-64px))] -translate-y-0 p-0">
        <DialogTitle className="sr-only">Search and open</DialogTitle>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search Bimax…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, filtered.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
              if (event.key === 'Enter') { event.preventDefault(); execute(filtered[selected]); }
            }}
            className="flex-1 border-none bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <kbd className="rounded-md border border-line bg-well px-1.5 py-0.5 text-[9px] text-faint">esc</kbd>
        </div>
        <div className="max-h-[48vh] overflow-y-auto p-2">
          {filtered.map((action, index) => (
            <button
              key={action.id}
              onMouseEnter={() => setSelected(index)}
              onClick={() => execute(action)}
              className={cn('flex w-full cursor-pointer items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-[12.5px]', selected === index ? 'bg-selected text-ink' : 'text-dim')}
            >
              <span className={cn('text-faint', selected === index && 'text-ember')}>{action.icon}</span>
              <span className="flex-1">{action.label}</span>
              <span className="text-[10px] text-faint">{action.group}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="px-3 py-8 text-center text-xs text-faint">No matching actions.</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
