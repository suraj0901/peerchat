import type {
  TransitionFn,
  Effect,
  StateListener,
  EventHandler,
  Unsubscribe,
  TransitionTable,
  TaggedState,
  OnEnterConfig,
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

// ── Table → TransitionFn Compiler ─────────────────────────────────────────────

/**
 * Compiles a declarative transition table into a `TransitionFn`.
 *
 * The table is a nested object keyed by `state._tag` → `event.type`.
 * Each entry describes the target state, how to build its data, and what
 * effects to produce. Unmatched (state, event) pairs return `[state, []]`.
 *
 * Type safety is enforced at the table definition site via mapped types.
 */
export function createTransitionFn<
  S extends TaggedState,
  E extends { type: string },
>(table: TransitionTable<S, E>): TransitionFn<S, E> {
  return (state: S, event: E): [S, Effect<E>[]] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateEntries = (table as any)[state._tag];
    if (!stateEntries) return [state, []];

    const entry = stateEntries[event.type];
    if (!entry) return [state, []];

    // Compute effects (static array or factory function)
    const effects: Effect<E>[] = !entry.effects
      ? []
      : typeof entry.effects === 'function'
        ? entry.effects(state, event)
        : [...entry.effects]; // Clone static array to prevent mutation

    // Self-transition: no state change
    if (entry.target == null) {
      return [state, effects];
    }

    // State change: build next state from target tag + data
    let data;
    if (entry.data) {
      data = entry.data(state, event);
    } else {
      data = { ...state, ...event };
      // Omit control fields so they don't overwrite if not intended (though nextState overwrites _tag)
      delete (data as any)._tag;
      delete (data as any).type;
    }
    const nextState = { _tag: entry.target, ...data } as S;

    return [nextState, effects];
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a running state machine from a pure transition function and
 * an initial state.
 *
 * The runtime is responsible for:
 *   - Calling the transition function on each event
 *   - Executing effects (promises, subscriptions, timers, emits)
 *   - Appending entry effects when the state tag changes (`onEnter`)
 *   - Notifying state subscribers after each transition
 *   - Cleaning up on destroy
 *
 * **`onEnter`**: Entry effects fire automatically when `state._tag` changes.
 * They do NOT fire for the initial state — only on transitions.
 */
export function createMachine<S extends TaggedState, E extends { type: string }, Emitted extends { type: string }>(
  transitionFn: TransitionFn<S, E>,
  initialState: S,
  initialEffects?: Effect<E>[],
  onEnter?: OnEnterConfig<S, E>,
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

    const prevTag = state._tag;
    const [nextState, transitionEffects] = transitionFn(state, event);
    state = nextState;

    // Auto-append entry effects on state tag change
    let allEffects = transitionEffects;
    if (onEnter && state._tag !== prevTag) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entryFn = (onEnter as any)[state._tag] as ((s: S) => Effect<E>[]) | undefined;
      if (entryFn) {
        allEffects = [...transitionEffects, ...entryFn(state)];
      }
    }

    // Notify state subscribers
    for (const listener of stateListeners) {
      listener(state);
    }

    // Execute effects after state is updated and subscribers notified
    for (const effect of allEffects) {
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
