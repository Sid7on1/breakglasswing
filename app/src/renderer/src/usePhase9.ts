import { useEffect, useState } from 'react';
import type { AdaptiveRuntimeSnapshot } from './global';
import type { ProcessProvenanceRecord } from '../../phase9/process.provenance';
import type {
  AlchemistCapabilitySnapshot, EnvironmentCapabilitySnapshot,
} from '../../phase9/workspace.capabilities';

export interface Phase9View {
  runtime: AdaptiveRuntimeSnapshot | null;
  processes: ProcessProvenanceRecord[];
  environment: EnvironmentCapabilitySnapshot | null;
  alchemist: AlchemistCapabilitySnapshot | null;
  refreshing: boolean;
}

const EMPTY: Phase9View = {
  runtime: null, processes: [], environment: null, alchemist: null, refreshing: false,
};

/** Read-only Phase 9 context plus a conservative interaction signal back to Desktop main. */
export function usePhase9(project: string): Phase9View {
  const [view, setView] = useState<Phase9View>(EMPTY);

  useEffect(() => {
    let live = true;
    const refresh = async (): Promise<void> => {
      if (live) setView((current) => ({ ...current, refreshing: true }));
      const [runtime, processes, environment, alchemist] = await Promise.all([
        window.bimax.phase9.adaptiveState().catch(() => null),
        window.bimax.phase9.processProvenance().catch(() => []),
        window.bimax.phase9.environment().catch(() => null),
        window.bimax.phase9.alchemistStatus().catch(() => null),
      ]);
      if (live) setView({ runtime, processes, environment, alchemist, refreshing: false });
    };
    void refresh();
    const off = window.bimax.phase9.onAdaptiveChanged((runtime) => {
      if (live) setView((current) => ({ ...current, runtime }));
    });
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { live = false; off(); window.clearInterval(timer); };
  }, [project]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const report = (active: boolean): void => window.bimax.phase9.reportInteraction(active, reduced.matches);
    const onInteraction = (): void => report(true);
    const onPreference = (): void => report(false);
    report(false);
    window.addEventListener('pointerdown', onInteraction, { passive: true });
    window.addEventListener('keydown', onInteraction, { passive: true });
    reduced.addEventListener('change', onPreference);
    return () => {
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('keydown', onInteraction);
      reduced.removeEventListener('change', onPreference);
    };
  }, []);

  return view;
}
