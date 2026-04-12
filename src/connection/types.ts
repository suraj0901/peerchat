import type { PeerError } from 'peerjs';
import type { ConnectionState } from './state';

export type ConnectionEmittedEvent =
  | { type: 'connection.opened'; connectionId: string; remotePeerId: string }
  | { type: 'connection.closed'; connectionId: string }
  | { type: 'connection.error'; connectionId: string; error: Error | PeerError<string> }
  | { type: 'connection.data'; connectionId: string; data: unknown };

/**
 * Immutable snapshot of a connection's essential information.
 * Returned by `PeerManager.getActiveConnections()`.
 */
export interface ConnectionInfo {
  connectionId: string;
  remotePeerId: string;
  state: ConnectionState['_tag'];
}