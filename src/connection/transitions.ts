import type { DataConnection } from 'peerjs';
import { assertNever } from '../core';
import type {
  ConnectionState,
  ConnectionEvent,
  ConnectionEffect,
} from './types';
import {
  startConnectionListener,
  startTimeoutTimer,
  cancelTimeoutTimer,
  stopConnectionListener,
  emitParent,
} from './effects';

// ── Transition Function ───────────────────────────────────────────────────────

export function transition(state: ConnectionState, event: ConnectionEvent): [ConnectionState, ConnectionEffect[]] {
  switch (state._tag) {
    case 'connecting': {
      switch (event.type) {
        case 'CONNECTION_OPEN':
          return [
            { _tag: 'open', connection: state.connection, connectionId: state.connectionId, remotePeerId: state.remotePeerId },
            [
              cancelTimeoutTimer,
              emitParent({ type: 'CONNECTION_OPENED', connectionId: state.connectionId, remotePeerId: state.remotePeerId }),
            ],
          ];

        case 'CONNECTION_CLOSE':
          return [
            { _tag: 'closed', connectionId: state.connectionId },
            [
              cancelTimeoutTimer,
              stopConnectionListener,
              emitParent({ type: 'CONNECTION_CLOSED', connectionId: state.connectionId }),
            ],
          ];

        case 'CONNECTION_ERROR':
          return [
            { _tag: 'error', connectionId: state.connectionId, error: event.error },
            [
              cancelTimeoutTimer,
              stopConnectionListener,
              emitParent({ type: 'CONNECTION_ERROR_PARENT', connectionId: state.connectionId, error: event.error }),
            ],
          ];

        case 'CONNECTION_TIMEOUT': {
          const timeoutError = new Error('Connection timed out');
          return [
            { _tag: 'error', connectionId: state.connectionId, error: timeoutError },
            [
              stopConnectionListener,
              { type: 'fireAndForget', execute: () => state.connection.close() },
              emitParent({ type: 'CONNECTION_ERROR_PARENT', connectionId: state.connectionId, error: timeoutError }),
            ],
          ];
        }

        default:
          return [state, []];
      }
    }

    case 'open': {
      switch (event.type) {
        case 'SEND':
          return [
            state,
            [{ type: 'fireAndForget', execute: () => state.connection.send(event.data) }],
          ];

        case 'CLOSE':
          return [
            { _tag: 'closed', connectionId: state.connectionId },
            [
              stopConnectionListener,
              { type: 'fireAndForget', execute: () => state.connection.close() },
              emitParent({ type: 'CONNECTION_CLOSED', connectionId: state.connectionId }),
            ],
          ];

        case 'CONNECTION_DATA':
          return [
            state,
            [emitParent({ type: 'CONNECTION_DATA_RECEIVED', connectionId: state.connectionId, data: event.data })],
          ];

        case 'CONNECTION_CLOSE':
          return [
            { _tag: 'closed', connectionId: state.connectionId },
            [
              stopConnectionListener,
              emitParent({ type: 'CONNECTION_CLOSED', connectionId: state.connectionId }),
            ],
          ];

        case 'CONNECTION_ERROR':
          return [
            { _tag: 'error', connectionId: state.connectionId, error: event.error },
            [
              stopConnectionListener,
              emitParent({ type: 'CONNECTION_ERROR_PARENT', connectionId: state.connectionId, error: event.error }),
            ],
          ];

        default:
          return [state, []];
      }
    }

    // Terminal states — no transitions
    case 'closed':
    case 'error':
      return [state, []];

    default:
      return assertNever(state);
  }
}

/**
 * Returns the initial effects to run when a connection machine starts.
 */
export function initialEffects(connection: DataConnection): ConnectionEffect[] {
  return [
    startConnectionListener(connection),
    startTimeoutTimer,
  ];
}
