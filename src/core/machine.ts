import { createLogger, type Logger } from './logger';

export interface MachineContext<S> {
  transition: (nextState: S) => void;
}

export abstract class AbstractMachine<S extends { destroy(): void }, E extends { type: string } = never> {
  protected currentState!: S;
  protected abstract readonly log: Logger;
  
  private transitionListeners = new Set<(next: S, prev: S) => void>();
  private stateSubscribers = new Set<() => void>();
  private eventListeners = new Map<string, Set<(event: any) => void>>();

  protected createContext<C extends MachineContext<S>>(additionalCtx: Omit<C, 'transition'> = {} as Omit<C, 'transition'>): C {
    return {
      transition: (nextState: S) => {
        const prevState = this.currentState;
        if (prevState !== nextState) {
          const prevTag = (prevState as any)?._tag ?? 'unknown';
          const nextTag = (nextState as any)?._tag ?? 'unknown';
          this.log.info(`⏭ transition: ${prevTag} → ${nextTag}`);
          this.currentState = nextState;
          this.transitionListeners.forEach(l => l(nextState, prevState));
          this.stateSubscribers.forEach(s => s());
        } else {
          this.log.debug('⏭ transition skipped (same state)');
        }
      },
      ...additionalCtx
    } as C;
  }

  public getState(): S {
    return this.currentState;
  }

  public onTransition(listener: (next: S, prev: S) => void) {
    this.transitionListeners.add(listener);
    return () => { this.transitionListeners.delete(listener); };
  }

  public subscribe(listener: () => void): { unsubscribe: () => void } {
    this.stateSubscribers.add(listener);
    return { unsubscribe: () => { this.stateSubscribers.delete(listener); } };
  }

  protected emit(event: E): void {
    this.log.info(`📢 emit: ${(event as { type: string }).type}`, event);
    const handlers = this.eventListeners.get((event as { type: string }).type);
    if (handlers) {
      this.log.debug(`  → ${handlers.size} handler(s) notified`);
      for (const handler of handlers) {
        handler(event);
      }
    } else {
      this.log.debug(`  → no handlers registered for "${(event as { type: string }).type}"`);
    }
  }

  public on<T extends E['type']>(
    eventType: T,
    handler: (event: Extract<E, { type: T }>) => void,
  ): { unsubscribe: () => void } {
    if (!this.eventListeners.has(eventType as string)) {
      this.eventListeners.set(eventType as string, new Set());
    }
    this.eventListeners.get(eventType as string)!.add(handler);
    this.log.debug(`🔔 on("${eventType}") handler registered`);
    return {
      unsubscribe: () => {
        const handlers = this.eventListeners.get(eventType as string);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) this.eventListeners.delete(eventType as string);
        }
      },
    };
  }

  protected notifySubscribers(): void {
    this.stateSubscribers.forEach(s => s());
  }

  public destroy() {
    this.log.info('💀 destroy()');
    if (this.currentState) {
      this.currentState.destroy();
    }
    this.transitionListeners.clear();
    this.stateSubscribers.clear();
    this.eventListeners.clear();
  }
}
