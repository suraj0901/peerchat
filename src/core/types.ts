// ── Core Runtime Types ─────────────────────────────────────────────────────────

/**
 * Pure transition function: given current state and an event, returns
 * the next state and a list of effects to execute.
 *
 * This is the only place where state logic lives — no side effects,
 * fully deterministic, trivially testable.
 */
export type TransitionFn<S, E> = (state: S, event: E) => [S, Effect<E>[]];

/**
 * Side effects produced by transition functions. The runtime interprets
 * these; transition functions only *describe* what should happen.
 */
export type Effect<E> =
  | { type: 'runAsync'; id: string; execute: (signal: AbortSignal) => Promise<unknown>; onDone: (output: unknown) => E; onError: (error: unknown) => E }
  | { type: 'startSubscription'; id: string; subscribe: (send: (event: E) => void) => () => void }
  | { type: 'stopSubscription'; id: string }
  | { type: 'startTimer'; id: string; delayMs: number; event: E }
  | { type: 'cancelTimer'; id: string }
  | { type: 'emit'; event: unknown }
  | { type: 'fireAndForget'; execute: () => void };

/** Callback for state change subscribers. */
export type StateListener<S> = (state: S) => void;

/** Callback for emitted event subscribers. */
export type EventHandler<Emitted> = (event: Emitted) => void;

/** Unsubscribe handle. */
export type Unsubscribe = { unsubscribe: () => void };

/** Compile-time exhaustiveness check. Use in default branches of switch statements. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

// ── Transition Table DSL ──────────────────────────────────────────────────────

/** Constraint for states used in transition tables. */
export type TaggedState = { readonly _tag: string };

/**
 * Full transition table: maps `state._tag` → `event.type` → `TransitionEntry`.
 *
 * TypeScript narrows both `state` and `event` per entry, so `data` and
 * `effects` callbacks receive the correctly narrowed types.
 *
 * Terminal states with no outgoing transitions can be omitted or left as `{}`.
 */
export type TransitionTable<
  S extends TaggedState,
  E extends { type: string },
> = {
  [Tag in S['_tag']]?: {
    [EventType in E['type']]?: TransitionEntry<
      Extract<S, { _tag: Tag }>,
      Extract<E, { type: EventType }>,
      S,
      E
    >;
  };
};

/**
 * A single transition entry — either changes state or stays in current state.
 *
 * **State change:** provide `target` (the new `_tag`) and `data` (a function
 * returning everything except `_tag` for the target state).
 *
 * **Self-transition:** omit `target` and `data`, only provide `effects`.
 */
export type TransitionEntry<
  CurrentState,
  CurrentEvent,
  AllStates extends TaggedState,
  E,
> = StateChangeEntry<CurrentState, CurrentEvent, AllStates, E>
  | SelfTransitionEntry<CurrentState, CurrentEvent, E>;

/** Transition that changes to a different state tag. */
type StateChangeEntry<
  CurrentState,
  CurrentEvent,
  AllStates extends TaggedState,
  E,
> = {
  [Tag in AllStates['_tag']]: {
    target: Tag;
  } & (
    (Omit<CurrentState, '_tag'> & Omit<CurrentEvent, 'type'>) extends Omit<Extract<AllStates, { _tag: Tag }>, '_tag'>
      ? { data?: (state: CurrentState, event: CurrentEvent) => Omit<Extract<AllStates, { _tag: Tag }>, '_tag'> }
      : { data: (state: CurrentState, event: CurrentEvent) => Omit<Extract<AllStates, { _tag: Tag }>, '_tag'> }
  ) & {
    effects?: Effect<E>[] | ((state: CurrentState, event: CurrentEvent) => Effect<E>[]);
  };
}[AllStates['_tag']];

/** Self-transition — no state change, just effects. */
type SelfTransitionEntry<CurrentState, CurrentEvent, E> = {
  target?: undefined;
  data?: undefined;
  effects: Effect<E>[] | ((state: CurrentState, event: CurrentEvent) => Effect<E>[]);
};

/**
 * Entry effects config: maps state tags to effect factories that run
 * automatically when the machine enters that state (i.e. `_tag` changes).
 *
 * The state parameter is narrowed to the specific variant for that tag.
 *
 * Entry effects do NOT fire for the initial state — only on transitions.
 */
export type OnEnterConfig<S extends TaggedState, E> = {
  [Tag in S['_tag']]?: (state: Extract<S, { _tag: Tag }>) => Effect<E>[];
};
