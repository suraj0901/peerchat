import { CallState, CallEvent } from './src/call/types';
import { TransitionTable } from './src/core';

export const table: TransitionTable<CallState, CallEvent> = {
  ringing: {
    ANSWER: {
      target: 'connecting',
      effects: () => [],
    },
  },
  connecting: {
    CALL_STREAM: {
      target: 'live',
      effects: []
    }
  }
}
