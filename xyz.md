# PeerChat Refactoring Implementation Plan

> **Author**: Principal Software Architecture Review  
> **Date**: 2025-04-12  
> **Status**: Draft  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Phase 0 — Scope Classification](#phase-0--scope-classification)
3. [Phase 1 — Tech Stack](#phase-1--tech-stack)
4. [Phase 2 — Refactoring Analysis](#phase-2--refactoring-analysis)
5. [Phase 3 — Implementation Blueprint](#phase-3--implementation-blueprint)
   - [Section 1: Architecture Overview](#section-1-architecture-overview)
   - [Section 3: Domain Models](#section-3-domain-models)
   - [Section 7: State Management](#section-7-state-management)
   - [Section 9: Critical Path Walkthrough](#section-9-critical-path-walkthrough)
   - [Section 10: Testing Strategy](#section-10-testing-strategy)
   - [Section 11: Non-Functional Considerations](#section-11-non-functional-considerations)
6. [Traceability Matrix](#traceability-matrix)
7. [Implementation Order](#implementation-order)
8. [Breaking Changes & Migration](#breaking-changes--migration)

---

## Executive Summary

This document outlines a comprehensive refactoring plan for the PeerChat library, transforming it from its current event-driven state machine implementation to a more rigorous Elm Architecture (Model-Update-Cmd) pattern. The refactoring maintains backward API compatibility while enabling:

- **Pure state reducers** for deterministic testing and debugging
- **Effect system** for clear separation of side effects
- **Type-safe events and commands** throughout the stack
- **Comprehensive test coverage** with property-based testing
- **Better error handling** with Result types

---

## Phase 0 — Scope Classification

```
Scope: library / medium
Reason: PeerChat is a reusable TypeScript package wrapping PeerJS. It has multiple 
concerns (peer lifecycle, media management, call coordination, connection handling) 
with 4 state machines and non-trivial event flows. No frontend, no backend, no persistence.

Active blueprint sections: 1 (brief), 2 (if warranted), 3, 7, 9, 10, 11 (one-liners)
Skipped sections: 4 (Component Decomposition — not frontend), 5 (API Contracts — not backend), 
                 6 (Database Schema — no persistence), 8 (Observability — medium complexity, one-liner)
```

---

## Phase 1 — Tech Stack

Current stack:
- **Language**: TypeScript 5.9+
- **Build**: tsup (ESM + CJS dual output)
- **Runtime**: Browser-only (WebRTC APIs)
- **Dependencies**: PeerJS 1.5.5 (peer dependency)
- **Testing**: None currently (needs addition)

**Locked-in context for refactoring:**
- Must maintain backward compatibility with existing public API (`PeerManager`, `MediaMachine`, exported types)
- Must work with PeerJS's event-emitter pattern
- Must support React integration via `useSyncExternalStore` or equivalent

**New additions:**
- **Testing**: Vitest + @fast-check/vitest (property-based)
- **UUID**: uuid package for generating request IDs
- **Types**: No runtime dependencies — pure type system refactoring

---

## Phase 2 — Refactoring Analysis

### 1. Bounded Contexts & Domain Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PEERCHAT LIBRARY                             │
├──────────────────┬──────────────────┬───────────────────────────────┤
│   PEER DOMAIN    │   CALL DOMAIN    │      MEDIA DOMAIN            │
│                  │                  │                               │
│  - Peer lifecycle│  - Call signaling│  - Stream acquisition         │
│  - Connection    │  - Call states   │  - Device management         │
│    management    │  - Coordinating  │  - Permission handling       │
│  - Signaling     │    media+signaling│                             │
├──────────────────┴──────────────────┴───────────────────────────────┤
│                        CORE DOMAIN                                  │
│  - State machine runtime  - Effect system  - Event bus              │
└─────────────────────────────────────────────────────────────────────┘
```

**Domain boundaries:**
- **Core**: Pure abstractions (state types, event types, effect system) — no PeerJS dependencies
- **Peer**: Owns PeerJS instance, manages connections dictionary, coordinates calls
- **Call**: Owns MediaConnection + coordinates with connection for signaling
- **Media**: Owns MediaStream, device enumeration, permissions — no PeerJS dependencies

**Integration points (highest risk):**
1. Peer ↔ Call: `CallCoordinator` spawned by `PeerReadyState`, callbacks for ended/active
2. Peer ↔ Connection: `ConnectionMachine` spawned by `PeerReadyState`, signaling channel
3. Call ↔ Connection: Signaling messages routed through `SignalingService`

### 2. Requirements Traceability Skeleton

| ID | Requirement | Domain | Implementation Target |
|---|---|---|---|
| R-01 | Split large state files into smaller modules | Core | File structure reorganization |
| R-02 | Pure state reducers (no side effects in handlers) | Core | Effect system implementation |
| R-03 | Typed errors with Result<T, E> | Core | neverthrow integration |
| R-04 | Comprehensive test coverage | All | Vitest + MSW for mocking |
| R-05 | Race condition handling for concurrent operations | Peer | Connection/call deduplication |
| R-06 | Error recovery mechanisms | Peer/Call | Retry states, recovery strategies |
| R-07 | Maintain backward API compatibility | Core | Facade over new implementation |
| R-08 | Explicit runtime configuration | Core | Dependency injection pattern |

### 3. Conflicts & Tension Points

| # | Conflict | Trade-offs | Recommendation |
|---|----------|------------|----------------|
| C-01 | **Pure reducers vs. PeerJS event callbacks** | Pure reducers are easier to test but require effect interpreter; callbacks are direct but impure | Accept effect system overhead for testability and predictability |
| C-02 | **Immutable states vs. in-place Map mutations** | Current design mutates `calls`/`connections` Maps; immutable would require cloning on every change | Keep Maps but wrap access through typed accessor methods; document mutation semantics |
| C-03 | **neverthrow vs. throwing exceptions** | neverthrow adds verbosity but makes errors explicit; exceptions are familiar but invisible in types | Use native Result type for public API boundaries only; internal code can throw |

### 4. Open Questions

1. **Q1**: Should we support event replay/debugging (event sourcing)? Adds complexity but enables powerful debugging.
2. **Q2**: Should `MediaMachine` support multiple simultaneous streams (camera + screen share)?
3. **Q3**: What's the migration path for existing users? Do we need a deprecation cycle?

---

## Phase 3 — Implementation Blueprint

### Section 1: Architecture Overview

**High-level Architecture:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              PUBLIC API (unchanged)                          │
│  PeerManager, MediaMachine, exported types                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                              FACADE LAYER                                    │
│  PeerFacade, MediaFacade — wraps runtime, provides backward-compatible API   │
├──────────────────────────────────────────────────────────────────────────────┤
│                              RUNTIME LAYER                                   │
│  Interpreter — executes Commands, emits Events, manages side effects        │
├──────────────────────────────────────────────────────────────────────────────┤
│                              REDUCER LAYER                                    │
│  Pure functions: (State, Event) → [State, Command[]]                        │
│  peerReducer, mediaReducer, callReducer, connectionReducer                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                              DOMAIN LAYER                                     │
│  State types, Event types, Command types — no external dependencies         │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Architecture Style Justification:**

Elm Architecture (Model-Update-Cmd) adapted for TypeScript. Pure reducers handle state transitions and produce commands; a single interpreter executes commands and dispatches events back. This enables deterministic testing, event replay, and clear separation of concerns while staying compatible with PeerJS's event-emitter pattern.

---

### Section 3: Domain Models

#### 3.1 Core Effect System Types

```typescript
// src/core/types.ts

/**
 * Branded type for runtime-unique identifiers.
 * Prevents accidental mixing of callId, connectionId, etc.
 */
type Brand<T, B> = T & { readonly __brand: B };

export type PeerId = string;
export type CallId = Brand<string, 'CallId'>;
export type ConnectionId = Brand<string, 'ConnectionId'>;

/**
 * Result type for explicit error handling at API boundaries.
 */
export type Result<T, E> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Base state interface — all states extend this.
 */
export interface State {
  readonly _tag: string;
}

/**
 * Events are discriminated unions with a `type` field.
 */
export interface Event {
  readonly type: string;
}

/**
 * Commands describe effects to execute.
 * Never thrown — always returned from reducers.
 */
export type Command =
  | { type: 'peer.connect'; remotePeerId: PeerId }
  | { type: 'peer.call'; remotePeerId: PeerId; localStream: MediaStream }
  | { type: 'call.answer'; callId: CallId; localStream: MediaStream }
  | { type: 'call.hangUp'; callId: CallId }
  | { type: 'call.reject'; callId: CallId }
  | { type: 'connection.send'; connectionId: ConnectionId; data: unknown }
  | { type: 'connection.close'; connectionId: ConnectionId }
  | { type: 'media.getUserMedia'; constraints: MediaStreamConstraints; requestId: string }
  | { type: 'media.getDisplayMedia'; constraints: DisplayMediaStreamOptions; requestId: string }
  | { type: 'media.stopTracks'; stream: MediaStream }
  | { type: 'schedule.timeout'; delayMs: number; event: Event; timerId: string }
  | { type: 'schedule.cancelTimeout'; timerId: string }
  | { type: 'emit'; event: Event };

/**
 * CommandHandler executes a single command.
 * Returns events that occurred during execution.
 */
export type CommandHandler<C extends Command = Command> = (
  command: C
) => Promise<Event[]> | Event[];

/**
 * Reducer is a pure function.
 * Given current state and an event, returns next state and commands to execute.
 */
export type Reducer<S extends State, E extends Event> = (
  state: S,
  event: E
) => readonly [S, readonly Command[]];
```

#### 3.2 Peer Domain Types

```typescript
// src/peer/types.ts

import type { PeerError } from 'peerjs';
import type { State, Event, PeerId, CallId, ConnectionId, Result } from '../core/types';

// ── Permission Value Object ─────────────────────────────────────────────────────

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface PeerPermissions {
  readonly camera: PermissionState;
  readonly microphone: PermissionState;
}

// ── Retry Configuration Value Object ────────────────────────────────────────────

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

// ── Peer States (Immutable) ─────────────────────────────────────────────────────

export interface PeerInitializingState extends State {
  readonly _tag: 'peer.initializing';
  readonly peerId: PeerId | null;
  readonly retryConfig: RetryConfig;
}

export interface PeerReadyState extends State {
  readonly _tag: 'peer.ready';
  readonly peerId: PeerId;
  readonly connections: ReadonlyMap<ConnectionId, ConnectionStateSummary>;
  readonly calls: ReadonlyMap<CallId, CallStateSummary>;
  readonly retryConfig: RetryConfig;
}

export interface PeerDisconnectedState extends State {
  readonly _tag: 'peer.disconnected';
  readonly peerId: PeerId;
  readonly retryAttempt: number;
  readonly retryConfig: RetryConfig;
  readonly lastKnownConnections: ReadonlyMap<ConnectionId, ConnectionStateSummary>;
  readonly lastKnownCalls: ReadonlyMap<CallId, CallStateSummary>;
}

export interface PeerReconnectingState extends State {
  readonly _tag: 'peer.reconnecting';
  readonly peerId: PeerId;
  readonly retryAttempt: number;
  readonly retryConfig: RetryConfig;
}

export interface PeerErrorState extends State {
  readonly _tag: 'peer.error';
  readonly error: PeerError<string>;
  readonly recoverable: boolean;
}

export interface PeerDestroyedState extends State {
  readonly _tag: 'peer.destroyed';
}

export type PeerState =
  | PeerInitializingState
  | PeerReadyState
  | PeerDisconnectedState
  | PeerReconnectingState
  | PeerErrorState
  | PeerDestroyedState;

// ── State Summaries (for parent reference) ──────────────────────────────────────

export interface ConnectionStateSummary {
  readonly connectionId: ConnectionId;
  readonly remotePeerId: PeerId;
  readonly status: 'connecting' | 'open' | 'closed' | 'error';
}

export interface CallStateSummary {
  readonly callId: CallId;
  readonly remotePeerId: PeerId;
  readonly direction: 'inbound' | 'outbound';
  readonly status: 'ringing' | 'connecting' | 'live' | 'ended' | 'error';
}

// ── Peer Events ─────────────────────────────────────────────────────────────────

export type PeerEvent =
  | { type: 'peer.open'; peerId: PeerId }
  | { type: 'peer.disconnect' }
  | { type: 'peer.error'; error: PeerError<string> }
  | { type: 'peer.close' }
  | { type: 'peer.connection.incoming'; connectionId: ConnectionId; remotePeerId: PeerId }
  | { type: 'peer.call.incoming'; callId: CallId; remotePeerId: PeerId }
  | { type: 'peer.retry'; attempt: number; delayMs: number }
  | { type: 'peer.retry.exhausted' };

// ── Peer Commands (domain-specific) ────────────────────────────────────────────

export type PeerCommand =
  | { type: 'peer.initiate' }
  | { type: 'peer.reconnect' }
  | { type: 'peer.destroy' };

// ── Error Types ─────────────────────────────────────────────────────────────────

export type PeerErrorType =
  | { type: 'peer.uninitialized' }
  | { type: 'peer.already_initialized' }
  | { type: 'peer.connection_failed'; remotePeerId: PeerId; cause: Error }
  | { type: 'peer.call_failed'; remotePeerId: PeerId; cause: Error }
  | { type: 'peer.not_found' };

export type PeerResult<T> = Result<T, PeerErrorType>;

// ── Fatal PeerJS Errors ──────────────────────────────────────────────────────────

export const FATAL_PEER_ERRORS = new Set([
  'browser-incompatible',
  'invalid-id',
  'invalid-key',
  'ssl-unavailable',
  'server-error',
  'socket-error',
  'socket-closed',
]);

export function isFatalPeerError(error: PeerError<string>): boolean {
  return FATAL_PEER_ERRORS.has(error.type);
}
```

#### 3.3 Call Domain Types

```typescript
// src/call/types.ts

import type { PeerError } from 'peerjs';
import type { State, Event, CallId, PeerId, Result } from '../core/types';

// ── Call States ────────────────────────────────────────────────────────────────

export interface CallRingingState extends State {
  readonly _tag: 'call.ringing';
  readonly callId: CallId;
  readonly remotePeerId: PeerId;
  readonly direction: 'inbound';
  readonly createdAt: number;
}

export interface CallConnectingState extends State {
  readonly _tag: 'call.connecting';
  readonly callId: CallId;
  readonly remotePeerId: PeerId;
  readonly direction: 'inbound' | 'outbound';
  readonly localStream: MediaStream | null;
}

export interface CallLiveState extends State {
  readonly _tag: 'call.live';
  readonly callId: CallId;
  readonly remotePeerId: PeerId;
  readonly direction: 'inbound' | 'outbound';
  readonly localStream: MediaStream;
  readonly remoteStream: MediaStream;
  readonly audioMuted: boolean;
  readonly videoMuted: boolean;
}

export interface CallEndingState extends State {
  readonly _tag: 'call.ending';
  readonly callId: CallId;
  readonly remotePeerId: PeerId;
  readonly reason: 'user_hangup' | 'remote_hangup' | 'error' | 'timeout' | 'rejected' | 'declined';
}

export interface CallEndedState extends State {
  readonly _tag: 'call.ended';
  readonly callId: CallId;
  readonly remotePeerId: PeerId;
  readonly endReason: 'user_hangup' | 'remote_hangup' | 'error' | 'timeout' | 'rejected' | 'declined';
}

export interface CallErrorState extends State {
  readonly _tag: 'call.error';
  readonly callId: CallId;
  readonly remotePeerId: PeerId;
  readonly error: Error | PeerError<string>;
}

export type CallState =
  | CallRingingState
  | CallConnectingState
  | CallLiveState
  | CallEndingState
  | CallEndedState
  | CallErrorState;

// ── Call Events ────────────────────────────────────────────────────────────────

export type CallEvent =
  | { type: 'call.answer'; localStream: MediaStream }
  | { type: 'call.reject' }
  | { type: 'call.hangUp' }
  | { type: 'call.stream'; stream: MediaStream }
  | { type: 'call.close' }
  | { type: 'call.error'; error: Error | PeerError<string> }
  | { type: 'call.timeout' }
  | { type: 'call.mute'; kind: 'audio' | 'video' }
  | { type: 'call.unmute'; kind: 'audio' | 'video' }
  // Remote signaling events
  | { type: 'call.remote_close' }
  | { type: 'call.remote_rejected' }
  | { type: 'call.remote_declined' };

// ── Call Commands ───────────────────────────────────────────────────────────────

export type CallCommand =
  | { type: 'call.peerjs.answer'; localStream: MediaStream }
  | { type: 'call.peerjs.close' }
  | { type: 'call.signal.reject'; callId: CallId; remotePeerId: PeerId }
  | { type: 'call.signal.decline'; callId: CallId; remotePeerId: PeerId }
  | { type: 'call.signal.remote_close'; callId: CallId; remotePeerId: PeerId };

// ── Config ─────────────────────────────────────────────────────────────────────

export const CALL_RINGING_TIMEOUT_MS = 30_000;
export const CALL_CONNECTING_TIMEOUT_MS = 30_000;

export interface CallConfig {
  readonly ringingTimeoutMs: number;
  readonly connectingTimeoutMs: number;
}

export const DEFAULT_CALL_CONFIG: CallConfig = {
  ringingTimeoutMs: CALL_RINGING_TIMEOUT_MS,
  connectingTimeoutMs: CALL_CONNECTING_TIMEOUT_MS,
};

// ── Result Types ────────────────────────────────────────────────────────────────

export type CallErrorType =
  | { type: 'call.not_found'; callId: CallId }
  | { type: 'call.already_answered'; callId: CallId }
  | { type: 'call.invalid_state'; callId: CallId; currentTag: string }
  | { type: 'call.stream_error'; callId: CallId; cause: Error };

export type CallResult<T> = Result<T, CallErrorType>;
```

#### 3.4 Media Domain Types

```typescript
// src/media/types.ts

import type { State, Event, Result } from '../core/types';

// ── Media Mode ──────────────────────────────────────────────────────────────────

export type MediaMode = 'user' | 'screen';

// ── Permission State ─────────────────────────────────────────────────────────────

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface MediaPermissions {
  readonly camera: PermissionStatus;
  readonly microphone: PermissionStatus;
}

// ── Media States ────────────────────────────────────────────────────────────────

export interface MediaIdleState extends State {
  readonly _tag: 'media.idle';
  readonly permissions: MediaPermissions;
}

export interface MediaCheckingPermissionsState extends State {
  readonly _tag: 'media.checkingPermissions';
  readonly permissions: MediaPermissions;
}

export interface MediaRequestingState extends State {
  readonly _tag: 'media.requesting';
  readonly mode: MediaMode;
  readonly constraints: MediaStreamConstraints;
  readonly permissions: MediaPermissions;
  readonly requestId: string;
}

export interface MediaActiveState extends State {
  readonly _tag: 'media.active';
  readonly stream: MediaStream;
  readonly devices: readonly MediaDeviceInfo[];
  readonly mode: MediaMode;
  readonly constraints: MediaStreamConstraints;
  readonly permissions: MediaPermissions;
  readonly audioMuted: boolean;
  readonly videoMuted: boolean;
}

export interface MediaSwitchingState extends State {
  readonly _tag: 'media.switching';
  readonly stream: MediaStream;
  readonly mode: MediaMode;
  readonly kind: 'audio' | 'video';
  readonly deviceId: string;
  readonly permissions: MediaPermissions;
}

export interface MediaRecoveringState extends State {
  readonly _tag: 'media.recovering';
  readonly oldStream: MediaStream;
  readonly mode: MediaMode;
  readonly constraints: MediaStreamConstraints;
  readonly permissions: MediaPermissions;
}

export interface MediaDeniedState extends State {
  readonly _tag: 'media.denied';
  readonly permissions: MediaPermissions;
}

export interface MediaErrorState extends State {
  readonly _tag: 'media.error';
  readonly error: Error;
  readonly permissions: MediaPermissions;
}

export type MediaState =
  | MediaIdleState
  | MediaCheckingPermissionsState
  | MediaRequestingState
  | MediaActiveState
  | MediaSwitchingState
  | MediaRecoveringState
  | MediaDeniedState
  | MediaErrorState;

// ── Media Events ────────────────────────────────────────────────────────────────

export type MediaEvent =
  | { type: 'media.request'; constraints: MediaStreamConstraints; mode: MediaMode }
  | { type: 'media.requestScreen'; constraints: DisplayMediaStreamOptions }
  | { type: 'media.stream.acquired'; stream: MediaStream; devices: MediaDeviceInfo[] }
  | { type: 'media.stream.error'; error: Error }
  | { type: 'media.stream.stopped' }
  | { type: 'media.permission.denied' }
  | { type: 'media.permission.granted' }
  | { type: 'media.permission.status'; permissions: MediaPermissions }
  | { type: 'media.track.ended'; kind: 'audio' | 'video' }
  | { type: 'media.toggleMute'; kind: 'audio' | 'video' }
  | { type: 'media.switchDevice'; kind: 'audio' | 'video'; deviceId: string }
  | { type: 'media.device.switched'; stream: MediaStream }
  | { type: 'media.device.switch.failed'; kind: 'audio' | 'video'; error: Error }
  | { type: 'media.stop' };

// ── Media Commands ──────────────────────────────────────────────────────────────

export type MediaCommand =
  | { type: 'media.navigator.getUserMedia'; constraints: MediaStreamConstraints; requestId: string }
  | { type: 'media.navigator.getDisplayMedia'; constraints: DisplayMediaStreamOptions; requestId: string }
  | { type: 'media.navigator.enumerateDevices' }
  | { type: 'media.stream.stopAll'; stream: MediaStream }
  | { type: 'media.stream.applyMute'; stream: MediaStream; audioMuted: boolean; videoMuted: boolean };

// ── Result Types ────────────────────────────────────────────────────────────────

export type MediaErrorType =
  | { type: 'media.stream_not_active' }
  | { type: 'media.permission_denied' }
  | { type: 'media.device_not_found'; kind: 'audio' | 'video'; deviceId: string }
  | { type: 'media.acquisition_failed'; cause: Error };

export type MediaResult<T> = Result<T, MediaErrorType>;
```

---

### Section 7: State Management

#### 7.1 Pure Reducer Implementation

```typescript
// src/peer/reducer.ts

import type { Reducer, Command, Result, Ok, Err } from '../core/types';
import type { PeerState, PeerEvent, PeerCommand, PeerErrorType } from './types';
import {
  DEFAULT_RETRY_CONFIG,
  isFatalPeerError,
  type PeerInitializingState,
  type PeerReadyState,
  type PeerDisconnectedState,
  type PeerReconnectingState,
  type PeerErrorState,
  type PeerDestroyedState,
} from './types';

/**
 * Pure peer reducer.
 * Handles all state transitions and produces commands for side effects.
 */
export const peerReducer: Reducer<PeerState, PeerEvent> = (state, event) => {
  switch (state._tag) {
    case 'peer.initializing':
      return handleInitializing(state, event);
    case 'peer.ready':
      return handleReady(state, event);
    case 'peer.disconnected':
      return handleDisconnected(state, event);
    case 'peer.reconnecting':
      return handleReconnecting(state, event);
    case 'peer.error':
    case 'peer.destroyed':
      // Terminal states — ignore events
      return [state, []];
    default:
      // Exhaustiveness check
      const _exhaustive: never = state;
      return [state, []];
  }
};

function handleInitializing(
  state: PeerInitializingState,
  event: PeerEvent
): readonly [PeerState, readonly Command[]] {
  switch (event.type) {
    case 'peer.open': {
      const nextState: PeerReadyState = {
        _tag: 'peer.ready',
        peerId: event.peerId,
        connections: new Map(),
        calls: new Map(),
        retryConfig: state.retryConfig,
      };
      return [nextState, [{ type: 'emit', event: { type: 'peer.ready', peerId: event.peerId } }]];
    }

    case 'peer.error': {
      if (isFatalPeerError(event.error)) {
        const nextState: PeerErrorState = {
          _tag: 'peer.error',
          error: event.error,
          recoverable: false,
        };
        return [nextState, [{ type: 'emit', event: { type: 'peer.error', error: event.error } }]];
      }
      // Non-fatal: stay in initializing, emit error
      return [state, [{ type: 'emit', event }]];
    }

    case 'peer.close': {
      const nextState: PeerDestroyedState = { _tag: 'peer.destroyed' };
      return [nextState, []];
    }

    case 'peer.disconnect': {
      const nextState: PeerDisconnectedState = {
        _tag: 'peer.disconnected',
        peerId: state.peerId ?? '',
        retryAttempt: 0,
        retryConfig: state.retryConfig,
        lastKnownConnections: new Map(),
        lastKnownCalls: new Map(),
      };
      return [nextState, [{ type: 'emit', event: { type: 'peer.disconnected' } }]];
    }

    default:
      return [state, []];
  }
}

function handleReady(
  state: PeerReadyState,
  event: PeerEvent
): readonly [PeerState, readonly Command[]] {
  switch (event.type) {
    case 'peer.disconnect': {
      const nextState: PeerDisconnectedState = {
        _tag: 'peer.disconnected',
        peerId: state.peerId,
        retryAttempt: 0,
        retryConfig: state.retryConfig,
        lastKnownConnections: state.connections,
        lastKnownCalls: state.calls,
      };
      return [nextState, [{ type: 'emit', event: { type: 'peer.disconnected' } }]];
    }

    case 'peer.error': {
      if (isFatalPeerError(event.error)) {
        const commands: Command[] = [
          // Cleanup all children
          ...Array.from(state.connections.keys()).map(
            (id): Command => ({ type: 'connection.close', connectionId: id })
          ),
        ];
        const nextState: PeerErrorState = {
          _tag: 'peer.error',
          error: event.error,
          recoverable: false,
        };
        return [nextState, [...commands, { type: 'emit', event }]];
      }
      return [state, [{ type: 'emit', event }]];
    }

    case 'peer.close': {
      const commands: Command[] = [
        // Destroy all children
        ...Array.from(state.connections.keys()).map(
          (id): Command => ({ type: 'connection.close', connectionId: id })
        ),
      ];
      const nextState: PeerDestroyedState = { _tag: 'peer.destroyed' };
      return [nextState, commands];
    }

    case 'peer.connection.incoming': {
      // Add to connections map
      const newConnections = new Map(state.connections);
      newConnections.set(event.connectionId, {
        connectionId: event.connectionId,
        remotePeerId: event.remotePeerId,
        status: 'connecting',
      });
      const nextState: PeerReadyState = { ...state, connections: newConnections };
      return [nextState, [{ type: 'emit', event }]];
    }

    case 'peer.call.incoming': {
      // Add to calls map
      const newCalls = new Map(state.calls);
      newCalls.set(event.callId, {
        callId: event.callId,
        remotePeerId: event.remotePeerId,
        direction: 'inbound',
        status: 'ringing',
      });
      const nextState: PeerReadyState = { ...state, calls: newCalls };
      return [nextState, [{ type: 'emit', event }]];
    }

    default:
      return [state, []];
  }
}

function handleDisconnected(
  state: PeerDisconnectedState,
  event: PeerEvent
): readonly [PeerState, readonly Command[]] {
  switch (event.type) {
    case 'peer.open': {
      const nextState: PeerReadyState = {
        _tag: 'peer.ready',
        peerId: event.peerId,
        connections: new Map(),
        calls: new Map(),
        retryConfig: state.retryConfig,
      };
      return [nextState, [{ type: 'emit', event: { type: 'peer.ready', peerId: event.peerId } }]];
    }

    case 'peer.error': {
      if (isFatalPeerError(event.error)) {
        const nextState: PeerErrorState = {
          _tag: 'peer.error',
          error: event.error,
          recoverable: false,
        };
        return [nextState, [{ type: 'emit', event }]];
      }
      return [state, [{ type: 'emit', event }]];
    }

    case 'peer.close': {
      const nextState: PeerDestroyedState = { _tag: 'peer.destroyed' };
      return [nextState, []];
    }

    case 'peer.retry': {
      if (event.attempt >= state.retryConfig.maxAttempts) {
        const nextState: PeerErrorState = {
          _tag: 'peer.error',
          error: new Error('Retry attempts exhausted') as any,
          recoverable: false,
        };
        return [nextState, [{ type: 'emit', event: { type: 'peer.retry.exhausted' } }]];
      }
      // Schedule next retry
      const delayMs = Math.min(
        state.retryConfig.baseDelayMs * Math.pow(state.retryConfig.backoffMultiplier, event.attempt),
        state.retryConfig.maxDelayMs
      );
      const nextState: PeerReconnectingState = {
        _tag: 'peer.reconnecting',
        peerId: state.peerId,
        retryAttempt: event.attempt,
        retryConfig: state.retryConfig,
      };
      return [
        nextState,
        [
          { type: 'schedule.timeout', delayMs, event: { type: 'peer.retry', attempt: event.attempt + 1, delayMs }, timerId: `retry-${state.peerId}` },
          { type: 'emit', event },
        ],
      ];
    }

    default:
      return [state, []];
  }
}

function handleReconnecting(
  state: PeerReconnectingState,
  event: PeerEvent
): readonly [PeerState, readonly Command[]] {
  switch (event.type) {
    case 'peer.open': {
      const nextState: PeerReadyState = {
        _tag: 'peer.ready',
        peerId: event.peerId,
        connections: new Map(),
        calls: new Map(),
        retryConfig: state.retryConfig,
      };
      return [nextState, [{ type: 'emit', event: { type: 'peer.ready', peerId: event.peerId } }]];
    }

    case 'peer.error': {
      // Fall back to disconnected
      const nextState: PeerDisconnectedState = {
        _tag: 'peer.disconnected',
        peerId: state.peerId,
        retryAttempt: state.retryAttempt,
        retryConfig: state.retryConfig,
        lastKnownConnections: new Map(),
        lastKnownCalls: new Map(),
      };
      return [nextState, [{ type: 'emit', event }]];
    }

    case 'peer.retry': {
      // Trigger another reconnect attempt
      return [state, [{ type: 'peer.reconnect' }]];
    }

    default:
      return [state, []];
  }
}
```

#### 7.2 Media Reducer

```typescript
// src/media/reducer.ts

import type { Reducer, Command } from '../core/types';
import type { MediaState, MediaEvent, MediaPermissions } from './types';
import { v4 as uuidv4 } from 'uuid';

const initialPermissions: MediaPermissions = {
  camera: 'unknown',
  microphone: 'unknown',
};

/**
 * Pure media reducer.
 */
export const mediaReducer: Reducer<MediaState, MediaEvent> = (state, event) => {
  switch (state._tag) {
    case 'media.idle':
      return handleIdle(state, event);
    case 'media.requesting':
      return handleRequesting(state, event);
    case 'media.active':
      return handleActive(state, event);
    case 'media.switching':
      return handleSwitching(state, event);
    case 'media.recovering':
      return handleRecovering(state, event);
    case 'media.denied':
      return handleDenied(state, event);
    case 'media.checkingPermissions':
      return handleCheckingPermissions(state, event);
    case 'media.error':
      return [state, []];
    default:
      return [state, []];
  }
};

function handleIdle(
  state: MediaState & { _tag: 'media.idle' },
  event: MediaEvent
): readonly [MediaState, readonly Command[]] {
  switch (event.type) {
    case 'media.request': {
      const requestId = uuidv4();
      const nextState: MediaState = {
        _tag: 'media.requesting',
        mode: event.mode,
        constraints: event.constraints,
        permissions: state.permissions,
        requestId,
      };
      const cmd: Command = event.mode === 'screen'
        ? { type: 'media.navigator.getDisplayMedia', constraints: event.constraints, requestId }
        : { type: 'media.navigator.getUserMedia', constraints: event.constraints, requestId };
      return [nextState, [cmd]];
    }

    case 'media.permission.status': {
      return [{ ...state, permissions: event.permissions }, []];
    }

    default:
      return [state, []];
  }
}

function handleRequesting(
  state: MediaState & { _tag: 'media.requesting' },
  event: MediaEvent
): readonly [MediaState, readonly Command[]] {
  switch (event.type) {
    case 'media.stream.acquired': {
      const nextState: MediaState = {
        _tag: 'media.active',
        stream: event.stream,
        devices: event.devices,
        mode: state.mode,
        constraints: state.constraints,
        permissions: state.permissions,
        audioMuted: false,
        videoMuted: false,
      };
      return [nextState, [{ type: 'emit', event: { type: 'media.stream.ready', stream: event.stream, mode: state.mode } }]];
    }

    case 'media.stream.error': {
      const isPermissionDenied = event.error instanceof DOMException &&
        (event.error.name === 'NotAllowedError' || event.error.name === 'PermissionDeniedError');
      
      if (isPermissionDenied) {
        const nextState: MediaState = {
          _tag: 'media.denied',
          permissions: state.permissions,
        };
        return [nextState, [{ type: 'emit', event: { type: 'media.permission.denied' } }]];
      }
      
      const nextState: MediaState = {
        _tag: 'media.error',
        error: event.error,
        permissions: state.permissions,
      };
      return [nextState, [{ type: 'emit', event }]];
    }

    case 'media.stop': {
      const nextState: MediaState = {
        _tag: 'media.idle',
        permissions: state.permissions,
      };
      return [nextState, [{ type: 'emit', event: { type: 'media.stream.stopped' } }]];
    }

    default:
      return [state, []];
  }
}

function handleActive(
  state: MediaState & { _tag: 'media.active' },
  event: MediaEvent
): readonly [MediaState, readonly Command[]] {
  switch (event.type) {
    case 'media.toggleMute': {
      const audioMuted = event.kind === 'audio' ? !state.audioMuted : state.audioMuted;
      const videoMuted = event.kind === 'video' ? !state.videoMuted : state.videoMuted;
      const nextState: MediaState = { ...state, audioMuted, videoMuted };
      const cmd: Command = {
        type: 'media.stream.applyMute',
        stream: state.stream,
        audioMuted,
        videoMuted,
      };
      return [nextState, [cmd, { type: 'emit', event: { type: `media.${event.kind}.toggled` as any, muted: event.kind === 'audio' ? audioMuted : videoMuted } }]];
    }

    case 'media.track.ended': {
      if (state.mode === 'screen') {
        // User intentionally stopped screen share
        return [
          { _tag: 'media.idle', permissions: state.permissions },
          [
            { type: 'media.stream.stopAll', stream: state.stream },
            { type: 'emit', event: { type: 'media.stream.stopped' } },
          ],
        ];
      }
      // Attempt recovery for user media
      const nextState: MediaState = {
        _tag: 'media.recovering',
        oldStream: state.stream,
        mode: state.mode,
        constraints: state.constraints,
        permissions: state.permissions,
      };
      return [nextState, [{ type: 'emit', event: { type: 'media.recovering' } }]];
    }

    case 'media.switchDevice': {
      const nextState: MediaState = {
        _tag: 'media.switching',
        stream: state.stream,
        mode: state.mode,
        kind: event.kind,
        deviceId: event.deviceId,
        permissions: state.permissions,
      };
      return [nextState, []];
    }

    case 'media.stop': {
      return [
        { _tag: 'media.idle', permissions: state.permissions },
        [
          { type: 'media.stream.stopAll', stream: state.stream },
          { type: 'emit', event: { type: 'media.stream.stopped' } },
        ],
      ];
    }

    default:
      return [state, []];
  }
}

function handleSwitching(
  state: MediaState & { _tag: 'media.switching' },
  event: MediaEvent
): readonly [MediaState, readonly Command[]] {
  switch (event.type) {
    case 'media.device.switched': {
      // Re-acquire devices list and return to active
      return [state, [{ type: 'media.navigator.enumerateDevices' }]];
    }

    case 'media.device.switch.failed': {
      // Return to active with existing stream
      const nextState: MediaState = {
        _tag: 'media.active',
        stream: state.stream,
        devices: [], // Will be updated asynchronously
        mode: state.mode,
        constraints: {},
        permissions: state.permissions,
        audioMuted: false,
        videoMuted: false,
      };
      return [nextState, [{ type: 'emit', event }]];
    }

    default:
      return [state, []];
  }
}

function handleRecovering(
  state: MediaState & { _tag: 'media.recovering' },
  event: MediaEvent
): readonly [MediaState, readonly Command[]] {
  switch (event.type) {
    case 'media.stream.acquired': {
      const nextState: MediaState = {
        _tag: 'media.active',
        stream: event.stream,
        devices: event.devices,
        mode: state.mode,
        constraints: state.constraints,
        permissions: state.permissions,
        audioMuted: false,
        videoMuted: false,
      };
      return [
        nextState,
        [
          { type: 'media.stream.stopAll', stream: state.oldStream },
          { type: 'emit', event: { type: 'media.stream.ready', stream: event.stream, mode: state.mode } },
        ],
      ];
    }

    case 'media.stream.error':
    case 'media.permission.denied': {
      return [
        { _tag: 'media.idle', permissions: state.permissions },
        [
          { type: 'media.stream.stopAll', stream: state.oldStream },
          { type: 'emit', event },
        ],
      ];
    }

    default:
      return [state, []];
  }
}

function handleDenied(
  state: MediaState & { _tag: 'media.denied' },
  event: MediaEvent
): readonly [MediaState, readonly Command[]] {
  switch (event.type) {
    case 'media.request': {
      // Allow retry from denied state
      return handleIdle({ _tag: 'media.idle', permissions: state.permissions }, event);
    }

    default:
      return [state, []];
  }
}

function handleCheckingPermissions(
  state: MediaState & { _tag: 'media.checkingPermissions' },
  event: MediaEvent
): readonly [MediaState, readonly Command[]] {
  switch (event.type) {
    case 'media.permission.status': {
      return [{ _tag: 'media.idle', permissions: event.permissions }, []];
    }

    default:
      return [state, []];
  }
}
```

#### 7.3 Effect Interpreter

```typescript
// src/core/interpreter.ts

import type { Command, Event, State, CommandHandler } from './types';

/**
 * Configuration for the interpreter.
 */
export interface InterpreterConfig {
  readonly handlers: Map<string, CommandHandler>;
  readonly onStateChange?: (state: State, prevState: State) => void;
  readonly onError?: (error: Error, context: { state: State; command: Command }) => void;
}

/**
 * Interpreter executes commands and dispatches events back to the reducer.
 */
export class Interpreter<S extends State, E extends Event> {
  private state: S;
  private reducer: (state: S, event: E) => readonly [S, readonly Command[]];
  private handlers: Map<string, CommandHandler>;
  private onStateChange?: (state: S, prevState: S) => void;
  private onError?: (error: Error, context: { state: S; command: Command }) => void;
  private pendingCommands: Command[] = [];
  private isProcessing = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    initialState: S,
    reducer: (state: S, event: E) => readonly [S, readonly Command[]],
    config: InterpreterConfig
  ) {
    this.state = initialState;
    this.reducer = reducer;
    this.handlers = config.handlers;
    this.onStateChange = config.onStateChange;
    this.onError = config.onError;
  }

  /**
   * Get current state (immutable snapshot).
   */
  getState(): S {
    return this.state;
  }

  /**
   * Dispatch an event to the reducer and execute resulting commands.
   */
  async dispatch(event: E): Promise<void> {
    const prevState = this.state;
    const [nextState, commands] = this.reducer(this.state, event);
    
    this.state = nextState;
    
    if (this.state !== prevState && this.onStateChange) {
      this.onStateChange(this.state, prevState);
    }

    // Queue commands for execution
    this.pendingCommands.push(...commands);
    
    // Process command queue
    if (!this.isProcessing) {
      await this.processCommandQueue();
    }
  }

  /**
   * Process all pending commands.
   */
  private async processCommandQueue(): Promise<void> {
    this.isProcessing = true;
    
    while (this.pendingCommands.length > 0) {
      const command = this.pendingCommands.shift()!;
      await this.executeCommand(command);
    }
    
    this.isProcessing = false;
  }

  /**
   * Execute a single command.
   */
  private async executeCommand(command: Command): Promise<void> {
    // Handle built-in commands
    if (command.type === 'schedule.timeout') {
      const timerId = command.timerId;
      const handler = () => {
        this.dispatch(command.event as E);
      };
      const timer = setTimeout(handler, command.delayMs);
      this.timers.set(timerId, timer);
      return;
    }

    if (command.type === 'schedule.cancelTimeout') {
      const timer = this.timers.get(command.timerId);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(command.timerId);
      }
      return;
    }

    if (command.type === 'emit') {
      // Emit event is handled by the caller through subscriptions
      // This is a no-op in the interpreter — events are emitted via onStateChange
      return;
    }

    // Delegate to registered handlers
    const handler = this.handlers.get(command.type);
    if (!handler) {
      console.warn(`No handler registered for command type: ${command.type}`);
      return;
    }

    try {
      const events = await handler(command);
      for (const event of events) {
        await this.dispatch(event as E);
      }
    } catch (error) {
      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)), {
          state: this.state,
          command,
        });
      }
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingCommands = [];
  }
}
```

#### 7.4 Runtime with PeerJS Integration

```typescript
// src/peer/runtime.ts

import type { Peer, DataConnection, MediaConnection, PeerError } from 'peerjs';
import type { Command, Event, CommandHandler, InterpreterConfig } from '../core/types';
import { Interpreter } from '../core/interpreter';
import { peerReducer } from './reducer';
import type { PeerState, PeerEvent, PeerId, ConnectionId, CallId } from './types';

/**
 * PeerRuntime wraps PeerJS and translates its events to domain events.
 */
export class PeerRuntime {
  private interpreter: Interpreter<PeerState, PeerEvent>;
  private peer: Peer;
  private listeners: Map<string, Set<(event: PeerEvent) => void>> = new Map();
  private callRuntimes: Map<CallId, CallRuntime> = new Map();
  private connectionRuntimes: Map<ConnectionId, ConnectionRuntime> = new Map();

  constructor(peer: Peer) {
    this.peer = peer;
    
    const initialState: PeerState = {
      _tag: 'peer.initializing',
      peerId: null,
      retryConfig: {
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 30_000,
        backoffMultiplier: 2,
      },
    };

    const handlers = this.createHandlers();
    
    this.interpreter = new Interpreter(initialState, peerReducer, {
      handlers,
      onStateChange: (state, prevState) => {
        this.emitStateChange(state, prevState);
      },
      onError: (error, ctx) => {
        console.error('PeerRuntime error:', error, ctx);
      },
    });

    this.setupPeerListeners();
  }

  private createHandlers(): Map<string, CommandHandler> {
    const handlers = new Map<string, CommandHandler>();

    handlers.set('peer.connect', async (cmd) => {
      const command = cmd as { type: 'peer.connect'; remotePeerId: PeerId };
      const connection = this.peer.connect(command.remotePeerId);
      this.setupConnectionListeners(connection);
      return [];
    });

    handlers.set('peer.call', async (cmd) => {
      const command = cmd as { type: 'peer.call'; remotePeerId: PeerId; localStream: MediaStream };
      const call = this.peer.call(command.remotePeerId, command.localStream);
      this.setupCallListeners(call);
      return [];
    });

    handlers.set('peer.reconnect', async () => {
      this.peer.reconnect();
      return [];
    });

    handlers.set('peer.destroy', async () => {
      this.peer.destroy();
      return [];
    });

    handlers.set('connection.close', async (cmd) => {
      const command = cmd as { type: 'connection.close'; connectionId: ConnectionId };
      const runtime = this.connectionRuntimes.get(command.connectionId);
      if (runtime) {
        runtime.close();
        this.connectionRuntimes.delete(command.connectionId);
      }
      return [];
    });

    return handlers;
  }

  private setupPeerListeners(): void {
    this.peer.on('open', (id) => {
      void this.interpreter.dispatch({ type: 'peer.open', peerId: id });
    });

    this.peer.on('connection', (conn) => {
      this.setupConnectionListeners(conn);
      const event: PeerEvent = {
        type: 'peer.connection.incoming',
        connectionId: conn.connectionId as ConnectionId,
        remotePeerId: conn.peer as PeerId,
      };
      void this.interpreter.dispatch(event);
    });

    this.peer.on('call', (call) => {
      this.setupCallListeners(call);
      const event: PeerEvent = {
        type: 'peer.call.incoming',
        callId: call.connectionId as CallId,
        remotePeerId: call.peer as PeerId,
      };
      void this.interpreter.dispatch(event);
    });

    this.peer.on('disconnected', () => {
      void this.interpreter.dispatch({ type: 'peer.disconnect' });
    });

    this.peer.on('error', (error: PeerError<string>) => {
      void this.interpreter.dispatch({ type: 'peer.error', error });
    });

    this.peer.on('close', () => {
      void this.interpreter.dispatch({ type: 'peer.close' });
    });
  }

  private setupConnectionListeners(connection: DataConnection): void {
    connection.on('open', () => {
      // Connection opened — handled by ConnectionRuntime
    });

    connection.on('data', (data) => {
      // Route signaling messages
      const message = data as { type: string; callId?: string };
      if (message.callId) {
        const callRuntime = this.callRuntimes.get(message.callId as CallId);
        if (callRuntime) {
          callRuntime.handleSignalingMessage(message);
        }
      }
    });

    connection.on('close', () => {
      const state = this.interpreter.getState();
      if (state._tag === 'peer.ready') {
        const connections = new Map(state.connections);
        connections.delete(connection.connectionId as ConnectionId);
        // Update state would go through reducer
      }
    });
  }

  private setupCallListeners(call: MediaConnection): void {
    call.on('stream', (stream) => {
      // Stream received
    });

    call.on('close', () => {
      // Call closed
    });

    call.on('error', (error) => {
      // Call error
    });
  }

  private emitStateChange(state: PeerState, prevState: PeerState): void {
    // Notify all subscribers
    const listeners = this.listeners.get('state') ?? new Set();
    for (const listener of listeners) {
      // This is a simplified version — real implementation would emit proper events
    }
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(listener: (event: PeerEvent) => void): { unsubscribe: () => void } {
    const key = 'event';
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);
    return {
      unsubscribe: () => {
        this.listeners.get(key)?.delete(listener);
      },
    };
  }

  /**
   * Get current state.
   */
  getState(): PeerState {
    return this.interpreter.getState();
  }

  /**
   * Dispatch an event.
   */
  dispatch(event: PeerEvent): Promise<void> {
    return this.interpreter.dispatch(event);
  }

  /**
   * Clean up.
   */
  destroy(): void {
    this.interpreter.destroy();
    this.peer.off('open');
    this.peer.off('connection');
    this.peer.off('call');
    this.peer.off('disconnected');
    this.peer.off('error');
    this.peer.off('close');
    this.listeners.clear();
  }
}

// Placeholder for CallRuntime and ConnectionRuntime
class CallRuntime {
  handleSignalingMessage(message: { type: string }): void {
    // Implementation
  }
}

class ConnectionRuntime {
  close(): void {
    // Implementation
  }
}
```

---

### Section 9: Critical Path Walkthrough

Here's the complete flow for an **incoming call from peer B to peer A**:

```
1. User B calls User A
   ├─ PeerJS signaling server routes call to peer A
   └─ WebRTC offer arrives at peer A's browser

2. PeerJS emits 'call' event on Peer A
   ├─ PeerRuntime.setupPeerListeners() receives event
   └─ Calls this.peer.on('call', callback)

3. PeerRuntime handles incoming call
   ├─ Creates CallRuntime for the MediaConnection
   ├─ Dispatches PeerEvent: { type: 'peer.call.incoming', callId, remotePeerId }
   └─ Sets up call listeners (stream, close, error)

4. peerReducer processes the event
   ├─ Current state: PeerReadyState
   ├─ handleReady() matches 'peer.call.incoming'
   └─ Produces: [PeerReadyState with call added, [{ type: 'emit', event: 'call.incoming' }]]

5. Interpreter executes command
   ├─ Command type: 'emit'
   ├─ Interpreter calls onStateChange callback
   └─ PeerFacade emits event to subscribers

6. Application receives call.incoming event
   ├─ UI shows incoming call modal
   └─ User decides: answer or reject

7a. User A answers the call
   ├─ UI calls: peerManager.answer(callId, localStream)
   ├─ PeerFacade dispatches: { type: 'call.answer', callId, localStream }
   ├─ callReducer processes in CallRingingState
   ├─ Produces: [CallConnectingState, [{ type: 'call.peerjs.answer', localStream }]]
   ├─ Interpreter executes: call.answer(localStream)
   └─ PeerJS sends WebRTC answer to peer B

7b. Or: User A rejects the call
   ├─ UI calls: peerManager.reject(callId)
   ├─ callReducer produces: [CallEndedState, [{ type: 'call.signal.reject' }]]
   ├─ Interpreter sends signaling message via DataConnection
   └─ Peer B receives rejection notification

8. (If answered) WebRTC stream established
   ├─ MediaConnection fires 'stream' event
   ├─ CallRuntime receives remote stream
   ├─ Dispatches: { type: 'call.stream', stream }
   └─ callReducer transitions: CallConnectingState → CallLiveState

9. Call is now live
   ├─ State: CallLiveState with remoteStream
   ├─ UI displays remote video
   └─ User can mute/unmute, switch devices
```

**Key observability points:**
- Every transition logged via `onStateChange` callback
- Errors captured in `Interpreter.onError` with state context
- Signaling messages logged in `SignalingService` (existing)

---

### Section 10: Testing Strategy

#### 10.1 Test Infrastructure Setup

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'src/**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
```

#### 10.2 PeerJS Mock

```typescript
// test/mocks/peerjs.ts

import { vi } from 'vitest';

export function createMockPeer(id: string = 'test-peer-id') {
  return {
    id,
    open: true,
    destroyed: false,
    connect: vi.fn().mockReturnValue(createMockDataConnection()),
    call: vi.fn().mockReturnValue(createMockMediaConnection()),
    reconnect: vi.fn(),
    destroy: vi.fn().mockImplementation(function (this: any) {
      this.destroyed = true;
      this.open = false;
    }),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };
}

export function createMockDataConnection(peer: string = 'remote-peer') {
  return {
    peer,
    connectionId: `conn-${Math.random().toString(36).slice(2)}`,
    open: false,
    type: 'data',
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };
}

export function createMockMediaConnection(peer: string = 'remote-peer') {
  return {
    peer,
    connectionId: `call-${Math.random().toString(36).slice(2)}`,
    open: false,
    answer: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    localStream: null as MediaStream | null,
    remoteStream: null as MediaStream | null,
  };
}

export function createMockStream(video: boolean = true, audio: boolean = true): MediaStream {
  const stream = {
    id: `stream-${Math.random().toString(36).slice(2)}`,
    active: true,
    getTracks: vi.fn().mockReturnValue([
      ...(video ? [{ kind: 'video', enabled: true, stop: vi.fn(), readyState: 'live' }] : []),
      ...(audio ? [{ kind: 'audio', enabled: true, stop: vi.fn(), readyState: 'live' }] : []),
    ]),
    getVideoTracks: vi.fn().mockReturnValue(
      video ? [{ kind: 'video', enabled: true, stop: vi.fn(), readyState: 'live' }] : []
    ),
    getAudioTracks: vi.fn().mockReturnValue(
      audio ? [{ kind: 'audio', enabled: true, stop: vi.fn(), readyState: 'live' }] : []
    ),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    getTrackById: vi.fn(),
    clone: vi.fn(),
  } as unknown as MediaStream;
  return stream;
}
```

#### 10.3 Reducer Unit Tests

```typescript
// src/peer/reducer.test.ts

import { describe, it, expect } from 'vitest';
import { peerReducer } from './reducer';
import type { PeerState, PeerEvent } from './types';
import { DEFAULT_RETRY_CONFIG } from './types';

describe('peerReducer', () => {
  describe('PeerInitializingState', () => {
    const initialState: PeerState = {
      _tag: 'peer.initializing',
      peerId: null,
      retryConfig: DEFAULT_RETRY_CONFIG,
    };

    it('should transition to ready on peer.open', () => {
      const event: PeerEvent = { type: 'peer.open', peerId: 'peer-123' };
      const [nextState, commands] = peerReducer(initialState, event);

      expect(nextState._tag).toBe('peer.ready');
      if (nextState._tag === 'peer.ready') {
        expect(nextState.peerId).toBe('peer-123');
      }
      expect(commands).toHaveLength(1);
      expect(commands[0].type).toBe('emit');
    });

    it('should transition to error on fatal peer.error', () => {
      const error = { type: 'browser-incompatible', message: 'Browser not supported' };
      const event: PeerEvent = { type: 'peer.error', error: error as any };
      const [nextState, commands] = peerReducer(initialState, event);

      expect(nextState._tag).toBe('peer.error');
      if (nextState._tag === 'peer.error') {
        expect(nextState.recoverable).toBe(false);
      }
    });

    it('should stay in initializing on non-fatal peer.error', () => {
      const error = { type: 'network', message: 'Network error' };
      const event: PeerEvent = { type: 'peer.error', error: error as any };
      const [nextState, commands] = peerReducer(initialState, event);

      expect(nextState._tag).toBe('peer.initializing');
      expect(commands).toHaveLength(1);
    });

    it('should transition to destroyed on peer.close', () => {
      const event: PeerEvent = { type: 'peer.close' };
      const [nextState] = peerReducer(initialState, event);

      expect(nextState._tag).toBe('peer.destroyed');
    });
  });

  describe('PeerReadyState', () => {
    const initialState: PeerState = {
      _tag: 'peer.ready',
      peerId: 'peer-123',
      connections: new Map(),
      calls: new Map(),
      retryConfig: DEFAULT_RETRY_CONFIG,
    };

    it('should add incoming connection to map', () => {
      const event: PeerEvent = {
        type: 'peer.connection.incoming',
        connectionId: 'conn-456',
        remotePeerId: 'remote-peer',
      };
      const [nextState] = peerReducer(initialState, event);

      expect(nextState._tag).toBe('peer.ready');
      if (nextState._tag === 'peer.ready') {
        expect(nextState.connections.size).toBe(1);
        expect(nextState.connections.has('conn-456')).toBe(true);
      }
    });

    it('should transition to disconnected on peer.disconnect', () => {
      const event: PeerEvent = { type: 'peer.disconnect' };
      const [nextState] = peerReducer(initialState, event);

      expect(nextState._tag).toBe('peer.disconnected');
      if (nextState._tag === 'peer.disconnected') {
        expect(nextState.peerId).toBe('peer-123');
      }
    });
  });

  describe('PeerDisconnectedState', () => {
    const initialState: PeerState = {
      _tag: 'peer.disconnected',
      peerId: 'peer-123',
      retryAttempt: 0,
      retryConfig: DEFAULT_RETRY_CONFIG,
      lastKnownConnections: new Map(),
      lastKnownCalls: new Map(),
    };

    it('should schedule retry on peer.retry', () => {
      const event: PeerEvent = { type: 'peer.retry', attempt: 0, delayMs: 1000 };
      const [nextState, commands] = peerReducer(initialState, event);

      expect(nextState._tag).toBe('peer.reconnecting');
      expect(commands.some(c => c.type === 'schedule.timeout')).toBe(true);
    });

    it('should transition to error after max retries', () => {
      const event: PeerEvent = { type: 'peer.retry', attempt: 5, delayMs: 1000 };
      const [nextState, commands] = peerReducer(initialState, event);

      expect(nextState._tag).toBe('peer.error');
      expect(commands.some(c => c.type === 'emit' && (c as any).event?.type === 'peer.retry.exhausted')).toBe(true);
    });
  });
});
```

#### 10.4 Property-Based Tests

```typescript
// src/peer/reducer.property.test.ts

import { describe, it, expect } from 'vitest';
import { fc, it as propertyIt } from '@fast-check/vitest';
import { peerReducer } from './reducer';
import type { PeerState, PeerEvent } from './types';
import { DEFAULT_RETRY_CONFIG } from './types';

describe('peerReducer properties', () => {
  // Generator for PeerEvent
  const peerEventArbitrary = fc.oneof(
    fc.record({ type: fc.constant('peer.open'), peerId: fc.string() }),
    fc.record({ type: fc.constant('peer.disconnect') }),
    fc.record({ type: fc.constant('peer.close') }),
    fc.record({ type: fc.constant('peer.retry'), attempt: fc.nat(10), delayMs: fc.nat(30000) })
  );

  // Generator for valid PeerState
  const peerStateArbitrary = fc.oneof(
    fc.record({
      _tag: fc.constant('peer.initializing'),
      peerId: fc.oneof(fc.string(), fc.constant(null)),
      retryConfig: fc.record({
        maxAttempts: fc.nat(10),
        baseDelayMs: fc.nat(5000),
        maxDelayMs: fc.nat(60000),
        backoffMultiplier: fc.nat(5),
      }),
    }),
    fc.record({
      _tag: fc.constant('peer.ready'),
      peerId: fc.string(),
      connections: fc.constant(new Map()),
      calls: fc.constant(new Map()),
      retryConfig: fc.constant(DEFAULT_RETRY_CONFIG),
    })
  );

  propertyIt('should always return a valid state', [peerStateArbitrary, peerEventArbitrary], (state, event) => {
    const [nextState, commands] = peerReducer(state as PeerState, event as PeerEvent);

    // State must have a valid _tag
    expect(nextState).toHaveProperty('_tag');
    expect(['peer.initializing', 'peer.ready', 'peer.disconnected', 'peer.reconnecting', 'peer.error', 'peer.destroyed'])
      .toContain(nextState._tag);

    // Commands must be an array
    expect(Array.isArray(commands)).toBe(true);
  });

  propertyIt('should be idempotent for terminal states', [peerEventArbitrary], (event) => {
    const errorState: PeerState = { _tag: 'peer.error', error: {} as any, recoverable: false };
    const destroyedState: PeerState = { _tag: 'peer.destroyed' };

    const [nextError] = peerReducer(errorState, event as PeerEvent);
    const [nextDestroyed] = peerReducer(destroyedState, event as PeerEvent);

    expect(nextError).toBe(errorState);
    expect(nextDestroyed).toBe(destroyedState);
  });

  propertyIt('should never produce invalid command sequences', [peerStateArbitrary, peerEventArbitrary], (state, event) => {
    const [, commands] = peerReducer(state as PeerState, event as PeerEvent);

    // Commands with side effects should not appear together in conflicting ways
    const connectCommands = commands.filter(c => c.type === 'peer.connect');
    const destroyCommands = commands.filter(c => c.type === 'peer.destroy');

    // Should not have both connect and destroy in same command batch
    expect(!(connectCommands.length > 0 && destroyCommands.length > 0)).toBe(true);
  });
});
```

#### 10.5 Integration Tests

```typescript
// src/peer/runtime.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeerRuntime } from './runtime';
import { createMockPeer, createMockStream } from '../../test/mocks/peerjs';

describe('PeerRuntime', () => {
  it('should initialize and emit ready event', async () => {
    const mockPeer = createMockPeer('test-peer-id');
    const onReady = vi.fn();
    const onError = vi.fn();

    const runtime = new PeerRuntime(mockPeer as any);
    runtime.subscribe(onReady);

    // Simulate PeerJS 'open' event
    const openHandler = mockPeer.on.mock.calls.find(call => call[0] === 'open')?.[1];
    if (openHandler) {
      openHandler('test-peer-id');
    }

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(runtime.getState()._tag).toBe('peer.ready');
    if (runtime.getState()._tag === 'peer.ready') {
      expect(runtime.getState().peerId).toBe('test-peer-id');
    }
  });

  it('should handle incoming call', async () => {
    const mockPeer = createMockPeer('test-peer-id');
    const runtime = new PeerRuntime(mockPeer as any);

    // Initialize to ready state
    const openHandler = mockPeer.on.mock.calls.find(call => call[0] === 'open')?.[1];
    if (openHandler) openHandler('test-peer-id');

    // Simulate incoming call
    const callHandler = mockPeer.on.mock.calls.find(call => call[0] === 'call')?.[1];
    const mockCall = {
      peer: 'remote-peer',
      connectionId: 'call-123',
      answer: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    if (callHandler) {
      callHandler(mockCall);
    }

    await new Promise(resolve => setTimeout(resolve, 0));

    const state = runtime.getState();
    if (state._tag === 'peer.ready') {
      expect(state.calls.size).toBe(1);
      expect(state.calls.has('call-123')).toBe(true);
    }
  });
});
```

#### 10.6 Test Coverage Summary

| Layer | Test Type | Coverage Target |
|-------|-----------|-----------------|
| Domain Types | Unit | 90% |
| Reducers | Unit + Property | 85% |
| Interpreter | Unit | 80% |
| Runtime | Integration | 75% |
| Handlers | Unit | 80% |

---

### Section 11: Non-Functional Considerations

- **Deployment**: npm package with ESM/CJS dual output via tsup; peer dependency on PeerJS
- **Security**: No secrets in library; all WebRTC connections via PeerJS's secure signaling; user must validate incoming call peerId
- **Performance**: Pure reducers enable efficient re-rendering; immutable states support React.memo out of box; no memory leaks via explicit destroy()

---

## Traceability Matrix

| ID | Requirement | Domain | Implementation Target | Status |
|---|---|---|---|---|
| R-01 | Split large state files into smaller modules | Core | `src/core/types.ts`, `src/peer/types.ts`, `src/call/types.ts`, `src/media/types.ts` | TODO |
| R-02 | Pure state reducers (no side effects in handlers) | Core | `src/peer/reducer.ts`, `src/media/reducer.ts`, `src/call/reducer.ts` | TODO |
| R-03 | Typed errors with Result<T, E> | Core | `src/core/types.ts` - `Result<T, E>` type, `Result` utilities | TODO |
| R-04 | Comprehensive test coverage | All | `vitest.config.ts`, test files in each domain, mocks in `test/mocks/` | TODO |
| R-05 | Race condition handling for concurrent operations | Peer | Deduplication checks in `handleReady()` before spawning children | TODO |
| R-06 | Error recovery mechanisms | Peer/Call | `PeerReconnectingState`, `MediaRecoveringState`, retry logic with exponential backoff | TODO |
| R-07 | Maintain backward API compatibility | Core | Facade pattern - `PeerManager` wraps `PeerRuntime`, emits same events | TODO |
| R-08 | Explicit runtime configuration | Core | `InterpreterConfig`, `RetryConfig`, `CallConfig` typed interfaces | TODO |

---

## Implementation Order

```
Phase A: Core Effect System (Week 1)
├─ [ ] Create src/core/types.ts with State, Event, Command, Result types
├─ [ ] Implement src/core/interpreter.ts
├─ [ ] Add Vitest configuration
└─ [ ] Write unit tests for interpreter

Phase B: Domain Types (Week 1-2)
├─ [ ] Create src/peer/types.ts with all peer states/events
├─ [ ] Create src/call/types.ts with all call states/events
├─ [ ] Create src/media/types.ts with all media states/events
└─ [ ] Write unit tests for domain types

Phase C: Reducers (Week 2-3)
├─ [ ] Implement src/peer/reducer.ts
├─ [ ] Implement src/call/reducer.ts
├─ [ ] Implement src/media/reducer.ts
├─ [ ] Write unit tests for reducers
└─ [ ] Add property-based tests

Phase D: Runtime Integration (Week 3-4)
├─ [ ] Implement src/peer/runtime.ts with PeerJS integration
├─ [ ] Implement src/media/runtime.ts
├─ [ ] Create PeerJS mocks for testing
└─ [ ] Write integration tests

Phase E: Facade & Backward Compatibility (Week 4)
├─ [ ] Create backward-compatible PeerManager facade
├─ [ ] Create backward-compatible MediaMachine facade
├─ [ ] Ensure public API matches existing exports
└─ [ ] Add deprecation warnings if API changed

Phase F: Documentation (Week 5)
├─ [ ] Update AGENTS.md with new architecture
├─ [ ] Add JSDoc to all public APIs
└─ [ ] Create migration guide for existing users
```

---

## Breaking Changes & Migration

### API Compatibility

The refactoring is designed to be **fully backward compatible**. The public API remains unchanged:

```typescript
// Existing API (unchanged)
import { PeerManager, MediaMachine } from 'peerchat';

const peerManager = new PeerManager({ peer });
const mediaMachine = new MediaMachine();

// Subscribe to events (unchanged)
peerManager.on('peer.ready', (event) => { ... });
peerManager.subscribe(() => { ... });

// Access state (unchanged)
const state = peerManager.getState();
```

### Internal Changes

| Component | Before | After |
|-----------|--------|-------|
| State classes | Mutable, methods mutate state | Immutable, pure reducer functions |
| Event handling | Direct callbacks | Dispatched through interpreter |
| Side effects | In state methods | Command handlers |
| Testing | Manual mocking | Vitest + property-based |

### Migration Path for Internal Implementations

If you have internal implementations that depend on:

1. **State classes directly**: Use the new `State` types instead
2. **State methods**: Use the reducer or runtime methods
3. **Event dispatching**: Use `runtime.dispatch()` instead of direct callbacks

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Reducer** | Pure function: `(State, Event) → [State, Command[]]` |
| **Command** | Description of a side effect to execute |
| **Interpreter** | Runtime that executes commands and dispatches events |
| **State** | Immutable snapshot of the system at a point in time |
| **Event** | Something that happened, triggering state transitions |
| **Facade** | Backward-compatible wrapper around new implementation |

---

## Appendix B: References

- [Elm Architecture](https://guide.elm-lang.org/architecture/)
- [Redux](https://redux.js.org/basics/basic-tutorial)
- [XState](https://xstate.js.org/docs/)
- [Vitest](https://vitest.dev/)
- [fast-check](https://fast-check.dev/)