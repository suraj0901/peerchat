import type { MediaConnection } from 'peerjs';
import type { CallEffect } from './types';

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
      call.on('stream', (stream) => {
        send({ type: 'CALL_STREAM', remoteStream: stream });
      });
      call.on('close', () => send({ type: 'CALL_CLOSE' }));
      call.on('error', (error) => send({ type: 'CALL_ERROR', error }));

      return () => {
        call.off('stream');
        call.off('close');
        call.off('error');
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

// ── Call Actions ──────────────────────────────────────────────────────────────

/** Answer an incoming call with the local media stream. */
export const answerCall = (call: MediaConnection, localStream: MediaStream): CallEffect => ({
  type: 'fireAndForget',
  execute: () => call.answer(localStream),
});

/** Close (hang up) a media connection. */
export const closeCall = (call: MediaConnection): CallEffect => ({
  type: 'fireAndForget',
  execute: () => call.close(),
});

