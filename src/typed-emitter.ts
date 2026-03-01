/**
 * A minimal, fully-typed event emitter.
 *
 * @typeparam EventMap - A record mapping event names to their handler signatures.
 *
 * @example
 * ```ts
 * type MyEvents = {
 *   message: (text: string) => void;
 *   error: (err: Error) => void;
 * };
 * class MyThing extends TypedEmitter<MyEvents> { ... }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEmitter<EventMap extends Record<string, (...args: any[]) => void>> {
    private _listeners = new Map<keyof EventMap, Set<EventMap[keyof EventMap]>>();

    /**
     * Subscribe to an event. Returns an unsubscribe function.
     */
    on<K extends keyof EventMap>(event: K, handler: EventMap[K]): () => void {
        let set = this._listeners.get(event);
        if (!set) {
            set = new Set();
            this._listeners.set(event, set);
        }
        set.add(handler as EventMap[keyof EventMap]);
        return () => this.off(event, handler);
    }

    /**
     * Unsubscribe a specific handler from an event.
     */
    off<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
        this._listeners.get(event)?.delete(handler as EventMap[keyof EventMap]);
    }

    /**
     * Emit an event, calling all registered handlers with the provided arguments.
     * Intended for internal use by subclasses.
     */
    protected emit<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): void {
        const set = this._listeners.get(event);
        if (!set) return;
        for (const handler of set) {
            try {
                (handler as (...a: unknown[]) => void)(...args);
            } catch (err) {
                console.error(`Error in "${String(event)}" handler:`, err);
            }
        }
    }

    /**
     * Remove all listeners, optionally for a specific event.
     */
    removeAllListeners(event?: keyof EventMap): void {
        if (event) {
            this._listeners.delete(event);
        } else {
            this._listeners.clear();
        }
    }
}
