import type { Peer, PeerError, DataConnection, MediaConnection } from 'peerjs';
import type { Effect } from '../core/types';
import type { Machine } from '../core/runtime';
import type { ConnectionMachine } from '../connection/ConnectionMachine';
import type { CallMachine } from '../call/CallMachine';

// ── Shared Types ──────────────────────────────────────────────────────────────

export type PeerInput = {
  peer: Peer;
  maxRetries?: number;
  baseRetryDelay?: number;
};

// ── Peer State Configurations ─────────────────────────────────────────────────

export type PeerInitializing = {
  readonly _tag: 'initializing';
  readonly peer: Peer;
  readonly maxRetries: number;
  readonly baseRetryDelay: number;
};

export type PeerReady = {
  readonly _tag: 'ready';
  readonly peer: Peer;
  readonly peerId: string;
  readonly connections: Map<string, ConnectionMachine>;
  readonly calls: Map<string, CallMachine>;
  readonly maxRetries: number;
  readonly baseRetryDelay: number;
};

export type PeerDisconnected = {
  readonly _tag: 'disconnected';
  readonly peer: Peer;
  readonly peerId: string;
  readonly connections: Map<string, ConnectionMachine>;
  readonly calls: Map<string, CallMachine>;
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

export type PeerState =
  | PeerInitializing
  | PeerReady
  | PeerDisconnected
  | PeerErrorState
  | PeerDestroyed;

// ── Peer Events ───────────────────────────────────────────────────────────────

export type PeerEvent =
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEER_CONNECTION'; connection: DataConnection }
  | { type: 'PEER_CALL'; call: MediaConnection }
  | { type: 'PEER_DISCONNECTED' }
  | { type: 'PEER_ERROR'; error: PeerError<string> }
  | { type: 'PEER_CLOSE' }
  | PeerCommand;

export type PeerCommand =
  | { type: 'RECONNECT' }
  | { type: 'DESTROY' }
  | { type: 'CONNECT_TO'; remotePeerId: string }
  | { type: 'CALL'; remotePeerId: string; localStream: MediaStream }
  | { type: 'ANSWER_CALL'; callId: string; localStream: MediaStream }
  | { type: 'REJECT_CALL'; callId: string }
  | { type: 'HANG_UP'; callId: string }
  | { type: 'SEND'; connectionId: string; data: unknown }
  | { type: 'CLOSE_CONNECTION'; connectionId: string };

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

// ── Error Helpers ─────────────────────────────────────────────────────────────

export const FATAL_ERRORS = new Set([
  'browser-incompatible',
  'invalid-id',
  'invalid-key',
  'ssl-unavailable',
  'server-error',
  'socket-error',
  'socket-closed',
]);

export function isFatalError(error: PeerError<string>): boolean {
  return FATAL_ERRORS.has(error.type);
}
