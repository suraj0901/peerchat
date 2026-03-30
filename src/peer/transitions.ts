import type { Peer, DataConnection, MediaConnection, PeerError } from 'peerjs';
import { createMachine, type Machine } from '../core';
import {
  transition as connectionTransition,
  initialEffects as connectionInitialEffects,
} from '../connection/transitions';
import type { ConnectionState, ConnectionEvent, ConnectionParentEvent } from '../connection/types';
import {
  transition as callTransition,
  initialEffects as callInitialEffects,
} from '../call/transitions';
import type { CallState, CallEvent, CallParentEvent } from '../call/types';
import type {
  PeerState,
  PeerEvent,
  PeerEffect,
  PeerEmittedEvent,
  ConnectionChild,
  CallChild,
} from './types';
import { isFatalError } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Emit a PeerEmittedEvent. */
const emit = (event: PeerEmittedEvent): PeerEffect =>
  ({ type: 'emit', event });

/** Start listening to PeerJS Peer events. */
function startPeerListener(peer: Peer): PeerEffect {
  return {
    type: 'startSubscription',
    id: 'peerEvents',
    subscribe: (send) => {
      peer.on('open', (id) => send({ type: 'PEER_OPEN', id }));
      peer.on('connection', (connection: DataConnection) =>
        send({ type: 'PEER_CONNECTION', connection }));
      peer.on('call', (call: MediaConnection) =>
        send({ type: 'PEER_CALL', call }));
      peer.on('disconnected', () => send({ type: 'PEER_DISCONNECTED' }));
      peer.on('error', (error: PeerError<string>) =>
        send({ type: 'PEER_ERROR', error }));
      peer.on('close', () => send({ type: 'PEER_CLOSE' }));

      return () => {
        // PeerJS does not support removeListener — teardown is via peer.destroy()
      };
    },
  };
}

const stopPeerListener: PeerEffect = { type: 'stopSubscription', id: 'peerEvents' };

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
  );

  // Route child emitted events to parent
  child.on('CONNECTION_OPENED', (e) =>
    parentSend({ type: 'CHILD_CONNECTION_OPENED', connectionId: e.connectionId, remotePeerId: e.remotePeerId }));
  child.on('CONNECTION_CLOSED', (e) =>
    parentSend({ type: 'CHILD_CONNECTION_CLOSED', connectionId: e.connectionId }));
  child.on('CONNECTION_ERROR_PARENT', (e) =>
    parentSend({ type: 'CHILD_CONNECTION_ERROR', connectionId: e.connectionId, error: e.error }));
  child.on('CONNECTION_DATA_RECEIVED', (e) =>
    parentSend({ type: 'CHILD_CONNECTION_DATA', connectionId: e.connectionId, data: e.data }));

  return child;
}

/** Create a call child machine and wire its parent events. */
function spawnCallChild(
  call: MediaConnection,
  callId: string,
  remotePeerId: string,
  direction: 'inbound' | 'outbound',
  parentSend: (event: PeerEvent) => void,
): CallChild {
  const initialState: CallState = direction === 'inbound'
    ? { _tag: 'ringing', call, callId, remotePeerId, direction: 'inbound' }
    : { _tag: 'connecting', call, callId, remotePeerId, direction: 'outbound' };

  const child = createMachine<CallState, CallEvent, CallParentEvent>(
    callTransition,
    initialState,
    callInitialEffects(call, direction),
  );

  // Route child emitted events to parent
  child.on('CALL_ACTIVE', (e) =>
    parentSend({ type: 'CHILD_CALL_ACTIVE', callId: e.callId, remotePeerId: e.remotePeerId, remoteStream: e.remoteStream }));
  child.on('CALL_ENDED', (e) =>
    parentSend({ type: 'CHILD_CALL_ENDED', callId: e.callId }));
  child.on('CALL_ERROR_PARENT', (e) =>
    parentSend({ type: 'CHILD_CALL_ERROR', callId: e.callId, error: e.error }));

  return child;
}

/** Clean up all child machines. */
function cleanupAllChildren(
  connections: Map<string, ConnectionChild>,
  calls: Map<string, CallChild>,
): PeerEffect {
  return {
    type: 'fireAndForget',
    execute: () => {
      for (const child of connections.values()) {
        try { child.send({ type: 'CLOSE' }); } catch { /* may already be stopped */ }
        child.destroy();
      }
      for (const child of calls.values()) {
        try { child.send({ type: 'HANG_UP' }); } catch { /* may already be stopped */ }
        child.destroy();
      }
    },
  };
}

/** Calculate reconnect delay with exponential backoff. */
function reconnectDelay(retryCount: number, baseDelay: number): number {
  return Math.min(baseDelay * 2 ** retryCount, 30_000);
}

// ── Transition Function ───────────────────────────────────────────────────────

/**
 * Pure transition function for the peer state machine.
 *
 * Note: This transition function is mostly pure, but connection/call child
 * machines are created as imperative side effects within `spawnConnectionChild`
 * and `spawnCallChild`. This is a pragmatic trade-off — extracting child
 * machine creation into effects would add complexity without meaningful benefit,
 * since the child machines are internal implementation details.
 *
 * The `parentSend` parameter is injected via a closure in `createPeerManager`.
 */
export function createPeerTransition(parentSend: (event: PeerEvent) => void) {
  return function transition(state: PeerState, event: PeerEvent): [PeerState, PeerEffect[]] {
    // ── Global: PEER_CLOSE handled in all alive states ──────────────────
    if (event.type === 'PEER_CLOSE') {
      if (state._tag === 'initializing' || state._tag === 'ready' || state._tag === 'disconnected') {
        const effects: PeerEffect[] = [stopPeerListener];
        if (state._tag === 'ready' || state._tag === 'disconnected') {
          effects.push(cleanupAllChildren(state.connections, state.calls));
        }
        if (state._tag === 'disconnected') {
          effects.push({ type: 'cancelTimer', id: 'reconnect' });
        }
        return [{ _tag: 'destroyed' }, effects];
      }
      // Already in terminal state — ignore
      return [state, []];
    }

    switch (state._tag) {
      case 'initializing': {
        switch (event.type) {
          case 'PEER_OPEN':
            return [
              {
                _tag: 'ready',
                peer: state.peer,
                peerId: event.id,
                connections: new Map(),
                calls: new Map(),
                maxRetries: state.maxRetries,
                baseRetryDelay: state.baseRetryDelay,
              },
              [emit({ type: 'peer.ready', peerId: event.id })],
            ];

          case 'PEER_ERROR':
            if (isFatalError(event.error)) {
              return [
                { _tag: 'error', lastError: event.error },
                [stopPeerListener, emit({ type: 'peer.error', error: event.error })],
              ];
            }
            return [state, [emit({ type: 'peer.error', error: event.error })]];

          default:
            return [state, []];
        }
      }

      case 'ready': {
        switch (event.type) {
          // ── Data connections ─────────────────────────────────────────
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

          case 'CHILD_CONNECTION_CLOSED': {
            const child = state.connections.get(event.connectionId);
            if (child) child.destroy();
            const newConnections = new Map(state.connections);
            newConnections.delete(event.connectionId);
            return [{ ...state, connections: newConnections }, [emit({ type: 'connection.closed', connectionId: event.connectionId })]];
          }

          case 'CHILD_CONNECTION_ERROR': {
            const child = state.connections.get(event.connectionId);
            if (child) child.destroy();
            const newConnections = new Map(state.connections);
            newConnections.delete(event.connectionId);
            return [{ ...state, connections: newConnections }, [emit({ type: 'connection.error', connectionId: event.connectionId, error: event.error })]];
          }

          case 'CHILD_CONNECTION_DATA':
            return [state, [emit({ type: 'connection.data', connectionId: event.connectionId, data: event.data })]];

          // ── Media calls ─────────────────────────────────────────────
          case 'PEER_CALL': {
            const call = event.call;
            const callId = call.connectionId;
            const child = spawnCallChild(call, callId, call.peer, 'inbound', parentSend);
            const newCalls = new Map(state.calls);
            newCalls.set(callId, child);
            return [
              { ...state, calls: newCalls },
              [emit({ type: 'call.incoming', callId, remotePeerId: call.peer })],
            ];
          }

          case 'CALL': {
            // Guard: prevent duplicate calls
            for (const child of state.calls.values()) {
              const childState = child.getState();
              if ((childState._tag === 'ringing' || childState._tag === 'connecting' || childState._tag === 'live') &&
                  childState.remotePeerId === event.remotePeerId) {
                return [state, []]; // Duplicate — ignore
              }
            }
            const call = state.peer.call(event.remotePeerId, event.localStream);
            const callId = call.connectionId;
            const child = spawnCallChild(call, callId, event.remotePeerId, 'outbound', parentSend);
            const newCalls = new Map(state.calls);
            newCalls.set(callId, child);
            return [{ ...state, calls: newCalls }, []];
          }

          case 'ANSWER_CALL': {
            const child = state.calls.get(event.callId);
            if (child) child.send({ type: 'ANSWER', localStream: event.localStream });
            return [state, []];
          }

          case 'REJECT_CALL': {
            const child = state.calls.get(event.callId);
            if (child) child.send({ type: 'REJECT' });
            return [state, []];
          }

          case 'HANG_UP': {
            const child = state.calls.get(event.callId);
            if (child) child.send({ type: 'HANG_UP' });
            return [state, []];
          }

          case 'CHILD_CALL_ACTIVE':
            return [state, [emit({ type: 'call.active', callId: event.callId, remotePeerId: event.remotePeerId, remoteStream: event.remoteStream })]];

          case 'CHILD_CALL_ENDED': {
            const child = state.calls.get(event.callId);
            if (child) child.destroy();
            const newCalls = new Map(state.calls);
            newCalls.delete(event.callId);
            return [{ ...state, calls: newCalls }, [emit({ type: 'call.ended', callId: event.callId })]];
          }

          case 'CHILD_CALL_ERROR': {
            const child = state.calls.get(event.callId);
            if (child) child.destroy();
            const newCalls = new Map(state.calls);
            newCalls.delete(event.callId);
            return [{ ...state, calls: newCalls }, [emit({ type: 'call.error', callId: event.callId, error: event.error })]];
          }

          // ── Signaling server ────────────────────────────────────────
          case 'PEER_DISCONNECTED':
            return [
              {
                _tag: 'disconnected',
                peer: state.peer,
                peerId: state.peerId,
                connections: state.connections,
                calls: state.calls,
                retryCount: 0,
                maxRetries: state.maxRetries,
                baseRetryDelay: state.baseRetryDelay,
              },
              [
                emit({ type: 'peer.disconnected' }),
                // Start auto-reconnect timer
                {
                  type: 'startTimer',
                  id: 'reconnect',
                  delayMs: reconnectDelay(0, state.baseRetryDelay),
                  event: { type: 'RECONNECT_TIMER_FIRED' },
                },
              ],
            ];

          // ── Errors ──────────────────────────────────────────────────
          case 'PEER_ERROR':
            if (isFatalError(event.error)) {
              return [
                { _tag: 'error', lastError: event.error },
                [
                  stopPeerListener,
                  cleanupAllChildren(state.connections, state.calls),
                  emit({ type: 'peer.error', error: event.error }),
                ],
              ];
            }
            return [state, [emit({ type: 'peer.error', error: event.error })]];

          // ── Teardown ────────────────────────────────────────────────
          case 'DESTROY':
            return [
              { _tag: 'destroyed' },
              [
                stopPeerListener,
                cleanupAllChildren(state.connections, state.calls),
                { type: 'fireAndForget', execute: () => state.peer.destroy() },
              ],
            ];

          default:
            return [state, []];
        }
      }

      case 'disconnected': {
        switch (event.type) {
          case 'RECONNECT_TIMER_FIRED': {
            if (state.retryCount >= state.maxRetries) {
              return [state, []]; // Exhausted retries
            }
            return [
              { _tag: 'initializing', peer: state.peer, maxRetries: state.maxRetries, baseRetryDelay: state.baseRetryDelay },
              [
                cleanupAllChildren(state.connections, state.calls),
                { type: 'fireAndForget', execute: () => state.peer.reconnect() },
              ],
            ];
          }

          case 'RECONNECT':
            return [
              { _tag: 'initializing', peer: state.peer, maxRetries: state.maxRetries, baseRetryDelay: state.baseRetryDelay },
              [
                { type: 'cancelTimer', id: 'reconnect' },
                cleanupAllChildren(state.connections, state.calls),
                { type: 'fireAndForget', execute: () => state.peer.reconnect() },
              ],
            ];

          case 'PEER_ERROR':
            return [state, [emit({ type: 'peer.error', error: event.error })]];

          case 'DESTROY':
            return [
              { _tag: 'destroyed' },
              [
                { type: 'cancelTimer', id: 'reconnect' },
                stopPeerListener,
                cleanupAllChildren(state.connections, state.calls),
                { type: 'fireAndForget', execute: () => state.peer.destroy() },
              ],
            ];

          default:
            return [state, []];
        }
      }

      // Terminal states — no transitions
      case 'error':
      case 'destroyed':
        return [state, []];
    }
  };
}
