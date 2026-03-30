import type { MediaConnection } from 'peerjs';
import type { CallEffect, CallParentEvent } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const RINGING_TIMEOUT_MS = 30_000;
export const CONNECTING_TIMEOUT_MS = 30_000;

// ── Listener ──────────────────────────────────────────────────────────────────

/** Start listening to PeerJS MediaConnection events. */
export function startCallListener(call: MediaConnection): CallEffect {
  return {
    type: 'startSubscription',
    id: 'callEvents',
    subscribe: (send) => {
      call.on('stream', (stream: MediaStream) => send({ type: 'CALL_STREAM', stream }));
      call.on('close', () => send({ type: 'CALL_CLOSE' }));
      call.on('error', (error) => send({ type: 'CALL_ERROR', error }));

      return () => {
        // PeerJS does not support removeListener — teardown is via call.close()
      };
    },
  };
}

export const stopCallListener: CallEffect = {
  type: 'stopSubscription',
  id: 'callEvents',
};

// ── Timers ────────────────────────────────────────────────────────────────────

export const startRingingTimer: CallEffect = {
  type: 'startTimer',
  id: 'ringingTimeout',
  delayMs: RINGING_TIMEOUT_MS,
  event: { type: 'RINGING_TIMEOUT' },
};

export const cancelRingingTimer: CallEffect = {
  type: 'cancelTimer',
  id: 'ringingTimeout',
};

export const startConnectingTimer: CallEffect = {
  type: 'startTimer',
  id: 'connectingTimeout',
  delayMs: CONNECTING_TIMEOUT_MS,
  event: { type: 'CONNECTING_TIMEOUT' },
};

export const cancelConnectingTimer: CallEffect = {
  type: 'cancelTimer',
  id: 'connectingTimeout',
};

// ── Emit ──────────────────────────────────────────────────────────────────────

/** Emit a parent event. */
export const emitParent = (event: CallParentEvent): CallEffect =>
  ({ type: 'emit', event });
