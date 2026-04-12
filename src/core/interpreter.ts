import type { Command, Event, State, CommandHandler } from './types';

export interface InterpreterConfig {
  handlers: Map<string, CommandHandler>;
  onStateChange?: (state: State, prevState: State) => void;
  onError?: (error: Error, context: { state: State; command: Command }) => void;
  onEvent?: (event: Event) => void;
}

export class Interpreter<S extends State, E extends Event> {
  private state: S;
  private reducer: (state: S, event: E) => readonly [S, readonly Command[]];
  private handlers: Map<string, CommandHandler>;
  private onStateChange?: (state: S, prevState: S) => void;
  private onError?: (error: Error, context: { state: S; command: Command }) => void;
  private onEvent?: (event: Event) => void;
  private pendingCommands: Command[] = [];
  private isProcessing = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    initialState: S,
    reducer: (state: S, event: E) => readonly [S, readonly Command[]],
    config: InterpreterConfig
  ) {
    this.state = initialState;
    this.reducer = reducer;
    this.handlers = config.handlers;
    this.onStateChange = config.onStateChange;
    this.onError = config.onError;
    this.onEvent = config.onEvent;
  }

  getState(): S {
    return this.state;
  }

  async dispatch(event: E): Promise<void> {
    const prevState = this.state;
    const [nextState, commands] = this.reducer(this.state, event);

    this.state = nextState;

    if (this.state !== prevState && this.onStateChange) {
      this.onStateChange(this.state, prevState);
    }

    this.pendingCommands.push(...commands);

    if (!this.isProcessing) {
      await this.processCommandQueue();
    }
  }

  private async processCommandQueue(): Promise<void> {
    this.isProcessing = true;

    while (this.pendingCommands.length > 0) {
      const command = this.pendingCommands.shift()!;
      await this.executeCommand(command);
    }

    this.isProcessing = false;
  }

  private async executeCommand(command: Command): Promise<void> {
    if (command.type === 'schedule.timeout') {
      const timerId = command.timerId;
      const handler = () => {
        this.dispatch(command.event as E);
      };
      const timer = setTimeout(handler, command.delayMs);
      this.timers.set(timerId, timer);
      return;
    }

    if (command.type === 'schedule.cancelTimeout') {
      const timer = this.timers.get(command.timerId);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(command.timerId);
      }
      return;
    }

    if (command.type === 'emit') {
      if (this.onEvent) {
        this.onEvent(command.event);
      }
      return;
    }

    const handler = this.handlers.get(command.type);
    if (!handler) {
      console.warn(`No handler registered for command type: ${command.type}`);
      return;
    }

    try {
      const events = await handler(command);
      for (const event of events) {
        await this.dispatch(event as E);
      }
    } catch (error) {
      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)), {
          state: this.state,
          command,
        });
      }
    }
  }

  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingCommands = [];
  }
}