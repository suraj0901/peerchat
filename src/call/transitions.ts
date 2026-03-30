import type { MediaConnection } from 'peerjs';
import { assertNever } from '../core';
import type {
  CallState,
  CallEvent,
  CallEffect,
  CallDirection,
} from './types';
import {
  startCallListener,
  stopCallListener,
  startRingingTimer,
  cancelRingingTimer,
  startConnectingTimer,
  cancelConnectingTimer,
  emitParent,
} from './effects';

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

        case 'RINGING_TIMEOUT': {
          const timeoutError = new Error('Call timed out');
          return [
            { _tag: 'ended', callId: state.callId },
            [
              stopCallListener,
              { type: 'fireAndForget', execute: () => state.call.close() },
              emitParent({ type: 'CALL_ERROR_PARENT', callId: state.callId, error: timeoutError }),
            ],
          ];
        }

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

        case 'CONNECTING_TIMEOUT': {
          const timeoutError = new Error('Call timed out');
          return [
            { _tag: 'error', callId: state.callId, error: timeoutError },
            [
              stopCallListener,
              { type: 'fireAndForget', execute: () => state.call.close() },
              emitParent({ type: 'CALL_ERROR_PARENT', callId: state.callId, error: timeoutError }),
            ],
          ];
        }

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

    default:
      return assertNever(state);
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
