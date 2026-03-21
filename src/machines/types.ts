import type { DataConnection, MediaConnection, Peer, PeerError } from 'peerjs';
import type { ActorRefFrom } from 'xstate';
import type { connectionMachine } from './connectionMachine';
import type { callMachine } from './callMachine';

// ── Connection Machine ────────────────────────────────────────────────────────

export type ConnectionContext = {
  readonly connection: DataConnection;
  readonly connectionId: string;
  readonly remotePeerId: string;
};

export type ConnectionInput = ConnectionContext;

/** Events sent back from the PeerJS DataConnection event emitter. */
export type ConnectionCallbackEvent =
  | { type: 'CONNECTION_OPEN' }
  | { type: 'CONNECTION_DATA'; data: unknown }
  | { type: 'CONNECTION_CLOSE' }
  | { type: 'CONNECTION_ERROR'; error: PeerError<string> };

/** Commands sent into a connection actor from the peer machine or the caller. */
export type ConnectionCommand =
  | { type: 'SEND'; data: unknown }
  | { type: 'CLOSE' };

export type ConnectionEvent = ConnectionCallbackEvent | ConnectionCommand;

/**
 * Events sent upward from a connection actor to its parent peer machine via sendParent.
 * These are internal to the library — external consumers observe PeerEmittedEvent instead.
 */
export type ConnectionParentEvent =
  | { type: 'CONNECTION_ACTOR_OPENED'; connectionId: string; remotePeerId: string }
  | { type: 'CONNECTION_ACTOR_CLOSED'; connectionId: string }
  | { type: 'CONNECTION_ACTOR_ERROR'; connectionId: string; error: PeerError<string> }
  | { type: 'CONNECTION_ACTOR_DATA'; connectionId: string; data: unknown };

// ── Call Machine ──────────────────────────────────────────────────────────────

/**
 * Whether this call was initiated locally (outbound) or received (inbound).
 * Determines the initial sub-state: inbound starts in 'ringing' awaiting ANSWER
 * or REJECT; outbound skips straight to 'connecting'.
 */
export type CallDirection = 'inbound' | 'outbound';

export type CallContext = {
  readonly call: MediaConnection;
  readonly callId: string;
  readonly remotePeerId: string;
  readonly direction: CallDirection;
  /** Populated once the remote stream arrives (i.e. when the call enters 'live'). */
  remoteStream: MediaStream | null;
};

export type CallInput = {
  readonly call: MediaConnection;
  readonly callId: string;
  readonly remotePeerId: string;
  readonly direction: CallDirection;
};

/** Events sent back from the PeerJS MediaConnection event emitter. */
export type CallCallbackEvent =
  | { type: 'CALL_STREAM'; stream: MediaStream }
  | { type: 'CALL_CLOSE' }
  | { type: 'CALL_ERROR'; error: PeerError<string> };

/**
 * Commands sent into a call actor from the peer machine or the caller.
 *
 *   ANSWER   — inbound only; provide a local MediaStream to answer with.
 *   REJECT   — inbound only; hang up before answering (calls call.close()).
 *   HANG_UP  — either direction; ends a live or connecting call.
 */
export type CallCommand =
  | { type: 'ANSWER'; localStream: MediaStream }
  | { type: 'REJECT' }
  | { type: 'HANG_UP' };

export type CallEvent = CallCallbackEvent | CallCommand;

/**
 * Events sent upward from a call actor to its parent peer machine via sendParent.
 * These are internal to the library — external consumers observe PeerEmittedEvent instead.
 */
export type CallParentEvent =
  | { type: 'CALL_ACTOR_ACTIVE'; callId: string; remotePeerId: string; remoteStream: MediaStream }
  | { type: 'CALL_ACTOR_ENDED'; callId: string }
  | { type: 'CALL_ACTOR_ERROR'; callId: string; error: PeerError<string> };

// ── Peer Machine ─────────────────────────────────────────────────────────────

export type ConnectionRef = ActorRefFrom<typeof connectionMachine>;
export type CallRef = ActorRefFrom<typeof callMachine>;

export type PeerContext = {
  readonly peer: Peer;
  peerId: string | null;
  connections: Record<string, ConnectionRef>;
  calls: Record<string, CallRef>;
  lastError: PeerError<string> | null;
  /** Number of consecutive reconnection attempts. Reset on successful open. */
  retryCount: number;
  /** Maximum automatic reconnection attempts before giving up. */
  readonly maxRetries: number;
  /** Base delay in ms for exponential backoff (delay = base * 2^retryCount). */
  readonly baseRetryDelay: number;
};

export type PeerInput = {
  peer: Peer;
  /** Maximum automatic reconnection attempts. Default: 5. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 1000. */
  baseRetryDelay?: number;
};

/** Events sent back from the PeerJS Peer event emitter. */
export type PeerCallbackEvent =
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEER_CONNECTION'; connection: DataConnection }
  | { type: 'PEER_CALL'; call: MediaConnection }
  | { type: 'PEER_DISCONNECTED' }
  | { type: 'PEER_ERROR'; error: PeerError<string> }
  | { type: 'PEER_CLOSE' };

/** Commands sent into the peer machine by the caller. */
export type PeerCommand =
  // Data connections
  | { type: 'CONNECT_TO'; remotePeerId: string }
  | { type: 'SEND'; connectionId: string; data: unknown }
  | { type: 'CLOSE_CONNECTION'; connectionId: string }
  // Media calls
  | { type: 'CALL'; remotePeerId: string; localStream: MediaStream }
  | { type: 'ANSWER_CALL'; callId: string; localStream: MediaStream }
  | { type: 'REJECT_CALL'; callId: string }
  | { type: 'HANG_UP'; callId: string }
  // Peer lifecycle
  | { type: 'RECONNECT' }
  | { type: 'DESTROY' };

export type PeerEvent =
  | PeerCallbackEvent
  | PeerCommand
  | ConnectionParentEvent
  | CallParentEvent;

/**
 * Observable events emitted by the peer machine.
 * Subscribe via: actor.on('peer.ready', handler)
 */
export type PeerEmittedEvent =
  // Peer lifecycle
  | { type: 'peer.ready'; peerId: string }
  | { type: 'peer.disconnected' }
  | { type: 'peer.error'; error: PeerError<string> }
  // Data connections
  | { type: 'connection.opened'; connectionId: string; remotePeerId: string }
  | { type: 'connection.closed'; connectionId: string }
  | { type: 'connection.error'; connectionId: string; error: PeerError<string> }
  | { type: 'connection.data'; connectionId: string; data: unknown }
  // Media calls
  | { type: 'call.incoming'; callId: string; remotePeerId: string }
  | { type: 'call.active'; callId: string; remotePeerId: string; remoteStream: MediaStream }
  | { type: 'call.ended'; callId: string }
  | { type: 'call.error'; callId: string; error: PeerError<string> };

/**
 * PeerJS error types that are unrecoverable — the Peer instance must be
 * discarded and recreated. All other error types are non-fatal.
 *
 * @see https://peerjs.com/docs/#peeron-error
 */
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
