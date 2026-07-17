import { useCallback, useEffect, useState } from 'react';
import type { SupervisorStatus, RecoveryActionName } from './global';

/**
 * Renderer view of the Engine Supervisor: the typed lifecycle status pushed from main, plus the
 * validated recovery actions. Purely a projection — all policy (backoff, budgets, generation
 * guards) lives in the main process; the renderer can only ask, never execute.
 */
export function useSupervisor() {
  const [status, setStatus] = useState<SupervisorStatus | null>(null);

  useEffect(() => {
    const off = window.bimax.supervisor.onStatus(setStatus);
    void window.bimax.supervisor.getStatus().then((s) => { if (s) setStatus((cur) => cur ?? s); });
    return off;
  }, []);

  const act = useCallback((action: RecoveryActionName, sessionId?: string) => {
    void window.bimax.supervisor.action(sessionId ? { action, sessionId } : { action });
  }, []);

  return { status, act };
}
