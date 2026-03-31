import type { DataConnection } from 'peerjs';
import { createTransitionFn } from '../core';
import type { TransitionTable } from '../core';
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
  closeConnection,
  sendData,
} from './effects';

// ── Transition Table ──────────────────────────────────────────────────────────

const table: TransitionTable<ConnectionState, ConnectionEvent> = {
  connecting: {
    CONNECTION_OPEN: {
      target: 'open',
      effects: [cancelTimeoutTimer],
    },
    CONNECTION_CLOSE: {
      target: 'closed',
      data: (s) => ({ connectionId: s.connectionId }),
      effects: [cancelTimeoutTimer, stopConnectionListener],
    },
    CONNECTION_ERROR: {
      target: 'error',
      data: (s, e) => ({ connectionId: s.connectionId, error: e.error }),
      effects: [cancelTimeoutTimer, stopConnectionListener],
    },
    CONNECTION_TIMEOUT: {
      target: 'error',
      data: (s) => ({ connectionId: s.connectionId, error: new Error('Connection timed out') }),
      effects: (s) => [stopConnectionListener, closeConnection(s.connection)],
    },
  },

  open: {
    SEND: {
      effects: (s, e) => [sendData(s.connection, e.data)],
    },
    CLOSE: {
      target: 'closed',
      data: (s) => ({ connectionId: s.connectionId }),
      effects: (s) => [stopConnectionListener, closeConnection(s.connection)],
    },
    CONNECTION_DATA: {
      effects: (s, e) => [emitParent({ type: 'CONNECTION_DATA_RECEIVED', connectionId: s.connectionId, data: e.data })],
    },
    CONNECTION_CLOSE: {
      target: 'closed',
      data: (s) => ({ connectionId: s.connectionId }),
      effects: [stopConnectionListener],
    },
    CONNECTION_ERROR: {
      target: 'error',
      data: (s, e) => ({ connectionId: s.connectionId, error: e.error }),
      effects: [stopConnectionListener],
    },
  },

  // Terminal states — no transitions
  closed: {},
  error: {},
};

// ── Compiled Transition Function ──────────────────────────────────────────────

export const transition = createTransitionFn<ConnectionState, ConnectionEvent>(table);

/**
 * Returns the initial effects to run when a connection machine starts.
 */
export function initialEffects(connection: DataConnection): ConnectionEffect[] {
  return [
    startConnectionListener(connection),
    startTimeoutTimer,
  ];
}
