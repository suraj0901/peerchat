import type { PeerError } from 'peerjs';
import type { CallInfo } from '../call/types';
import type { ConnectionInfo } from '../connection/types';
import type { CallCoordinator } from '../call/CallCoordinator';
import type { ConnectionMachine } from '../connection/ConnectionMachine';
import type { CallOptions, AnswerOptions } from './PeerManager';
import type { MediaMachine } from '../media/MediaManager';

// ── Event Union ──────────────────────────────────────────────────────────────

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
  | { type: 'call.error'; callId: string; error: Error | PeerError<string> }
  | { type: 'call.rejected'; callId: string; remotePeerId: string }
  | { type: 'call.declined'; callId: string; remotePeerId: string }
  | { type: 'call.held'; callId: string; remotePeerId: string }
  | { type: 'call.resumed'; callId: string; remotePeerId: string }
  | { type: 'call.remoteHeld'; callId: string; remotePeerId: string }
  | { type: 'call.remoteResumed'; callId: string; remotePeerId: string }
  | { type: 'call.selectionRequired'; heldCallIds: string[] };

// ── Scoped Event Subsets ─────────────────────────────────────────────────────

/** Events related to call lifecycle */
export type CallEvent = Extract<PeerEmittedEvent, { type: `call.${string}` }>;

/** Events related to data connections */
export type ConnectionEvent = Extract<PeerEmittedEvent, { type: `connection.${string}` }>;

/** Events related to peer lifecycle */
export type PeerLifecycleEvent = Extract<PeerEmittedEvent, { type: `peer.${string}` }>;

// ── Focused Interfaces (ISP) ─────────────────────────────────────────────────

/**
 * Call management API. For consumers that only need to make/receive calls.
 */
export interface PeerCallApi {
  call(remotePeerId: string, options?: CallOptions): boolean;
  answer(callId: string, options?: AnswerOptions): boolean;
  reject(callId: string): boolean;
  hangUp(callId: string): boolean;
  hold(callId: string): boolean;
  resume(callId: string): boolean;
  getActiveCalls(): readonly CallInfo[];
  getHeldCalls(): readonly CallInfo[];
  getCallMachine(callId: string): CallCoordinator | null;
  readonly needsCallSelection: boolean;
}

/**
 * Data connection API. For consumers that only need P2P data channels.
 */
export interface PeerConnectionApi {
  connect(remotePeerId: string): void;
  send(remotePeerId: string, data: unknown): boolean;
  getActiveConnections(): readonly ConnectionInfo[];
  getConnectionMachine(connectionId: string): ConnectionMachine | null;
}

/**
 * Media attachment API. For consumers that manage media streams.
 */
export interface PeerMediaApi {
  attachMedia(media: MediaMachine): void;
  detachMedia(): void;
}

/**
 * Query / read-only API. For consumers that only observe state.
 */
export interface PeerQueryApi {
  getActiveCalls(): readonly CallInfo[];
  getHeldCalls(): readonly CallInfo[];
  getActiveConnections(): readonly ConnectionInfo[];
  readonly needsCallSelection: boolean;
}

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
