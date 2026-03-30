import type { MediaConnection, PeerError } from 'peerjs';
import type { Effect } from '../core/types';

// ── Call State (Discriminated Union) ──────────────────────────────────────────

export type CallDirection = 'inbound' | 'outbound';

export type CallState =
  | CallRinging
  | CallConnecting
  | CallLive
  | CallEnded
  | CallError;

/**
 * Inbound call only — direction is enforced at the type level.
 * Stream is not yet available; awaiting ANSWER or REJECT.
 */
export type CallRinging = {
  readonly _tag: 'ringing';
  readonly call: MediaConnection;
  readonly callId: string;
  readonly remotePeerId: string;
  readonly direction: 'inbound';
};

/**
 * Call answered (inbound) or just initiated (outbound).
 * Waiting for ICE negotiation and remote stream.
 */
export type CallConnecting = {
  readonly _tag: 'connecting';
  readonly call: MediaConnection;
  readonly callId: string;
  readonly remotePeerId: string;
  readonly direction: CallDirection;
};

/**
 * Call is fully established — remoteStream is guaranteed non-null.
 */
export type CallLive = {
  readonly _tag: 'live';
  readonly call: MediaConnection;
  readonly callId: string;
  readonly remotePeerId: string;
  readonly direction: CallDirection;
  readonly remoteStream: MediaStream;
};

export type CallEnded = {
  readonly _tag: 'ended';
  readonly callId: string;
};

export type CallError = {
  readonly _tag: 'error';
  readonly callId: string;
  readonly error: PeerError<string>;
};

// ── Events ────────────────────────────────────────────────────────────────────

export type CallCommand =
  | { type: 'ANSWER'; localStream: MediaStream }
  | { type: 'REJECT' }
  | { type: 'HANG_UP' };

export type CallInternalEvent =
  | { type: 'CALL_STREAM'; stream: MediaStream }
  | { type: 'CALL_CLOSE' }
  | { type: 'CALL_ERROR'; error: PeerError<string> }
  | { type: 'RINGING_TIMEOUT' }
  | { type: 'CONNECTING_TIMEOUT' };

export type CallEvent = CallCommand | CallInternalEvent;

// ── Parent Events ─────────────────────────────────────────────────────────────

export type CallParentEvent =
  | { type: 'CALL_ACTIVE'; callId: string; remotePeerId: string; remoteStream: MediaStream }
  | { type: 'CALL_ENDED'; callId: string }
  | { type: 'CALL_ERROR_PARENT'; callId: string; error: PeerError<string> };

// ── Effects ───────────────────────────────────────────────────────────────────

export type CallEffect = Effect<CallEvent>;
