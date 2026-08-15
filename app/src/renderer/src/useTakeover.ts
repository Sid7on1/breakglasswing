import { useCallback, useEffect, useState } from 'react';
import type { TakeoverState } from './global';

const IDLE: TakeoverState = {
  paused: false, generation: 0, reason: '', actor: 'system', changedAtMs: 0,
};

/**
 * The user's half of the Mac takeover latch.
 *
 * The state is main's (main/takeover.ts), never the renderer's: this hook mirrors it and sends
 * intents. It deliberately does NOT optimistically flip `paused` — the whole point of the control
 * is that the UI only claims the agent stopped once the process that can stop it says so.
 */
export function useTakeover(): {
  takeover: TakeoverState;
  pause: (reason?: string) => void;
  resume: () => void;
} {
  const [takeover, setTakeover] = useState<TakeoverState>(IDLE);

  useEffect(() => {
    const off = window.bimax.takeover.onState(setTakeover);
    void window.bimax.takeover.get().then((state) => { if (state) setTakeover(state); });
    return off;
  }, []);

  const pause = useCallback((reason?: string) => {
    void window.bimax.takeover.set({ paused: true, ...(reason ? { reason } : {}) }).then((state) => {
      if (state) setTakeover(state);
    });
  }, []);

  const resume = useCallback(() => {
    void window.bimax.takeover.set({ paused: false }).then((state) => {
      if (state) setTakeover(state);
    });
  }, []);

  return { takeover, pause, resume };
}
