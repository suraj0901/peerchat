import type {
  TransitionFn,
  Effect,
  StateListener,
  EventHandler,
  Unsubscribe,
} from './types';

// ── Machine Instance ──────────────────────────────────────────────────────────

export interface Machine<S, E, Emitted> {
  /** Send an event into the machine. */
  send: (event: E) => void;
  /** Subscribe to state changes. Fires immediately with the current state. */
  subscribe: (listener: StateListener<S>) => Unsubscribe;
  /** Listen for emitted events (one-shot side-effect notifications). */
  on: <T extends Emitted['type' & keyof Emitted]>(
    eventType: T,
    handler: EventHandler<Extract<Emitted, { type: T }>>,
  ) => Unsubscribe;
  /** Read the current state. */
  getState: () => S;
  /** Stop the machine: cancel all subscriptions, timers, and async tasks. */
  destroy: () => void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a running state machine from a pure transition function and
 * an initial state.
 *
 * The runtime is responsible for:
 *   - Calling the transition function on each event
 *   - Executing effects (promises, subscriptions, timers, emits)
 *   - Notifying state subscribers after each transition
 *   - Cleaning up on destroy
 */
export function createMachine<S, E extends { type: string }, Emitted extends { type: string }>(
  transitionFn: TransitionFn<S, E>,
  initialState: S,
  initialEffects?: Effect<E>[],
): Machine<S, E, Emitted> {
  let state = initialState;
  let destroyed = false;

  const stateListeners = new Set<StateListener<S>>();
  const eventListeners = new Map<string, Set<EventHandler<any>>>();

  // Active async tasks (AbortControllers keyed by effect id)
  const asyncTasks = new Map<string, AbortController>();
  // Active subscriptions (cleanup functions keyed by effect id)
  const subscriptions = new Map<string, () => void>();
  // Active timers (timeout ids keyed by effect id)
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── Effect Execution ──────────────────────────────────────────────────────

  function executeEffect(effect: Effect<E>): void {
    switch (effect.type) {
      case 'runAsync': {
        // Cancel any existing task with the same id
        asyncTasks.get(effect.id)?.abort();

        const controller = new AbortController();
        asyncTasks.set(effect.id, controller);

        const { id, execute, onDone, onError } = effect;
        execute(controller.signal)
          .then((output) => {
            if (!controller.signal.aborted && !destroyed) {
              asyncTasks.delete(id);
              send(onDone(output));
            }
          })
          .catch((error) => {
            if (!controller.signal.aborted && !destroyed) {
              asyncTasks.delete(id);
              send(onError(error));
            }
          });
        break;
      }

      case 'startSubscription': {
        // Stop any existing subscription with the same id
        subscriptions.get(effect.id)?.();

        const cleanup = effect.subscribe((event) => {
          if (!destroyed) send(event);
        });
        subscriptions.set(effect.id, cleanup);
        break;
      }

      case 'stopSubscription': {
        subscriptions.get(effect.id)?.();
        subscriptions.delete(effect.id);
        break;
      }

      case 'startTimer': {
        // Cancel any existing timer with the same id
        const existing = timers.get(effect.id);
        if (existing != null) clearTimeout(existing);

        const timerId = setTimeout(() => {
          timers.delete(effect.id);
          if (!destroyed) send(effect.event);
        }, effect.delayMs);
        timers.set(effect.id, timerId);
        break;
      }

      case 'cancelTimer': {
        const timerId = timers.get(effect.id);
        if (timerId != null) {
          clearTimeout(timerId);
          timers.delete(effect.id);
        }
        break;
      }

      case 'emit': {
        const emitted = effect.event as Emitted;
        const handlers = eventListeners.get(emitted.type);
        if (handlers) {
          for (const handler of handlers) {
            handler(emitted);
          }
        }
        break;
      }

      case 'fireAndForget': {
        effect.execute();
        break;
      }
    }
  }

  // ── Core Send Loop ────────────────────────────────────────────────────────

  function send(event: E): void {
    if (destroyed) return;

    const [nextState, effects] = transitionFn(state, event);
    state = nextState;

    // Notify state subscribers
    for (const listener of stateListeners) {
      listener(state);
    }

    // Execute effects after state is updated and subscribers notified
    for (const effect of effects) {
      executeEffect(effect);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function subscribe(listener: StateListener<S>): Unsubscribe {
    stateListeners.add(listener);
    // Immediate emission so the subscriber has the current state
    listener(state);
    return {
      unsubscribe: () => { stateListeners.delete(listener); },
    };
  }

  function on<T extends string>(
    eventType: T,
    handler: EventHandler<Extract<Emitted, { type: T }>>,
  ): Unsubscribe {
    if (!eventListeners.has(eventType)) {
      eventListeners.set(eventType, new Set());
    }
    eventListeners.get(eventType)!.add(handler);
    return {
      unsubscribe: () => {
        const handlers = eventListeners.get(eventType);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) eventListeners.delete(eventType);
        }
      },
    };
  }

  function getState(): S {
    return state;
  }

  function destroy(): void {
    destroyed = true;

    // Cancel all async tasks
    for (const controller of asyncTasks.values()) {
      controller.abort();
    }
    asyncTasks.clear();

    // Stop all subscriptions
    for (const cleanup of subscriptions.values()) {
      cleanup();
    }
    subscriptions.clear();

    // Cancel all timers
    for (const timerId of timers.values()) {
      clearTimeout(timerId);
    }
    timers.clear();

    // Clear listeners
    stateListeners.clear();
    eventListeners.clear();
  }

  // Execute initial effects (e.g. start long-lived subscriptions)
  if (initialEffects) {
    for (const effect of initialEffects) {
      executeEffect(effect);
    }
  }

  return { send, subscribe, on, getState, destroy };
}
