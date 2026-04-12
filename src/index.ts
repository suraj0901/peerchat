// ── Machines ──────────────────────────────────────────────────────────────────

export { PeerManager } from './peer/PeerManager';
export type { CallOptions, AnswerOptions } from './peer/PeerManager';
export { MediaMachine } from './media/MediaManager';
export type { CallMachine } from './call/CallMachine';
export type { ConnectionMachine } from './connection/ConnectionMachine';

// ── Factory Functions ─────────────────────────────────────────────────────────

export { createPeer, createMedia } from './factory';
export type { CreatePeerOptions, CreateMediaOptions } from './factory';

// ── Logging ───────────────────────────────────────────────────────────────────

export { setLogging } from './core/logger';

// ── Event Constants ───────────────────────────────────────────────────────────

export { PeerEvents, CallEvents, ConnectionEvents, MediaEvents } from './core/events';

// ── Peer types ────────────────────────────────────────────────────────────────

export type { PeerState } from './peer/state';
export type { PeerEmittedEvent } from './peer/types';

// ── Media types ───────────────────────────────────────────────────────────────

export type { MediaState } from './media/state';
export type { MediaEmittedEvent } from './media/types';
export type { MediaMode, PermissionState, MediaPermissions } from './media/state';

// ── Call / Connection types ───────────────────────────────────────────────────

export type { CallState } from './call/state';
export type { CallInfo } from './call/types';
export type { CallEmittedEvent } from './call/types';
export type { ConnectionState } from './connection/state';
export type { ConnectionInfo } from './connection/types';
export type { ConnectionEmittedEvent } from './connection/types';
