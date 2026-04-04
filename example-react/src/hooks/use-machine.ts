import { useEffect, useReducer } from 'react';

/**
 * Generic hook that subscribes to any peerchat machine (PeerManager, MediaMachine,
 * CallMachine, ConnectionMachine) and returns its current state.
 *
 * Uses `useReducer` for force-update rather than `useSyncExternalStore` because
 * PeerReadyState mutates its `calls`/`connections` Maps in-place and calls
 * `notifyChange()` — the state *reference* stays the same, so
 * `useSyncExternalStore`'s `Object.is` comparison would miss those updates.
 */
export function useMachineState<S>(
  machine: {
    subscribe(cb: () => void): { unsubscribe(): void };
    getState(): S;
  },
): S {
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    const sub = machine.subscribe(forceUpdate);
    return sub.unsubscribe;
  }, [machine]);

  return machine.getState();
}
