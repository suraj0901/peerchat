export interface MachineContext<S> {
  transition: (nextState: S, currentState: S, event?: string) => void;
}

export abstract class AbstractMachine<S extends { destroy(): void }> {
  protected currentState!: S;
  
  private listeners = new Set<(next: S, prev: S, event?: string) => void>();

  protected createContext<C extends MachineContext<S>>(additionalCtx: Omit<C, 'transition'>): C {
    return {
      transition: (nextState: S, currentState: S, event?: string) => {
        if (this.currentState === currentState) {
          const prevState = this.currentState;
          this.currentState = nextState;
          this.listeners.forEach(l => l(nextState, prevState, event));
        }
      },
      ...additionalCtx
    } as C;
  }

  public getState(): S {
    return this.currentState;
  }

  public onTransition(listener: (next: S, prev: S, event?: string) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  public destroy() {
    if (this.currentState) {
      this.currentState.destroy();
    }
    this.listeners.clear();
  }
}
