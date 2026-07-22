import { appNamesMatch } from './desktop.runtime';

/** The application window a computer-use session is currently operating on. */
export interface ComputerTarget { app: string; pid: number; windowId?: number }

/**
 * Target ownership for computer use — the single authority on WHICH app/window an action goes to.
 *
 * Rules (moved verbatim from the runtime so they live behind one explicit interface):
 *   - Once open() establishes a target, that identity is runtime-owned until quit/open changes it.
 *     Models routinely repeat pids/window ids from older observations; trusting those ahead of the
 *     owned target sent input to stale windows.
 *   - A different app must be opened explicitly (mismatch → hard error), so the governor and the
 *     runtime always agree on the input recipient.
 *   - `windows` remains a read-only escape hatch for inspecting another explicit pid.
 */
export class TargetOwnership {
  private target: ComputerTarget | null = null;

  /** The owned target, or null when no app has been opened. */
  current(): ComputerTarget | null { return this.target ? { ...this.target } : null; }

  /** open() establishes (or replaces) the owned target. */
  set(target: ComputerTarget): void { this.target = { ...target }; }

  /** quit_app / dispose: the session no longer owns a target. */
  clear(): void { this.target = null; }

  /** Refresh the owned target's window id (window closed/replaced, post-action reacquire). */
  retargetWindow(pid: number, windowId?: number): void {
    if (this.target?.pid === pid) this.target = { ...this.target, windowId };
  }

  /** Is `pid` the currently owned process? */
  owns(pid: number): boolean { return this.target?.pid === pid; }

  /**
   * Resolve the target an action should be delivered to. Returns null when nothing is owned and
   * the command names no pid (callers then fall back / refuse per-action).
   */
  resolveFor(cmd: { action: string; app?: string; pid?: number; windowId?: number }): ComputerTarget | null {
    if (this.target && cmd.action !== 'open') {
      if (cmd.action === 'windows' && cmd.pid && Number(cmd.pid) !== this.target.pid) {
        return { app: cmd.app?.trim() || '', pid: Number(cmd.pid), windowId: Number(cmd.windowId || 0) || undefined };
      }
      if (cmd.app?.trim() && !appNamesMatch(cmd.app, this.target.app)) {
        throw new Error(`target app mismatch: ${this.target.app} is active; open ${cmd.app.trim()} before controlling it`);
      }
      return { ...this.target };
    }
    const pid = Number(cmd.pid || 0);
    if (!pid) return null;
    return {
      app: cmd.app?.trim() || '',
      pid,
      windowId: Number(cmd.windowId || 0) || undefined,
    };
  }
}
