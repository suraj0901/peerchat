import type { PeerError } from 'peerjs';

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
  | { type: 'call.remoteResumed'; callId: string; remotePeerId: string };

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
