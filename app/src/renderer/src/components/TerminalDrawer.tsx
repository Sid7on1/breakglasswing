import React, { useEffect, useRef, useState } from 'react';
import { X, SquareTerminal } from 'lucide-react';
import { TerminalPanel } from './TerminalPanel';

/**
 * The project shell, on request.
 *
 * `04_FRONTEND_PLAN.md` demotes Terminal from a peer destination; the Phase 5 brief puts it at the
 * "bottom/overlay… when requested, not permanent chrome". The pty itself is unchanged — it lives in
 * the main process and `TerminalPanel` keeps its xterm instance in module scope, so opening and
 * closing this drawer never restarts a shell or loses scrollback.
 */
export function TerminalDrawer({
  open, project, onClose,
}: {
  open: boolean;
  project: string;
  onClose: () => void;
}): React.ReactElement | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  /**
   * Mount the shell only once the user has actually asked for it.
   *
   * The old right-dock kept `TerminalPanel` mounted behind a `hidden` class, which meant every
   * project opened a pty and an xterm instance whether or not anyone wanted a terminal — permanent
   * chrome with a process attached. Once opened it stays mounted, because `TerminalPanel` keeps its
   * xterm in module scope and closing the drawer must not lose the shell or its scrollback.
   */
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => { if (open) setEverOpened(true); }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Escape must not reach the terminal itself — a shell owns Escape.
        const target = event.target as HTMLElement | null;
        if (target?.closest('.xterm')) return;
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!project || !everOpened) return null;

  return (
    <section
      aria-label="Project terminal"
      aria-hidden={!open}
      className={open ? 'anim-fade-up flex h-[38%] min-h-[180px] shrink-0 flex-col border-t border-line bg-well' : 'hidden'}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <SquareTerminal size={13} className="text-ember" />
        <span className="text-[11.5px] font-medium text-ink">Terminal</span>
        <span className="text-[10.5px] text-faint">this project’s shell</span>
        <span className="flex-1" />
        <kbd className="font-mono text-[9px] text-faint">⌘T</kbd>
        <button
          ref={closeRef}
          onClick={onClose}
          title="Close the terminal (⌘T)"
          aria-label="Close the terminal"
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ember"
        >
          <X size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 p-2">
        <TerminalPanel project={project} visible={open} />
      </div>
    </section>
  );
}
