import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, SlashSquare, FolderOpen, PanelRight, CornerDownLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { CompletionItem } from '../protocol';
import { DockTab } from './Dock';
import { cn } from '../lib/cn';

interface PaletteAction {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  run: () => void;
}

/**
 * ⌘K palette — the discoverability layer over all engine slash commands (live completions via
 * the query protocol) plus app actions (panel jumps, open project). Typing text that starts
 * with "/" queries the engine registry; Enter executes the selection.
 */
export function CommandPalette({
  open, completions, onClose, onQuery, onExec, onOpenTab,
}: {
  open: boolean;
  completions: CompletionItem[];
  onClose: () => void;
  onQuery: (text: string) => void;
  onExec: (command: string) => void;
  onOpenTab: (t: DockTab) => void;
}): React.ReactElement {
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const appActions: PaletteAction[] = useMemo(() => {
    const tabs: { t: DockTab; label: string }[] = [
      { t: 'review', label: 'Open Review panel' },
      { t: 'files', label: 'Open Files panel' },
      { t: 'terminal', label: 'Open Terminal panel' },
      { t: 'agents', label: 'Open Agents panel' },
      { t: 'map', label: 'Open Map panel' },
      { t: 'mind', label: 'Open Mind panel' },
    ];
    return [
      {
        id: 'open-project',
        label: 'Open project…',
        desc: 'Switch the engine to another folder',
        icon: <FolderOpen size={14} />,
        run: () => { void window.bimax.pickFolder(); },
      },
      ...tabs.map((x) => ({
        id: `tab-${x.t}`,
        label: x.label,
        desc: 'Panel',
        icon: <PanelRight size={14} />,
        run: () => onOpenTab(x.t),
      })),
    ];
  }, [onOpenTab]);

  const filteredActions = useMemo(() => {
    if (text.startsWith('/')) return [];
    const q = text.toLowerCase();
    return appActions.filter((a) => a.label.toLowerCase().includes(q));
  }, [appActions, text]);

  // Engine completions only make sense for slash input; default view shows "/" catalog.
  const engineItems = useMemo(
    () => (text.startsWith('/') || text === '' ? completions : []),
    [completions, text],
  );

  const total = filteredActions.length + engineItems.length;

  useEffect(() => { setSel(0); }, [text, completions]);

  useEffect(() => {
    if (!open) return;
    setText('');
    onQuery('/'); // preload the command catalog
    const id = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const change = (v: string): void => {
    setText(v);
    clearTimeout(debounceRef.current);
    const q = v === '' ? '/' : v;
    if (q.startsWith('/')) debounceRef.current = setTimeout(() => onQuery(q), 100);
  };

  const execute = (): void => {
    if (sel < filteredActions.length) {
      filteredActions[sel].run();
      onClose();
      return;
    }
    const item = engineItems[sel - filteredActions.length];
    if (item) {
      if (item.disabled) return;
      // Keep any args the user already typed after the command token.
      const typedArgs = text.startsWith(item.value) ? text.slice(item.value.length) : '';
      onExec(item.value + typedArgs);
      onClose();
      return;
    }
    if (text.startsWith('/')) {
      onExec(text);
      onClose();
    }
  };

  const keyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, Math.max(total - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); execute(); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="top-[20%] max-h-[60vh] w-[min(560px,calc(100vw-64px))] -translate-y-0 p-0"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={text}
            placeholder="Type a command… ( / for engine commands )"
            onChange={(e) => change(e.target.value)}
            onKeyDown={keyDown}
            className="flex-1 border-none bg-transparent text-[13.5px] outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-line bg-raise px-1.5 py-0.5 text-[10px] text-faint">esc</kbd>
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {filteredActions.map((a, i) => (
            <Row key={a.id} selected={sel === i} onHover={() => setSel(i)} onClick={() => { a.run(); onClose(); }}>
              <span className="w-4 shrink-0 text-ember">{a.icon}</span>
              <span>{a.label}</span>
              <span className="ml-auto truncate pl-3 text-faint">{a.desc}</span>
            </Row>
          ))}
          {engineItems.map((c, i) => {
            const idx = filteredActions.length + i;
            return (
              <Row
                key={c.value + i}
                selected={sel === idx}
                disabled={c.disabled}
                onHover={() => setSel(idx)}
                onClick={() => { setSel(idx); execute(); }}
              >
                <span className="w-4 shrink-0 text-ember"><SlashSquare size={14} /></span>
                <span className="font-mono">{c.label}</span>
                <span className="ml-auto truncate pl-3 text-faint">{c.disabled ? c.disabledReason || c.desc : c.desc}</span>
              </Row>
            );
          })}
          {total === 0 && (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-faint">
              <CornerDownLeft size={13} />
              {text.startsWith('/') ? 'Press Enter to send it to the engine as-is.' : 'No matches.'}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  selected, disabled, onHover, onClick, children,
}: {
  selected: boolean;
  disabled?: boolean;
  onHover: () => void;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      onMouseEnter={onHover}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px]',
        selected && 'bg-ember/15',
        disabled && 'opacity-40',
      )}
    >
      {children}
    </button>
  );
}
