import type { PeerError } from 'peerjs';
import type { CallState } from './state';

export type CallEmittedEvent =
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

/**
 * Immutable snapshot of a call's essential information.
 * Returned by `PeerManager.getActiveCalls()`.
 */
export interface CallInfo {
  callId: string;
  remotePeerId: string;
  state: CallState['_tag'];
  direction: 'inbound' | 'outbound';
}