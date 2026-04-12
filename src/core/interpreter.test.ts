import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Interpreter } from './interpreter';
import type { State, Event, Command } from './types';

interface TestState extends State {
  _tag: 'idle' | 'active';
  count: number;
}

type TestEvent = Event & { type: 'increment' | 'decrement' | 'reset' };

describe('Interpreter', () => {
  let interpreter: Interpreter<TestState, TestEvent>;

  const createReducer = () => {
    return (state: TestState, event: TestEvent): readonly [TestState, readonly Command[]] => {
      switch (event.type) {
        case 'increment':
          return [{ ...state, count: state.count + 1 }, []];
        case 'decrement':
          return [{ ...state, count: state.count - 1 }, []];
        case 'reset':
          return [{ ...state, count: 0 }, [{ type: 'emit', event: { type: 'reset.complete' } }]];
        default:
          return [state, []];
      }
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    interpreter?.destroy();
  });

  it('should initialize with initial state', () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    interpreter = new Interpreter(initialState, createReducer(), { handlers: new Map() });

    expect(interpreter.getState()).toBe(initialState);
  });

  it('should update state on event dispatch', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    interpreter = new Interpreter(initialState, createReducer(), { handlers: new Map() });

    await interpreter.dispatch({ type: 'increment' });
    expect(interpreter.getState().count).toBe(1);

    await interpreter.dispatch({ type: 'increment' });
    expect(interpreter.getState().count).toBe(2);
  });

  it('should call onStateChange when state changes', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    const onStateChange = vi.fn();
    
    interpreter = new Interpreter(initialState, createReducer(), {
      handlers: new Map(),
      onStateChange,
    });

    await interpreter.dispatch({ type: 'increment' });
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith(
      { _tag: 'idle', count: 1 },
      initialState
    );
  });

  it('should not call onStateChange when state is the same', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    const onStateChange = vi.fn();

    const reducer = (state: TestState, event: TestEvent): readonly [TestState, readonly Command[]] => {
      return [state, []];
    };

    interpreter = new Interpreter(initialState, reducer, {
      handlers: new Map(),
      onStateChange,
    });

    await interpreter.dispatch({ type: 'increment' });
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('should execute emit command', async () => {
    const initialState: TestState = { _tag: 'idle', count: 5 };
    const onEvent = vi.fn();

    interpreter = new Interpreter(initialState, createReducer(), {
      handlers: new Map(),
      onEvent,
    });

    await interpreter.dispatch({ type: 'reset' });
    expect(onEvent).toHaveBeenCalledWith({ type: 'reset.complete' });
  });

  it('should handle scheduled timeout commands', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    const onStateChange = vi.fn();

    const reducerWithTimeout = (
      state: TestState,
      event: TestEvent
    ): readonly [TestState, readonly Command[]] => {
      if (event.type === 'increment') {
        return [
          { ...state, count: state.count + 1 },
          [{ type: 'schedule.timeout', delayMs: 1000, event: { type: 'decrement' }, timerId: 'timer-1' }],
        ];
      }
      return createReducer()(state, event);
    };

    interpreter = new Interpreter(initialState, reducerWithTimeout, {
      handlers: new Map(),
      onStateChange,
    });

    await interpreter.dispatch({ type: 'increment' });
    expect(interpreter.getState().count).toBe(1);

    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();
    
    expect(interpreter.getState().count).toBe(0);
  });

  it('should handle command handlers', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    const handler = vi.fn().mockResolvedValue([{ type: 'increment' } as Event]);

    interpreter = new Interpreter(initialState, createReducer(), {
      handlers: new Map([['custom.command', handler]]),
    });

    const reducerWithCommand = (
      state: TestState,
      event: TestEvent
    ): readonly [TestState, readonly Command[]] => {
      if (event.type === 'increment') {
        return [
          { ...state, count: state.count + 1 },
          [{ type: 'custom.command' } as Command],
        ];
      }
      return createReducer()(state, event);
    };

    const interp = new Interpreter(initialState, reducerWithCommand, {
      handlers: new Map([['custom.command', handler]]),
    });

    await interp.dispatch({ type: 'increment' });
    
    expect(handler).toHaveBeenCalled();
    expect(interp.getState().count).toBe(2);
    interp.destroy();
  });

  it('should handle handler errors', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    const onError = vi.fn();
    const error = new Error('handler failed');

    const handler = vi.fn().mockRejectedValue(error);

    const reducerWithCommand = (
      state: TestState,
      event: TestEvent
    ): readonly [TestState, readonly Command[]] => {
      if (event.type === 'increment') {
        return [
          { ...state, count: state.count + 1 },
          [{ type: 'test.command' } as Command],
        ];
      }
      return createReducer()(state, event);
    };

    interpreter = new Interpreter(initialState, reducerWithCommand, {
      handlers: new Map([['test.command', handler]]),
      onError,
    });

    await interpreter.dispatch({ type: 'increment' });

    expect(onError).toHaveBeenCalledWith(error, {
      state: { _tag: 'idle', count: 1 },
      command: { type: 'test.command' },
    });
  });

  it('should warn for missing handlers', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reducerWithCommand = (
      state: TestState,
      event: TestEvent
    ): readonly [TestState, readonly Command[]] => {
      if (event.type === 'increment') {
        return [
          { ...state, count: state.count + 1 },
          [{ type: 'missing.command' } as Command],
        ];
      }
      return createReducer()(state, event);
    };

    interpreter = new Interpreter(initialState, reducerWithCommand, {
      handlers: new Map(),
    });

    await interpreter.dispatch({ type: 'increment' });

    expect(warnSpy).toHaveBeenCalledWith('No handler registered for command type: missing.command');
    warnSpy.mockRestore();
  });

  it('should cancel scheduled timeouts', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };
    const onStateChange = vi.fn();

    const reducer = (
      state: TestState,
      event: TestEvent
    ): readonly [TestState, readonly Command[]] => {
      if (event.type === 'increment') {
        return [
          { ...state, count: state.count + 1 },
          [
            { type: 'schedule.timeout', delayMs: 1000, event: { type: 'decrement' }, timerId: 't1' },
          ],
        ];
      }
      if (event.type === 'reset') {
        return [
          { ...state, count: 0 },
          [{ type: 'schedule.cancelTimeout', timerId: 't1' }],
        ];
      }
      return createReducer()(state, event);
    };

    interpreter = new Interpreter(initialState, reducer, {
      handlers: new Map(),
      onStateChange,
    });

    await interpreter.dispatch({ type: 'increment' });
    expect(interpreter.getState().count).toBe(1);

    await interpreter.dispatch({ type: 'reset' });
    
    vi.advanceTimersByTime(2000);
    await vi.runAllTimersAsync();

    expect(interpreter.getState().count).toBe(0);
  });

  it('should clean up on destroy', async () => {
    const initialState: TestState = { _tag: 'idle', count: 0 };

    const reducer = (
      state: TestState,
      event: TestEvent
    ): readonly [TestState, readonly Command[]] => {
      return [{ ...state, count: state.count + 1 }, [
        { type: 'schedule.timeout', delayMs: 1000, event: { type: 'increment' }, timerId: 't1' },
      ]];
    };

    interpreter = new Interpreter(initialState, reducer, { handlers: new Map() });
    await interpreter.dispatch({ type: 'increment' });

    interpreter.destroy();

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    expect(interpreter.getState().count).toBe(1);
  });
});