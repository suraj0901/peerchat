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
