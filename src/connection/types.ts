import type { DataConnection, PeerError } from 'peerjs';
import type { Effect } from '../core/types';

// ── Connection State (Discriminated Union) ────────────────────────────────────

export type ConnectionState =
  | ConnectionConnecting
  | ConnectionOpen
  | ConnectionClosed
  | ConnectionError;

export type ConnectionConnecting = {
  readonly _tag: 'connecting';
  readonly connection: DataConnection;
  readonly connectionId: string;
  readonly remotePeerId: string;
};

export type ConnectionOpen = {
  readonly _tag: 'open';
  readonly connection: DataConnection;
  readonly connectionId: string;
  readonly remotePeerId: string;
};

export type ConnectionClosed = {
  readonly _tag: 'closed';
  readonly connectionId: string;
};

export type ConnectionError = {
  readonly _tag: 'error';
  readonly connectionId: string;
  readonly error: PeerError<string>;
};

// ── Events ────────────────────────────────────────────────────────────────────

export type ConnectionCommand =
  | { type: 'SEND'; data: unknown }
  | { type: 'CLOSE' };

export type ConnectionInternalEvent =
  | { type: 'CONNECTION_OPEN' }
  | { type: 'CONNECTION_DATA'; data: unknown }
  | { type: 'CONNECTION_CLOSE' }
  | { type: 'CONNECTION_ERROR'; error: PeerError<string> }
  | { type: 'CONNECTION_TIMEOUT' };

export type ConnectionEvent = ConnectionCommand | ConnectionInternalEvent;

// ── Parent Events ─────────────────────────────────────────────────────────────

/**
 * Events sent upward to the parent peer machine.
 * Emitted as effects — the parent subscribes to these.
 */
export type ConnectionParentEvent =
  | { type: 'CONNECTION_OPENED'; connectionId: string; remotePeerId: string }
  | { type: 'CONNECTION_CLOSED'; connectionId: string }
  | { type: 'CONNECTION_ERROR_PARENT'; connectionId: string; error: PeerError<string> }
  | { type: 'CONNECTION_DATA_RECEIVED'; connectionId: string; data: unknown };

// ── Effects ───────────────────────────────────────────────────────────────────

export type ConnectionEffect = Effect<ConnectionEvent>;
