import type { Peer, PeerError, DataConnection, MediaConnection } from 'peerjs';
import type { Effect } from '../core/types';
import type { Machine } from '../core/runtime';
import type { ConnectionState, ConnectionEvent, ConnectionParentEvent } from '../connection/types';
import type { CallState, CallEvent, CallParentEvent } from '../call/types';

// ── Child Machine Types ───────────────────────────────────────────────────────

export type ConnectionChild = Machine<ConnectionState, ConnectionEvent, ConnectionParentEvent>;
export type CallChild = Machine<CallState, CallEvent, CallParentEvent>;

// ── Peer State (Discriminated Union) ──────────────────────────────────────────

export type PeerState =
  | PeerInitializing
  | PeerReady
  | PeerDisconnected
  | PeerErrorState
  | PeerDestroyed;

export type PeerInitializing = {
  readonly _tag: 'initializing';
  readonly peer: Peer;
  readonly maxRetries: number;
  readonly baseRetryDelay: number;
};

/**
 * `peerId` is `string` — not `string | null`.
 * It only exists in states where it's been assigned.
 */
export type PeerReady = {
  readonly _tag: 'ready';
  readonly peer: Peer;
  readonly peerId: string;
  readonly connections: Map<string, ConnectionChild>;
  readonly calls: Map<string, CallChild>;
  readonly maxRetries: number;
  readonly baseRetryDelay: number;
};

export type PeerDisconnected = {
  readonly _tag: 'disconnected';
  readonly peer: Peer;
  readonly peerId: string;
  readonly connections: Map<string, ConnectionChild>;
  readonly calls: Map<string, CallChild>;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly baseRetryDelay: number;
};

export type PeerErrorState = {
  readonly _tag: 'error';
  readonly lastError: PeerError<string>;
};

export type PeerDestroyed = {
  readonly _tag: 'destroyed';
};

// ── Events ────────────────────────────────────────────────────────────────────

/** Internal events from PeerJS. */
export type PeerCallbackEvent =
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEER_CONNECTION'; connection: DataConnection }
  | { type: 'PEER_CALL'; call: MediaConnection }
  | { type: 'PEER_DISCONNECTED' }
  | { type: 'PEER_ERROR'; error: PeerError<string> }
  | { type: 'PEER_CLOSE' }
  | { type: 'RECONNECT_TIMER_FIRED' };

/** Child machine events bubbled up to the peer machine. */
export type ChildEvent =
  | { type: 'CHILD_CONNECTION_OPENED'; connectionId: string; remotePeerId: string }
  | { type: 'CHILD_CONNECTION_CLOSED'; connectionId: string }
  | { type: 'CHILD_CONNECTION_ERROR'; connectionId: string; error: Error | PeerError<string> }
  | { type: 'CHILD_CONNECTION_DATA'; connectionId: string; data: unknown }
  | { type: 'CHILD_CALL_ACTIVE'; callId: string; remotePeerId: string; remoteStream: MediaStream }
  | { type: 'CHILD_CALL_ENDED'; callId: string }
  | { type: 'CHILD_CALL_ERROR'; callId: string; error: Error | PeerError<string> };

/** Commands sent by external callers. */
export type PeerCommand =
  | { type: 'CONNECT_TO'; remotePeerId: string }
  | { type: 'SEND'; connectionId: string; data: unknown }
  | { type: 'CLOSE_CONNECTION'; connectionId: string }
  | { type: 'CALL'; remotePeerId: string; localStream: MediaStream }
  | { type: 'ANSWER_CALL'; callId: string; localStream: MediaStream }
  | { type: 'REJECT_CALL'; callId: string }
  | { type: 'HANG_UP'; callId: string }
  | { type: 'RECONNECT' }
  | { type: 'DESTROY' };

export type PeerEvent = PeerCallbackEvent | ChildEvent | PeerCommand;

// ── Emitted Events ────────────────────────────────────────────────────────────

export type PeerEmittedEvent =
  | { type: 'peer.ready'; peerId: string }
  | { type: 'peer.disconnected' }
  | { type: 'peer.error'; error: PeerError<string> }
  | { type: 'connection.opened'; connectionId: string; remotePeerId: string }
  | { type: 'connection.closed'; connectionId: string }
  | { type: 'connection.error'; connectionId: string; error: Error | PeerError<string> }
  | { type: 'connection.data'; connectionId: string; data: unknown }
  | { type: 'call.incoming'; callId: string; remotePeerId: string }
  | { type: 'call.active'; callId: string; remotePeerId: string; remoteStream: MediaStream }
  | { type: 'call.ended'; callId: string }
  | { type: 'call.error'; callId: string; error: Error | PeerError<string> };

// ── Effects ───────────────────────────────────────────────────────────────────

export type PeerEffect = Effect<PeerEvent>;

// ── Fatal Errors ──────────────────────────────────────────────────────────────

export const FATAL_PEER_ERROR_TYPES = [
  'browser-incompatible',
  'invalid-id',
  'invalid-key',
  'ssl-unavailable',
  'server-error',
  'socket-error',
  'socket-closed',
  'unavailable-id',
] as const;

export type FatalPeerErrorType = (typeof FATAL_PEER_ERROR_TYPES)[number];

export const isFatalError = (error: PeerError<string>): boolean =>
  (FATAL_PEER_ERROR_TYPES as ReadonlyArray<string>).includes(error.type);

// ── Input ─────────────────────────────────────────────────────────────────────

export type PeerInput = {
  peer: Peer;
  maxRetries?: number;
  baseRetryDelay?: number;
};
