type Listener<State> = (newState: State, oldState: State) => void;

/**
 * A robust state machine that enforces allowed transitions.
 * @typeparam State - union of possible state strings.
 * @typeparam Event - union of possible event strings.
 */
export class StateMachine<State extends string, Event extends string> {
    private _state: State;
    private readonly transitions: Map<State, Map<Event, State>>;
    private listeners: Set<Listener<State>> = new Set();

    /**
     * @param initialState - The starting state.
     * @param transitionMap - An object defining allowed transitions:
     *   { fromState: { event: toState, ... }, ... }
     */
    constructor(initialState: State, transitionMap: Record<State, Partial<Record<Event, State>>>) {
        this._state = initialState;
        this.transitions = new Map();
        for (const [fromState, events] of Object.entries(transitionMap)) {
            const eventMap = new Map<Event, State>();
            for (const [event, toState] of Object.entries(events as Record<Event, State>)) {
                eventMap.set(event as Event, toState as State);
            }
            this.transitions.set(fromState as State, eventMap);
        }
    }

    /** The current state. */
    get currentState(): State {
        return this._state;
    }

    /**
     * Attempt to transition to a new state in response to an event.
     * @throws Error if the transition is not allowed.
     */
    transition(event: Event): void {
        const eventMap = this.transitions.get(this._state);
        if (!eventMap) {
            throw new Error(`No transitions defined from state "${this._state}"`);
        }
        const nextState = eventMap.get(event);
        if (nextState === undefined) {
            throw new Error(`Event "${event}" not allowed in state "${this._state}"`);
        }
        const oldState = this._state;
        this._state = nextState;
        this.listeners.forEach(listener => listener(this._state, oldState));
    }

    /** Subscribe to state changes. Returns an unsubscribe function. */
    onStateChange(listener: Listener<State>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Check if a transition would be allowed without performing it. */
    canTransition(event: Event): boolean {
        const eventMap = this.transitions.get(this._state);
        return eventMap?.has(event) ?? false;
    }
}