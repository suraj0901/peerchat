import { assertNever } from '../core';
import type {
  PeerState,
  PeerEvent,
  PeerEffect,
} from './types';
import { isFatalError } from './types';
import { emit, stopPeerListener, cleanupAllChildren, reconnectDelay } from './effects';
import { handleConnectionEvent } from './handlers/connections';
import { handleCallEvent } from './handlers/calls';
import { handleLifecycleEvent } from './handlers/lifecycle';

// ── Transition Function ───────────────────────────────────────────────────────

/**
 * Pure transition function for the peer state machine.
 *
 * The `ready` state delegates to domain-specific handlers (connections,
 * calls, lifecycle) — each in its own module with a single responsibility.
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
        return handleConnectionEvent(state, event, parentSend)
            ?? handleCallEvent(state, event, parentSend)
            ?? handleLifecycleEvent(state, event)
            ?? [state, []];
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

      default:
        return assertNever(state);
    }
  };
}
