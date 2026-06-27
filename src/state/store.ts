// Minimal, dependency-free observable store.
//
// Previously this imported React (useState/useEffect) to expose a `useStore`
// hook for the retired Ink front-end. The sole front-end is now the Go / Bubble
// Tea TUI driving the headless engine over stdio, so the hook is gone and this
// is a plain typed pub/sub container used by the engine's app state.

export type StateUpdater<T> = Partial<T> | ((prev: T) => Partial<T>);

export interface Store<T> {
  getState(): T;
  setState(update: StateUpdater<T>): void;
  subscribe(listener: (state: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state: T = initial;
  const listeners = new Set<(state: T) => void>();

  return {
    getState() {
      return state;
    },
    setState(update: StateUpdater<T>) {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener: (state: T) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
