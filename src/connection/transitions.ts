import type { DataConnection } from 'peerjs';
import type {
  ConnectionState,
  ConnectionEvent,
  ConnectionEffect,
  ConnectionParentEvent,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const CONNECTION_TIMEOUT_MS = 15_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Start listening to PeerJS DataConnection events. */
function startConnectionListener(connection: DataConnection): ConnectionEffect {
  return {
    type: 'startSubscription',
    id: 'connectionEvents',
    subscribe: (send) => {
      connection.on('open', () => send({ type: 'CONNECTION_OPEN' }));
      connection.on('data', (data) => send({ type: 'CONNECTION_DATA', data }));
      connection.on('close', () => send({ type: 'CONNECTION_CLOSE' }));
      connection.on('error', (error: any) => send({ type: 'CONNECTION_ERROR', error }));

      return () => {
        // PeerJS does not support removeListener — teardown is via connection.close()
      };
    },
  };
}

const stopConnectionListener: ConnectionEffect = { type: 'stopSubscription', id: 'connectionEvents' };

const startTimeoutTimer: ConnectionEffect = {
  type: 'startTimer',
  id: 'connectionTimeout',
  delayMs: CONNECTION_TIMEOUT_MS,
  event: { type: 'CONNECTION_TIMEOUT' },
};

const cancelTimeoutTimer: ConnectionEffect = { type: 'cancelTimer', id: 'connectionTimeout' };

/** Emit a parent event (the peer machine picks these up). */
const emitParent = (event: ConnectionParentEvent): ConnectionEffect =>
  ({ type: 'emit', event });

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

        case 'CONNECTION_TIMEOUT':
          return [
            { _tag: 'error', connectionId: state.connectionId, error: new Error('Connection timed out') as any },
            [
              stopConnectionListener,
              { type: 'fireAndForget', execute: () => state.connection.close() },
              emitParent({ type: 'CONNECTION_ERROR_PARENT', connectionId: state.connectionId, error: new Error('Connection timed out') as any }),
            ],
          ];

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
