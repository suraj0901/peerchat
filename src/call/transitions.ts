import type { MediaConnection } from 'peerjs';
import { createTransitionFn } from '../core';
import type { TransitionTable } from '../core';
import type {
  CallState,
  CallEvent,
  CallEffect,
} from './types';
import {
  startCallListener,
  stopCallListener,
  startRingingTimer,
  cancelRingingTimer,
  startConnectingTimer,
  cancelConnectingTimer,
  answerCall,
  closeCall,
} from './effects';

// ── Transition Table ──────────────────────────────────────────────────────────

const table: TransitionTable<CallState, CallEvent> = {
  ringing: {
    ANSWER: {
      target: 'connecting',
      effects: (s, e) => [cancelRingingTimer, startConnectingTimer, answerCall(s.call, e.localStream)],
    },
    REJECT: {
      target: 'ended',
      effects: (s) => [cancelRingingTimer, stopCallListener, closeCall(s.call)],
    },
    CALL_CLOSE: {
      target: 'ended',
      effects: [cancelRingingTimer, stopCallListener],
    },
    CALL_ERROR: {
      target: 'error',
      effects: [cancelRingingTimer, stopCallListener],
    },
    RINGING_TIMEOUT: {
      target: 'error',
      data: (s) => ({ callId: s.callId, error: new Error('Call ringing timed out') }),
      effects: (s) => [stopCallListener, closeCall(s.call)],
    },
  },

  connecting: {
    CALL_STREAM: {
      target: 'live',
      effects: [cancelConnectingTimer],
    },
    HANG_UP: {
      target: 'ended',
      effects: (s) => [cancelConnectingTimer, stopCallListener, closeCall(s.call)],
    },
    CALL_CLOSE: {
      target: 'ended',
      effects: [cancelConnectingTimer, stopCallListener],
    },
    CALL_ERROR: {
      target: 'error',
      effects: [cancelConnectingTimer, stopCallListener],
    },
    CONNECTING_TIMEOUT: {
      target: 'error',
      data: (s) => ({ callId: s.callId, error: new Error('Call connecting timed out') }),
      effects: (s) => [stopCallListener, closeCall(s.call)],
    },
  },

  live: {
    HANG_UP: {
      target: 'ended',
      effects: (s) => [stopCallListener, closeCall(s.call)],
    },
    CALL_CLOSE: {
      target: 'ended',
      effects: [stopCallListener],
    },
    CALL_ERROR: {
      target: 'error',
      effects: [stopCallListener],
    },
  },

  // Terminal states — no outgoing transitions
  ended: {},
  error: {},
};

// ── Compiled Transition Function ──────────────────────────────────────────────

export const transition = createTransitionFn<CallState, CallEvent>(table);

// ── Initial Effects ───────────────────────────────────────────────────────────

/**
 * Returns initial effects for a new call machine.
 * Outbound calls skip ringing and go straight to connecting.
 */
export function initialEffects(
  call: MediaConnection,
  direction: 'inbound' | 'outbound',
): CallEffect[] {
  const effects: CallEffect[] = [startCallListener(call)];

  if (direction === 'inbound') {
    effects.push(startRingingTimer);
  } else {
    effects.push(startConnectingTimer);
  }

  return effects;
}
