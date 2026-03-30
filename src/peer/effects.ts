import type { ConnectionChild, CallChild, PeerEffect, PeerEmittedEvent } from './types';

// ── Emit ──────────────────────────────────────────────────────────────────────

/** Emit a PeerEmittedEvent. */
export const emit = (event: PeerEmittedEvent): PeerEffect =>
  ({ type: 'emit', event });

// ── Subscription ──────────────────────────────────────────────────────────────

export const stopPeerListener: PeerEffect = {
  type: 'stopSubscription',
  id: 'peerEvents',
};

// ── Child Cleanup ─────────────────────────────────────────────────────────────

/** Clean up all child machines. */
export function cleanupAllChildren(
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

// ── Reconnect ─────────────────────────────────────────────────────────────────

/** Calculate reconnect delay with exponential backoff. */
export function reconnectDelay(retryCount: number, baseDelay: number): number {
  return Math.min(baseDelay * 2 ** retryCount, 30_000);
}
