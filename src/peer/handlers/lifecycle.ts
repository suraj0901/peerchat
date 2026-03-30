import type {
  PeerState,
  PeerReady,
  PeerEvent,
  PeerEffect,
} from '../types';
import { isFatalError } from '../types';
import { emit, stopPeerListener, cleanupAllChildren } from '../effects';

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handles peer lifecycle events in the `ready` state:
 * signaling disconnection, fatal errors, and teardown.
 * Returns `null` if the event is not lifecycle-related.
 */
export function handleLifecycleEvent(
  state: PeerReady,
  event: PeerEvent,
): [PeerState, PeerEffect[]] | null {
  switch (event.type) {
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
            delayMs: state.baseRetryDelay,
            event: { type: 'RECONNECT_TIMER_FIRED' },
          },
        ],
      ];

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
      return null; // Not a lifecycle event
  }
}
