import { useState, useEffect } from 'react';

type Listener<T> = (state: T, prevState: T) => void;

export function createStore<T>(initialState: T) {
  let state = initialState;
  const listeners = new Set<Listener<T>>();
  
  return {
    getState: () => state,
    
    setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => {
      const prev = state;
      const changes = typeof partial === 'function' ? partial(prev) : partial;
      state = { ...prev, ...changes };
      listeners.forEach(l => l(state, prev));
    },
    
    subscribe: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    
    useStore: <R>(selector: (state: T) => R): R => {
      const [localState, setLocalState] = useState(() => selector(state));
      
      useEffect(() => {
        const listener: Listener<T> = (newState) => {
          setLocalState(selector(newState));
        };
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      }, [selector]);
      
      return localState;
    },
  };
}
