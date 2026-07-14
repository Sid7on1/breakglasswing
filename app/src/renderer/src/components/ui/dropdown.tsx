import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * Minimal anchored popover for composer selectors — opens above the trigger, closes on
 * outside click / Esc. Deliberately tiny (no positioning lib): composer controls always sit at
 * the bottom of the window, so "open upward" is the only case.
 */
export function Dropdown({
  trigger, children, align = 'left', direction = 'up',
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  direction?: 'up' | 'down'; // 'down' for triggers at the top of a panel (Review branch switcher)
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="cursor-pointer">
        {trigger(open)}
      </button>
      {open && (
        <div
          className={cn(
            'absolute z-30 min-w-56 rounded-[10px] border border-line bg-raise p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)]',
            direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            align === 'left' ? 'left-0' : 'right-0',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  selected, onClick, label, desc, icon,
}: {
  selected?: boolean;
  onClick: () => void;
  label: string;
  desc?: string;
  icon?: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px]',
        selected ? 'bg-ember/15 text-ink' : 'text-dim hover:bg-hover hover:text-ink',
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0 text-ember">{icon}</span> : null}
      <span className="min-w-0">
        <span className="block">{label}</span>
        {desc ? <span className="block text-[11px] text-faint">{desc}</span> : null}
      </span>
    </button>
  );
}
