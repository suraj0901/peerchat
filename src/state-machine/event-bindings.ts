/**
 * Manages PeerJS event listener subscriptions and provides bulk cleanup.
 *
 * Replaces the manual `eventListeners: Array<() => void>` + `.push()` pattern
 * that was duplicated across every state-machine wrapper.
 */
export class EventBindings {
    private readonly cleanups: Array<() => void> = [];

    /**
     * Subscribe to an event on an emitter and store a cleanup function.
     */
    bind<E extends string>(
        emitter: { on(event: E, fn: (...args: any[]) => void): void; off(event: E, fn: (...args: any[]) => void): void },
        event: E,
        handler: (...args: any[]) => void,
    ): void {
        emitter.on(event, handler);
        this.cleanups.push(() => emitter.off(event, handler));
    }

    /**
     * Remove all registered listeners at once.
     */
    cleanup(): void {
        this.cleanups.forEach(fn => fn());
        this.cleanups.length = 0;
    }
}
