import type { DataConnection } from 'peerjs';
import type { ConnectionEffect, ConnectionParentEvent } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const CONNECTION_TIMEOUT_MS = 15_000;

// ── Listener ──────────────────────────────────────────────────────────────────

/** Start listening to PeerJS DataConnection events. */
export function startConnectionListener(connection: DataConnection): ConnectionEffect {
  return {
    type: 'startSubscription',
    id: 'connectionEvents',
    subscribe: (send) => {
      connection.on('open', () => send({ type: 'CONNECTION_OPEN' }));
      connection.on('data', (data) => send({ type: 'CONNECTION_DATA', data }));
      connection.on('close', () => send({ type: 'CONNECTION_CLOSE' }));
      connection.on('error', (error) => send({ type: 'CONNECTION_ERROR', error }));

      return () => {
        // PeerJS does not support removeListener — teardown is via connection.close()
      };
    },
  };
}

export const stopConnectionListener: ConnectionEffect = {
  type: 'stopSubscription',
  id: 'connectionEvents',
};

// ── Timers ────────────────────────────────────────────────────────────────────

export const startTimeoutTimer: ConnectionEffect = {
  type: 'startTimer',
  id: 'connectionTimeout',
  delayMs: CONNECTION_TIMEOUT_MS,
  event: { type: 'CONNECTION_TIMEOUT' },
};

export const cancelTimeoutTimer: ConnectionEffect = {
  type: 'cancelTimer',
  id: 'connectionTimeout',
};

// ── Emit ──────────────────────────────────────────────────────────────────────

/** Emit a parent event (the peer machine picks these up). */
export const emitParent = (event: ConnectionParentEvent): ConnectionEffect =>
  ({ type: 'emit', event });

// ── Connection Actions ────────────────────────────────────────────────────────

/** Close a data connection. */
export const closeConnection = (connection: DataConnection): ConnectionEffect => ({
  type: 'fireAndForget',
  execute: () => connection.close(),
});

/** Send data over a data connection. */
export const sendData = (connection: DataConnection, data: unknown): ConnectionEffect => ({
  type: 'fireAndForget',
  execute: () => connection.send(data),
});
