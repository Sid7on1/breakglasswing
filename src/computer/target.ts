import { appNamesMatch } from './desktop.runtime';

/** The application window a computer-use session is currently operating on. */
export interface ComputerTarget { app: string; pid: number; windowId?: number }

/**
 * Target ownership for computer use — the single authority on WHICH app/window an action goes to.
 *
 * A session knows about SEVERAL apps at once (send a file from a file manager to a chat app, copy
 * from one app and paste into another), but exactly ONE of them is active at any moment. That
 * distinction is the whole point of this class:
 *
 *   - Every app the session has opened stays REGISTERED, so switching back to one is a cheap focus
 *     rather than a re-launch. Re-launching an already-running app risks a second instance and
 *     throws away the app's current state.
 *   - Only the ACTIVE target receives input. Models routinely repeat pids and window ids from older
 *     observations; trusting those ahead of the active target sent input to stale windows.
 *   - Naming a different app on an acting verb is still refused, because coordinates and element
 *     handles are grounded in the ACTIVE app's most recent frame — delivering them to another app
 *     would land the previous window's geometry on an unrelated surface. The refusal now names the
 *     exact recovery verb: `focus` for an app already registered, `open` for one that is not.
 *   - `windows` remains a read-only escape hatch for inspecting another explicit pid.
 */
export class TargetOwnership {
  /** Every app this session has opened, keyed by pid. Registration outlives activation. */
  private known = new Map<number, ComputerTarget>();
  private activePid: number | null = null;

  /** The active target — the only one input may be delivered to — or null when none is active. */
  current(): ComputerTarget | null {
    const target = this.activePid == null ? undefined : this.known.get(this.activePid);
    return target ? { ...target } : null;
  }

  /** open()/focus: register this target and make it the active one. */
  set(target: ComputerTarget): void {
    this.known.set(target.pid, { ...target });
    this.activePid = target.pid;
  }

  /** dispose: the session no longer owns or remembers any target. */
  clear(): void { this.known.clear(); this.activePid = null; }

  /** quit_app / a window that closed for good: drop this app from the session entirely. */
  forget(pid: number): void {
    this.known.delete(pid);
    if (this.activePid === pid) this.activePid = null;
  }

  /** Refresh a known target's window id (window closed/replaced, post-action reacquire). */
  retargetWindow(pid: number, windowId?: number): void {
    const target = this.known.get(pid);
    if (target) this.known.set(pid, { ...target, windowId });
  }

  /** Is `pid` the currently ACTIVE process? */
  owns(pid: number): boolean { return this.activePid === pid; }

  /** Every app registered this session, active one first — for error messages and session state. */
  all(): ComputerTarget[] {
    const active = this.current();
    const rest = Array.from(this.known.values())
      .filter(t => t.pid !== this.activePid)
      .map(t => ({ ...t }));
    return active ? [active, ...rest] : rest;
  }

  /** Look up an already-registered app by name, so switching to it need not re-launch it. */
  find(app: string): ComputerTarget | null {
    const wanted = app.trim();
    if (!wanted) return null;
    for (const target of this.known.values()) {
      if (target.app && appNamesMatch(wanted, target.app)) return { ...target };
    }
    return null;
  }

  /** Make an already-registered app active. Returns false when it was never registered. */
  activate(pid: number): boolean {
    if (!this.known.has(pid)) return false;
    this.activePid = pid;
    return true;
  }

  /**
   * Stop treating any app as active, WITHOUT forgetting the ones this session opened.
   *
   * Used when the screen changes underneath us — switching Spaces can leave the previously active
   * window on a Space that is no longer visible, where a capture returns an empty frame that reads
   * as "the app broke". Dropping activation forces an explicit focus (and a fresh frame) before any
   * further input, while keeping every registration so that focus does not have to re-launch.
   */
  deactivate(): void { this.activePid = null; }

  /**
   * Resolve the target an action should be delivered to. Returns null when nothing is active and
   * the command names no pid (callers then fall back / refuse per-action).
   */
  resolveFor(cmd: { action: string; app?: string; pid?: number; windowId?: number }): ComputerTarget | null {
    const active = this.current();
    if (active && cmd.action !== 'open' && cmd.action !== 'focus') {
      if (cmd.action === 'windows' && cmd.pid && Number(cmd.pid) !== active.pid) {
        return { app: cmd.app?.trim() || '', pid: Number(cmd.pid), windowId: Number(cmd.windowId || 0) || undefined };
      }
      const named = cmd.app?.trim();
      if (named && !appNamesMatch(named, active.app)) {
        // Registered but not active: the app is right there, it just is not the surface the newest
        // frame describes. Point at focus, which switches AND returns a fresh frame, rather than at
        // open, which would re-launch an app that is already running.
        const registered = this.find(named);
        throw new Error(registered
          ? `target app mismatch: ${active.app} is active. ${registered.app} is already open in this session — use action=focus with app="${registered.app}" to switch to it (that returns a fresh frame), then act.`
          : `target app mismatch: ${active.app} is active; open ${named} before controlling it`);
      }
      return { ...active };
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
