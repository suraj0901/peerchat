import type { PeerError } from 'peerjs';

export type CallEmittedEvent =
  | { type: 'call.incoming'; callId: string; remotePeerId: string }
  | { type: 'call.active'; callId: string; remotePeerId: string; remoteStream: MediaStream }
  | { type: 'call.ended'; callId: string }
  | { type: 'call.error'; callId: string; error: Error | PeerError<string> }
  | { type: 'call.rejected'; callId: string; remotePeerId: string }
  | { type: 'call.declined'; callId: string; remotePeerId: string };