import { describe, it, expect } from 'vitest';
import { Ok, Err, isOk, isErr, assertNever, exhaustive } from './types';
import type { Result, State, Event, Command } from './types';

describe('Result type utilities', () => {
  describe('Ok', () => {
    it('should create a successful result', () => {
      const result = Ok(42);
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it('should work with complex types', () => {
      const result = Ok({ name: 'test', count: 5 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('test');
      }
    });
  });

  describe('Err', () => {
    it('should create an error result', () => {
      const result = Err('something went wrong');
      expect(result).toEqual({ ok: false, error: 'something went wrong' });
    });

    it('should work with error objects', () => {
      const error = new Error('test error');
      const result = Err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('isOk', () => {
    it('should return true for Ok results', () => {
      expect(isOk(Ok(42))).toBe(true);
    });

    it('should return false for Err results', () => {
      expect(isOk(Err('error'))).toBe(false);
    });

    it('should narrow type correctly', () => {
      const result: Result<number, string> = Ok(42);
      if (isOk(result)) {
        expect(typeof result.value).toBe('number');
      }
    });
  });

  describe('isErr', () => {
    it('should return true for Err results', () => {
      expect(isErr(Err('error'))).toBe(true);
    });

    it('should return false for Ok results', () => {
      expect(isErr(Ok(42))).toBe(false);
    });

    it('should narrow type correctly', () => {
      const result: Result<number, string> = Err('oops');
      if (isErr(result)) {
        expect(typeof result.error).toBe('string');
      }
    });
  });
});

describe('Type definitions', () => {
  it('State should have _tag property', () => {
    const state: State = { _tag: 'test' };
    expect(state._tag).toBe('test');
  });

  it('Event should have type property', () => {
    const event: Event = { type: 'test.event' };
    expect(event.type).toBe('test.event');
  });

  it('Command types should be valid', () => {
    const cmd1: Command = { type: 'peer.connect', remotePeerId: 'peer-123' };
    const cmd2: Command = { type: 'emit', event: { type: 'test' } };
    expect(cmd1.type).toBe('peer.connect');
    expect(cmd2.type).toBe('emit');
  });
});

describe('assertNever', () => {
  it('should throw error for any value', () => {
    expect(() => assertNever('test' as never)).toThrow('Unexpected object');
  });

  it('should include value in error message', () => {
    try {
      assertNever({ foo: 'bar' } as never);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain('foo');
    }
  });
});

describe('exhaustive', () => {
  it('should be usable for exhaustiveness checks', () => {
    const value: 'a' | 'b' = 'a';
    switch (value) {
      case 'a':
        break;
      case 'b':
        break;
      default:
        exhaustive(value);
    }
  });
});