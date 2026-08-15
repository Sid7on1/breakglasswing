import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * Minimal anchored popover for composer selectors — opens above the trigger, closes on
 * outside click / Esc. Deliberately tiny (no positioning lib): composer controls always sit at
 * the bottom of the window, so "open upward" is the only case.
 */
export function Dropdown({
  trigger, children, align = 'left', direction = 'up', ariaLabel,
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  direction?: 'up' | 'down'; // 'down' for triggers at the top of a panel (Review branch switcher)
  ariaLabel?: string;
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
      {/* Without an explicit ring the trigger falls back to the UA's own accent outline, which is
          the one focus indicator in the app that ignores the theme. */}
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ember"
      >
        {trigger(open)}
      </button>
      {open && (
        <div
          className={cn(
            'anim-pop-in absolute z-30 min-w-56 rounded-[12px] p-1.5',
            'liquid-glass liquid-glass-pop',
            direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            align === 'left' ? 'left-0' : 'right-0',
          )}
          /*
            A popover is adjacent to its trigger, so it does not need a measured flight: growing
            from the anchored corner already reads as "this came out of that button", and it costs
            a transform-origin instead of a rect. The corner is the one nearest the trigger, which
            is the opposite of wherever the popover is placed relative to it.
          */
          style={{
            transformOrigin: `${align === 'left' ? 'left' : 'right'} ${direction === 'up' ? 'bottom' : 'top'}`,
          }}
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
