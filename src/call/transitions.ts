import type { MediaConnection } from 'peerjs';
import type {
  CallState,
  CallEvent,
  CallEffect,
  CallParentEvent,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const RINGING_TIMEOUT_MS = 30_000;
const CONNECTING_TIMEOUT_MS = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Start listening to PeerJS MediaConnection events. */
function startCallListener(call: MediaConnection): CallEffect {
  return {
    type: 'startSubscription',
    id: 'callEvents',
    subscribe: (send) => {
      call.on('stream', (stream: MediaStream) => send({ type: 'CALL_STREAM', stream }));
      call.on('close', () => send({ type: 'CALL_CLOSE' }));
      call.on('error', (error: any) => send({ type: 'CALL_ERROR', error }));

      return () => {
        // PeerJS does not support removeListener — teardown is via call.close()
      };
    },
  };
}

const stopCallListener: CallEffect = { type: 'stopSubscription', id: 'callEvents' };

const startRingingTimer: CallEffect = {
  type: 'startTimer',
  id: 'ringingTimeout',
  delayMs: RINGING_TIMEOUT_MS,
  event: { type: 'RINGING_TIMEOUT' },
};

const cancelRingingTimer: CallEffect = { type: 'cancelTimer', id: 'ringingTimeout' };

const startConnectingTimer: CallEffect = {
  type: 'startTimer',
  id: 'connectingTimeout',
  delayMs: CONNECTING_TIMEOUT_MS,
  event: { type: 'CONNECTING_TIMEOUT' },
};

const cancelConnectingTimer: CallEffect = { type: 'cancelTimer', id: 'connectingTimeout' };

/** Emit a parent event. */
const emitParent = (event: CallParentEvent): CallEffect =>
  ({ type: 'emit', event });

// ── Transition Function ───────────────────────────────────────────────────────

export function transition(state: CallState, event: CallEvent): [CallState, CallEffect[]] {
  switch (state._tag) {
    case 'ringing': {
      switch (event.type) {
        case 'ANSWER':
          return [
            { _tag: 'connecting', call: state.call, callId: state.callId, remotePeerId: state.remotePeerId, direction: state.direction },
            [
              cancelRingingTimer,
              startConnectingTimer,
              { type: 'fireAndForget', execute: () => state.call.answer(event.localStream) },
            ],
          ];

        case 'REJECT':
          return [
            { _tag: 'ended', callId: state.callId },
            [
              cancelRingingTimer,
              stopCallListener,
              { type: 'fireAndForget', execute: () => state.call.close() },
              emitParent({ type: 'CALL_ENDED', callId: state.callId }),
            ],
          ];

        case 'CALL_CLOSE':
          // Caller hung up before we answered
          return [
            { _tag: 'ended', callId: state.callId },
            [
              cancelRingingTimer,
              stopCallListener,
              emitParent({ type: 'CALL_ENDED', callId: state.callId }),
            ],
          ];

        case 'CALL_ERROR':
          return [
            { _tag: 'error', callId: state.callId, error: event.error },
            [
              cancelRingingTimer,
              stopCallListener,
              emitParent({ type: 'CALL_ERROR_PARENT', callId: state.callId, error: event.error }),
            ],
          ];

        case 'RINGING_TIMEOUT':
          return [
            { _tag: 'ended', callId: state.callId },
            [
              stopCallListener,
              { type: 'fireAndForget', execute: () => state.call.close() },
              emitParent({ type: 'CALL_ERROR_PARENT', callId: state.callId, error: new Error('Call timed out') as any }),
            ],
          ];

        default:
          return [state, []];
      }
    }

    case 'connecting': {
      switch (event.type) {
        case 'CALL_STREAM':
          return [
            { _tag: 'live', call: state.call, callId: state.callId, remotePeerId: state.remotePeerId, direction: state.direction, remoteStream: event.stream },
            [
              cancelConnectingTimer,
              emitParent({ type: 'CALL_ACTIVE', callId: state.callId, remotePeerId: state.remotePeerId, remoteStream: event.stream }),
            ],
          ];

        case 'HANG_UP':
          return [
            { _tag: 'ended', callId: state.callId },
            [
              cancelConnectingTimer,
              stopCallListener,
              { type: 'fireAndForget', execute: () => state.call.close() },
              emitParent({ type: 'CALL_ENDED', callId: state.callId }),
            ],
          ];

        case 'CALL_CLOSE':
          return [
            { _tag: 'ended', callId: state.callId },
            [
              cancelConnectingTimer,
              stopCallListener,
              emitParent({ type: 'CALL_ENDED', callId: state.callId }),
            ],
          ];

        case 'CALL_ERROR':
          return [
            { _tag: 'error', callId: state.callId, error: event.error },
            [
              cancelConnectingTimer,
              stopCallListener,
              emitParent({ type: 'CALL_ERROR_PARENT', callId: state.callId, error: event.error }),
            ],
          ];

        case 'CONNECTING_TIMEOUT':
          return [
            { _tag: 'error', callId: state.callId, error: new Error('Call timed out') as any },
            [
              stopCallListener,
              { type: 'fireAndForget', execute: () => state.call.close() },
              emitParent({ type: 'CALL_ERROR_PARENT', callId: state.callId, error: new Error('Call timed out') as any }),
            ],
          ];

        default:
          return [state, []];
      }
    }

    case 'live': {
      switch (event.type) {
        case 'HANG_UP':
          return [
            { _tag: 'ended', callId: state.callId },
            [
              stopCallListener,
              { type: 'fireAndForget', execute: () => state.call.close() },
              emitParent({ type: 'CALL_ENDED', callId: state.callId }),
            ],
          ];

        case 'CALL_CLOSE':
          // Remote peer hung up
          return [
            { _tag: 'ended', callId: state.callId },
            [
              stopCallListener,
              emitParent({ type: 'CALL_ENDED', callId: state.callId }),
            ],
          ];

        case 'CALL_ERROR':
          return [
            { _tag: 'error', callId: state.callId, error: event.error },
            [
              stopCallListener,
              emitParent({ type: 'CALL_ERROR_PARENT', callId: state.callId, error: event.error }),
            ],
          ];

        default:
          return [state, []];
      }
    }

    // Terminal states — no transitions
    case 'ended':
    case 'error':
      return [state, []];
  }
}

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
