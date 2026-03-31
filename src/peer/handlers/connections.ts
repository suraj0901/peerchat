import type { DataConnection } from 'peerjs';
import { createMachine } from '../../core';
import {
  transition as connectionTransition,
  initialEffects as connectionInitialEffects,
} from '../../connection/transitions';
import type { ConnectionState, ConnectionEvent, ConnectionParentEvent } from '../../connection/types';
import type {
  PeerState,
  PeerReady,
  PeerEvent,
  PeerEffect,
  ConnectionChild,
} from '../types';
import { emit } from '../effects';

// ── Child Spawning ────────────────────────────────────────────────────────────

/** Create a connection child machine and wire its parent events. */
function spawnConnectionChild(
  connection: DataConnection,
  connectionId: string,
  remotePeerId: string,
  parentSend: (event: PeerEvent) => void,
): ConnectionChild {
  const initialState: ConnectionState = {
    _tag: 'connecting',
    connection,
    connectionId,
    remotePeerId,
  };

  const child = createMachine<ConnectionState, ConnectionEvent, ConnectionParentEvent>(
    connectionTransition,
    initialState,
    connectionInitialEffects(connection),
    {
      open: (s) => [{ type: 'fireAndForget', execute: () => parentSend({ type: 'CHILD_CONNECTION_OPENED', connectionId: s.connectionId, remotePeerId: s.remotePeerId }) }],
      closed: (s) => [{ type: 'fireAndForget', execute: () => parentSend({ type: 'CHILD_CONNECTION_CLOSED', connectionId: s.connectionId }) }],
      error: (s) => [{ type: 'fireAndForget', execute: () => parentSend({ type: 'CHILD_CONNECTION_ERROR', connectionId: s.connectionId, error: s.error }) }],
    }
  );

  // Route child emitted events to parent that happen within a state (not on entry)
  child.on('CONNECTION_DATA_RECEIVED', (e) =>
    parentSend({ type: 'CHILD_CONNECTION_DATA', connectionId: e.connectionId, data: e.data }));

  return child;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Remove a connection child, destroying it and returning updated state + effects. */
function removeConnection(
  state: PeerReady,
  connectionId: string,
  emitEvent: PeerEffect,
): [PeerState, PeerEffect[]] {
  const child = state.connections.get(connectionId);
  if (child) child.destroy();
  const newConnections = new Map(state.connections);
  newConnections.delete(connectionId);
  return [{ ...state, connections: newConnections }, [emitEvent]];
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handles all connection-related events in the `ready` state.
 * Returns `null` if the event is not connection-related.
 */
export function handleConnectionEvent(
  state: PeerReady,
  event: PeerEvent,
  parentSend: (event: PeerEvent) => void,
): [PeerState, PeerEffect[]] | null {
  switch (event.type) {
    case 'PEER_CONNECTION': {
      const conn = event.connection;
      const child = spawnConnectionChild(conn, conn.connectionId, conn.peer, parentSend);
      const newConnections = new Map(state.connections);
      newConnections.set(conn.connectionId, child);
      return [{ ...state, connections: newConnections }, []];
    }

    case 'CONNECT_TO': {
      // Guard: prevent duplicate connections
      for (const child of state.connections.values()) {
        const childState = child.getState();
        if ((childState._tag === 'connecting' || childState._tag === 'open') &&
          childState.remotePeerId === event.remotePeerId) {
          return [state, []]; // Duplicate — ignore
        }
      }
      const connection = state.peer.connect(event.remotePeerId);
      const child = spawnConnectionChild(connection, connection.connectionId, event.remotePeerId, parentSend);
      const newConnections = new Map(state.connections);
      newConnections.set(connection.connectionId, child);
      return [{ ...state, connections: newConnections }, []];
    }

    case 'SEND': {
      const child = state.connections.get(event.connectionId);
      if (child) child.send({ type: 'SEND', data: event.data });
      return [state, []];
    }

    case 'CLOSE_CONNECTION': {
      const child = state.connections.get(event.connectionId);
      if (child) child.send({ type: 'CLOSE' });
      return [state, []];
    }

    case 'CHILD_CONNECTION_OPENED':
      return [state, [emit({ type: 'connection.opened', connectionId: event.connectionId, remotePeerId: event.remotePeerId })]];

    case 'CHILD_CONNECTION_CLOSED':
      return removeConnection(state, event.connectionId,
        emit({ type: 'connection.closed', connectionId: event.connectionId }));

    case 'CHILD_CONNECTION_ERROR':
      return removeConnection(state, event.connectionId,
        emit({ type: 'connection.error', connectionId: event.connectionId, error: event.error }));

    case 'CHILD_CONNECTION_DATA':
      return [state, [emit({ type: 'connection.data', connectionId: event.connectionId, data: event.data })]];

    default:
      return null; // Not a connection event
  }
}
