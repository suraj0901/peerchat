# PeerChat Library — Architecture Review & API Redesign

**Date:** 2026-04-12  
**Author:** Architecture Review  
**Status:** Approved for Implementation

---

## Executive Summary

PeerChat is a **WebRTC wrapper around PeerJS** using a state machine architecture. The current design has strong foundations — discriminated unions, command-on-state pattern, child machines — but suffers from **leaky abstractions, internal complexity exposed to consumers, and API surface gaps** that make it harder to use than necessary.

This document contains:
1. Comprehensive architecture review
2. Identified issues (prioritized)
3. Proposed redesigned API
4. Implementation plan (phased)

---

## Part 1: Architecture Review — What's Working Well

### Strengths

| Pattern | Why It Works |
|---------|-------------|
| **State Machine Architecture** | `AbstractMachine` with discriminated union states (`_tag`) is an excellent fit for WebRTC's async, event-driven nature. Every lifecycle phase is explicit and type-safe. |
| **Commands on State** | Narrowing via `_tag` then calling methods is type-safe, discoverable, and prevents invalid operations (e.g., you can't `hangUp()` when the call is `ended`). |
| **Child Machine Pattern** | Spawning `ConnectionMachine` and `CallMachine` per peer/call is the right composition model. Each child manages its own lifecycle independently. |
| **Dual ESM/CJS Exports** | Proper `tsup` configuration with conditional exports ensures compatibility across Node.js, bundlers, and browser environments. |
| **Peer Dependency on PeerJS** | Correct strategy — lets consumers control the PeerJS version and avoids duplicate instances. |
| **Auto-Reconnection** | Built-in retry with exponential backoff is valuable and often missing from similar libraries. |
| **Parallel Data Connections** | Separating signaling (over data channels) from media (over `MediaConnection`) is architecturally sound and enables features like remote-hang-up notification. |

### Current Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Consumer Code                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐              ┌──────────────────┐             │
│  │   PeerManager   │              │   MediaMachine   │             │
│  │                 │              │                  │             │
│  │  States:        │              │  States:         │             │
│  │  - initializing │              │  - idle          │             │
│  │  - ready ◄──────┼──────┐       │  - requesting    │             │
│  │  - disconnected │      │       │  - active        │             │
│  │  - error        │      │       │  - switching     │             │
│  │  - destroyed    │      │       │  - recovering    │             │
│  └────────┬────────┘      │       │  - denied        │             │
│           │               │       └──────────────────┘             │
│           │ spawns        │                                       │
│           ▼               │                                       │
│  ┌─────────────────┐      │                                       │
│  │  CallCoordinator│◄─────┘ (manual wiring by consumer)           │
│  │  ┌───────────┐  │                                              │
│  │  │CallMachine│  │  ┌──────────────────────┐                   │
│  │  │ States:   │  │  │ ConnectionMachine    │                   │
│  │  │ - ringing │  │  │ States:              │                   │
│  │  │ - connect │  │  │  - connecting        │                   │
│  │  │ - live    │  │  │  - open              │                   │
│  │  │ - ended   │  │  │  - closed            │                   │
│  │  │ - error   │  │  │  - error             │                   │
│  │  └───────────┘  │  └──────────────────────┘                   │
│  │                 │                                              │
│  │ ┌────────────────────┐                                        │
│  │ │ SignalingService   │ (internal, over data channel)          │
│  │ └────────────────────┘                                        │
│  └─────────────────┘                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part 2: Critical Issues Found

### 🔴 P0 — API Design Problems

#### 1. State Classes Exported as Public API (Major Issue)

**Problem:** States are exported as **classes**, not interfaces.

```typescript
// Current: consumer sees class constructors
export type PeerState = PeerInitializingState | PeerReadyState | ...;
// These classes have public constructors with implementation-specific params
```

**Consequences:**
- Constructor signatures leak into the type contract
- Consumers can accidentally `new PeerReadyState(...)` with wrong params
- Breaking changes to constructor params = breaking public API
- Implementation details (like `ctx: PeerContext`) are visible in type hints

**Fix:** Export only the **interface** (type), keep classes internal. Use `interface` for state shapes and export those.

---

#### 2. Child Machines Not Exported

**Problem:** `CallMachine`, `ConnectionMachine`, and `CallCoordinator` are internal but consumers **need** to interact with them.

```typescript
// React example has to do this:
for (const [id, machine] of state.calls) {
  const s = machine.callMachine.getState();  // Accesses internal property
  if (s._tag === 'live') { ... }
}
```

The example creates a workaround type `AnyMachine<S>` because proper types aren't exported:
```typescript
export type AnyMachine<S> = {
  subscribe(cb: () => void): { unsubscribe(): void; };
  getState(): S;
  destroy(): void;
};
```

**Fix:** Export `CallMachine` and `ConnectionMachine` as proper classes with typed public APIs.

---

#### 3. Event Constants Not Exported

**Problem:** Event constants exist but are **not** in the public API:

```typescript
// Internal (src/core/events.ts):
export const PeerEvents = { READY: 'peer.ready', ... };
// Not exported from src/index.ts ❌
```

Consumers use string literals — typo-prone:
```typescript
peer.on('call.incomming', ...); // typo, no compile-time error
```

**Fix:** Export `PeerEvents`, `CallEvents`, `ConnectionEvents` from `src/index.ts`.

---

#### 4. No Top-Level API for Sending Data Messages

**Problem:** The library manages data channels but exposes **no convenient API** for consumers to send messages.

To send data, a consumer must:
1. Get peer state: `const state = peer.getState()`
2. Narrow: `if (state._tag === 'ready')`
3. Find connection: iterate `state.connections`
4. Narrow connection state: `if (conn.getState()._tag === 'open')`
5. Call `conn.getState().send(data)`

This is 5+ lines of boilerplate for the most common operation.

**Fix:** Add `PeerManager.send(peerId, data)` as a top-level convenience method.

---

#### 5. MediaMachine is Disconnected from PeerManager

**Problem:** These are two independent machines with **no coordination**:

```typescript
// Consumer must manually wire everything:
media.on('media.stream.ready', ({ stream }) => {
  const state = peer.getState();
  if (state._tag === 'ready') {
    state.call('friend-id', stream);
  }
});
```

**Fix:** Optional integration — `PeerManager.attachMedia(media)` that auto-wires media events to call operations.

---

### 🟡 P1 — Internal Architecture Problems

#### 6. `CallMachineFactory.create` Returns `unknown`

```typescript
// src/core/machine.ts
interface CallMachineFactory {
  create(config: {...}): unknown;  // ← Forces `as CallMachine` cast
}
```

This defeats the purpose of typed factories. The cast in `CallCoordinator`:
```typescript
this.callMachine = factory.create({...}) as CallMachine;
```

**Fix:** Return `CallMachine` directly.

---

#### 7. `CallContext.sendRemoteCallEndedMessage` is Structurally Awkward

The context interface requires this method, but it's assigned **post-construction** via closure mutation:

```typescript
// In CallCoordinator constructor:
const defaultFactory: CallMachineFactory = {
  create: (cfg) => new CallMachine(
    cfg.call,
    cfg.callId,
    cfg.remotePeerId,
    cfg.direction,
    (reason, callId) => {
      if (reason === 'rejected') {
        config.signalingService.sendCallRejected(callId, this.remotePeerId);
      } else {
        config.signalingService.sendCallDeclined(callId, this.remotePeerId);
      }
    },
  ),
};
```

The `CallContext` interface declares `sendRemoteCallEndedMessage`, but the context is created without this property and it's added later, bypassing TypeScript's structural typing safety.

**Fix:** Pass signaling callback as a constructor parameter to `CallMachine`, not via context mutation.

---

#### 8. `PeerReadyState` is a God Object (~450 lines)

Responsibilities crammed into one class:
- PeerJS event handling (open, error, close, disconnected)
- Data connection lifecycle (spawn, track, remove)
- Call lifecycle (spawn CallCoordinator, track, remove)
- SignalingService creation and management
- Child cleanup on error/close
- Reconnection logic

**Fix:** Extract into separate concerns:
- `PeerConnectionManager` — manages data connections
- `PeerCallManager` — manages calls and coordinators
- `PeerReadyState` — coordinates the two, handles PeerJS events

---

#### 9. Mutable Maps with Same Reference

```typescript
public readonly connections: Map<string, ConnectionMachine>,
public readonly calls: Map<string, CallCoordinator>,
```

The Maps are `readonly` (can't reassign) but **mutable** (can add/delete entries). This breaks React's `useSyncExternalStore` because the state reference doesn't change:

```typescript
// useSyncExternalStore uses Object.is — misses Map mutations
const state = useSyncExternalStore(subscribe, () => machine.getState());
// state.calls reference is same even after adding/removing entries
```

The React example uses `useReducer` as a workaround:
```typescript
const [, forceUpdate] = useReducer((c: number) => c + 1, 0);
```

**Fix:** Return immutable snapshots from the public API. Keep Maps internal for performance.

---

#### 10. `MediaActiveState` Mutates Readonly Property

```typescript
// In devicechange handler:
(this as { devices: MediaDeviceInfo[] }).devices = devices;
```

Type assertion circumventing `readonly`. This is a code smell indicating the design doesn't match the intent.

**Fix:** Use a separate mutable `private currentDevices` field, expose via getter.

---

#### 11. Zero Test Coverage

No test files exist. The `test-call.ts` file is a transition table definition that doesn't compile (`TransitionTable` is not exported).

**Fix:** Add comprehensive unit tests for:
- State transitions (happy path and error paths)
- Event emission
- Child machine lifecycle
- Signaling message routing
- Media permission flows

---

#### 12. `SignalingService` Has Redundant Code

Three nearly identical send methods:
```typescript
sendRemoteClose(callId, remotePeerId) { ... }
sendCallRejected(callId, remotePeerId) { ... }
sendCallDeclined(callId, remotePeerId) { ... }
```

Three identical `handleMessage` branches that do the same thing with different `type` checks.

**Fix:** Single `sendSignalingMessage(type, callId, remotePeerId)` and a dispatch table for handlers.

---

## Part 3: Proposed API Redesign

### Design Philosophy

> **"Simple things should be simple, complex things should be possible."**
> — Alan Kay

The library should have **two consumption tiers**:

| Tier | Audience | API Style | % of Users |
|------|----------|-----------|-----------|
| **Simple** | App developers | Direct methods, callbacks, minimal state management | ~80% |
| **Advanced** | Framework integrations, testing | Full machine access, state subscription, event streams | ~20% |

### Proposed Public API

#### Tier 1: Simple API (Primary Entry Point)

```typescript
// ── Factory Functions (Primary API) ─────────────────────────────────

import { createPeer, createMedia } from 'peerchat';

// Create a peer with sensible defaults
const peer = createPeer({
  peerId?: string,              // optional, auto-generated by PeerJS
  peerJsOptions?: Peer.Options, // forwarded to PeerJS
  logging?: boolean,            // default false
  maxRetries?: number,          // default 5
  baseRetryDelay?: number,      // default 1000ms
});

// Create media independently
const media = createMedia({
  autoPermissions?: boolean,    // check permissions on creation, default true
});

// Optional: attach media to peer for automatic stream handling
peer.attachMedia(media);

// ── Direct Methods (no state narrowing needed) ─────────────────────

// Connect to a peer (idempotent — skips if already connected)
peer.connect('remote-id');

// Send data (auto-connects if no open connection)
peer.send('remote-id', { type: 'chat', text: 'hello' });

// Make a call
peer.call('remote-id');                        // uses attached media
peer.call('remote-id', { stream: myStream });  // explicit stream
peer.call('remote-id', { audio: true, video: true }); // acquire media first

// Hang up a specific call
peer.hangUp(callId);

// Reject an incoming call
peer.reject(callId);

// Answer an incoming call
peer.answer(callId);                           // uses attached media
peer.answer(callId, { stream: myStream });     // explicit stream

// ── Query Methods (immutable snapshots) ────────────────────────────

// Get all active calls
const calls: readonly CallInfo[] = peer.getActiveCalls();
// CallInfo = { callId, remotePeerId, state: CallState['_tag'], direction }

// Get a specific call's machine (for advanced use)
const callMachine = peer.getCallMachine(callId);
const callState = callMachine.getState(); // CallState (discriminated union)

// Get all open connections
const connections: readonly ConnectionInfo[] = peer.getActiveConnections();
// ConnectionInfo = { connectionId, remotePeerId, state: ConnectionState['_tag'] }

// Get a specific connection's machine
const connMachine = peer.getConnectionMachine(connectionId);
connMachine.send({ msg: 'hello' });

// ── Event Subscription (typed, with constants) ─────────────────────

import { PeerEvents, CallEvents, ConnectionEvents, MediaEvents } from 'peerchat';

peer.on(PeerEvents.READY, ({ peerId }) => { 
  console.log('Connected as:', peerId);
});

peer.on(CallEvents.INCOMING, ({ callId, remotePeerId }) => { 
  console.log('Incoming call from', remotePeerId);
});

peer.on(CallEvents.ACTIVE, ({ callId, remoteStream }) => { 
  videoEl.srcObject = remoteStream;
});

peer.on(ConnectionEvents.DATA, ({ connectionId, data }) => { 
  console.log('Received:', data);
});

media.on(MediaEvents.STREAM_READY, ({ stream }) => { 
  previewEl.srcObject = stream;
});

// ── Lifecycle ──────────────────────────────────────────────────────

peer.destroy();  // cleans up everything
media.destroy();
```

#### Tier 2: Advanced API (Machine Access)

```typescript
// Full machine access for framework integrations
import { PeerManager, MediaMachine } from 'peerchat';

// Direct class instantiation (still supported)
const peer = new PeerManager({ 
  peer: new Peer('my-id'),
  maxRetries: 5,
});

// Access the underlying machine
const machine = peer.machine; // AbstractMachine<PeerState, PeerEmittedEvent>

// Subscribe to state changes (for React useSyncExternalStore)
const sub = machine.subscribe(() => forceUpdate());
sub.unsubscribe();

// On-transition hooks
machine.onTransition((next, prev) => { 
  console.log(`${prev._tag} → ${next._tag}`);
});

// Access child machines with proper types
import { CallMachine, ConnectionMachine } from 'peerchat';

const state = peer.getState();
if (state._tag === 'ready') {
  for (const [id, coordinator] of state.calls) {
    const callMachine: CallMachine = coordinator.callMachine;
    const callState = callMachine.getState();
    if (callState._tag === 'live') {
      callState.remoteStream; // MediaStream
      callState.hangUp();     // typed command
    }
  }
}
```

#### Media Machine API (Improved)

```typescript
import { createMedia, MediaEvents } from 'peerchat';

const media = createMedia({
  autoPermissions: true,
});

// Simple methods
media.requestCamera({ audio: true, video: true });
media.requestScreen({ video: { displaySurface: 'monitor' } });
media.stop();

// When active, get typed state
const state = media.getState();
if (state._tag === 'active') {
  state.stream;             // MediaStream
  state.devices;            // readonly MediaDeviceInfo[]
  state.audioMuted;         // boolean
  state.videoMuted;         // boolean
  state.toggleAudio();      // mute/unmute
  state.toggleVideo();      // on/off
  state.switchDevice('video', deviceId);
}

// Events
media.on(MediaEvents.STREAM_READY, ({ stream, mode }) => { ... });
media.on(MediaEvents.PERMISSION_STATUS, ({ camera, microphone }) => { ... });
media.on(MediaEvents.TRACK_ENDED, ({ kind }) => { ... });
media.on(MediaEvents.DEVICE_SWITCHED, ({ kind, stream }) => { ... });
media.on(MediaEvents.DEVICES_UPDATED, ({ devices }) => { ... });

// Permissions
media.checkPermissions();
```

#### New Event Constants (Exported)

```typescript
export const PeerEvents = {
  READY: 'peer.ready',
  DISCONNECTED: 'peer.disconnected',
  ERROR: 'peer.error',
} as const;

export const CallEvents = {
  INCOMING: 'call.incoming',
  ACTIVE: 'call.active',
  ENDED: 'call.ended',
  ERROR: 'call.error',
  REJECTED: 'call.rejected',
  DECLINED: 'call.declined',
} as const;

export const ConnectionEvents = {
  OPENED: 'connection.opened',
  CLOSED: 'connection.closed',
  ERROR: 'connection.error',
  DATA: 'connection.data',
} as const;

export const MediaEvents = {
  STREAM_READY: 'media.stream.ready',
  STREAM_STOPPED: 'media.stream.stopped',
  STREAM_ERROR: 'media.stream.error',
  PERMISSION_DENIED: 'media.permission.denied',
  PERMISSION_STATUS: 'media.permission.status',
  TRACK_ENDED: 'media.track.ended',
  RECOVERING: 'media.recovering',
  DEVICE_SWITCHED: 'media.device.switched',
  DEVICE_SWITCH_FAILED: 'media.device.switch.failed',
  DEVICES_UPDATED: 'media.devices.updated',
} as const;
```

---

## Part 4: Implementation Plan

### Phase 1: Foundation — Internal Refactoring (No API Changes)

**Goal:** Fix internal issues without changing the public API.

| # | Task | Files | Priority |
|---|------|-------|----------|
| 1.1 | Fix `CallMachineFactory.create` return type | `src/core/machine.ts` | P0 |
| 1.2 | Fix `CallContext` — pass signaling callback via constructor, not context mutation | `src/call/CallMachine.ts`, `src/call/state.ts`, `src/call/CallCoordinator.ts` | P0 |
| 1.3 | DRY up `SignalingService` — single send method, dispatch table for handlers | `src/signaling/SignalingService.ts` | P1 |
| 1.4 | Fix `MediaActiveState.devices` mutation — use mutable field + getter | `src/media/state.ts` | P1 |
| 1.5 | Export event constants from `src/index.ts` | `src/index.ts` | P0 |
| 1.6 | Add `MediaEvents` constant (currently missing) | `src/core/events.ts` | P0 |

**Estimated changes:** ~6 files, backward compatible.

---

### Phase 2: Public API Layer — Convenience Methods

**Goal:** Add the simple API tier without breaking existing usage.

| # | Task | Files | Priority |
|---|------|-------|----------|
| 2.1 | Export `CallMachine` and `ConnectionMachine` classes | `src/index.ts` | P0 |
| 2.2 | Add `PeerManager.connect(remotePeerId)` (duplicate of state method, but on machine) | `src/peer/PeerManager.ts` | P0 |
| 2.3 | Add `PeerManager.send(remotePeerId, data)` convenience method | `src/peer/PeerManager.ts` | P0 |
| 2.4 | Add `PeerManager.call(remotePeerId, options?)` convenience method (accepts stream or media constraints) | `src/peer/PeerManager.ts` | P0 |
| 2.5 | Add `PeerManager.hangUp(callId)`, `peer.answer(callId, options?)`, `peer.reject(callId)` | `src/peer/PeerManager.ts` | P0 |
| 2.6 | Add `PeerManager.getActiveCalls()`: returns `readonly CallInfo[]` (immutable snapshot) | `src/peer/PeerManager.ts` | P1 |
| 2.7 | Add `PeerManager.getActiveConnections()`: returns `readonly ConnectionInfo[]` | `src/peer/PeerManager.ts` | P1 |
| 2.8 | Add `PeerManager.getCallMachine(callId)`: returns `CallMachine \| null` | `src/peer/PeerManager.ts` | P0 |
| 2.9 | Add `PeerManager.getConnectionMachine(connectionId)`: returns `ConnectionMachine \| null` | `src/peer/PeerManager.ts` | P0 |
| 2.10 | Add `PeerManager.attachMedia(media)` integration | `src/peer/PeerManager.ts` | P1 |
| 2.11 | Create `createPeer()` factory function | `src/index.ts`, new `src/factory.ts` | P0 |
| 2.12 | Create `createMedia()` factory function | `src/index.ts`, new `src/factory.ts` | P0 |
| 2.13 | Add `CallInfo` and `ConnectionInfo` types | `src/call/types.ts`, `src/connection/types.ts` | P0 |

**Estimated changes:** ~8 files, backward compatible (additive only).

---

### Phase 3: Immutability for State Snapshots

**Goal:** Enable proper React `useSyncExternalStore` usage.

| # | Task | Files | Priority |
|---|------|-------|----------|
| 3.1 | Create `PeerReadyStateSnapshot` type (plain object, no Maps) | `src/peer/types.ts` | P1 |
| 3.2 | Add `PeerReadyState.toSnapshot()` method that returns immutable copy | `src/peer/state.ts` | P1 |
| 3.3 | Add `machine.getSnapshot()` to `AbstractMachine` | `src/core/machine.ts` | P1 |
| 3.4 | Update React example to use `useSyncExternalStore` with snapshots | `example-react/src/hooks/use-machine.ts` | P1 |

**Estimated changes:** ~4 files, backward compatible.

---

### Phase 4: Developer Experience

**Goal:** Make the library pleasant to use.

| # | Task | Files | Priority |
|---|------|-------|----------|
| 4.1 | Add comprehensive JSDoc on all public types and methods | All public files | P1 |
| 4.2 | Write unit tests — state transitions | `tests/peer/*.test.ts` | P0 |
| 4.3 | Write unit tests — event emission | `tests/core/*.test.ts` | P0 |
| 4.4 | Write unit tests — child machine lifecycle | `tests/call/*.test.ts`, `tests/connection/*.test.ts` | P0 |
| 4.5 | Write unit tests — signaling message routing | `tests/signaling/*.test.ts` | P1 |
| 4.6 | Write unit tests — media permission flows | `tests/media/*.test.ts` | P1 |
| 4.7 | Update React example to use new convenience API | `example-react/src/` | P1 |
| 4.8 | Update README with new API examples | `README.md` | P0 |

**Estimated changes:** ~15+ new test files, example updates, docs.

---

### Phase 5: Cleanup & Version Bump

| # | Task | Priority |
|---|------|----------|
| 5.1 | Run `npm run build` — ensure no compile errors | P0 |
| 5.2 | Run all tests — ensure everything passes | P0 |
| 5.3 | Version bump to `0.2.0` | P0 |
| 5.4 | Add migration guide in `MIGRATION.md` | P1 |
| 5.5 | Update `REFACTORING_PLAN.md` with completion status | P1 |

---

## Part 5: New File Structure (After Implementation)

```
src/
  index.ts                    # All public exports
  factory.ts                  # createPeer(), createMedia() factory functions
  
  core/
    machine.ts                # AbstractMachine (unchanged + getSnapshot)
    events.ts                 # All event constants (PeerEvents, CallEvents, ConnectionEvents, MediaEvents)
    logger.ts                 # (unchanged)
  
  peer/
    PeerManager.ts            # + convenience methods, attachMedia
    state.ts                  # + toSnapshot()
    types.ts                  # + PeerEmittedEvent, PeerReadyStateSnapshot, CallInfo, ConnectionInfo
  
  call/
    CallMachine.ts            # Exported
    CallCoordinator.ts        # Internal (not exported)
    state.ts                  # Classes kept internal, interface exported
    types.ts                  # + CallEmittedEvent, CallInfo
  
  connection/
    ConnectionMachine.ts      # Exported
    state.ts                  # Classes kept internal, interface exported
    types.ts                  # + ConnectionEmittedEvent, ConnectionInfo
  
  signaling/
    SignalingService.ts       # Internal (not exported)
    types.ts                  # Internal
  
  media/
    MediaManager.ts           # Exported
    state.ts                  # Classes kept internal, interface exported
    types.ts                  # MediaEmittedEvent

tests/                        # New directory
  core/
    machine.test.ts
    events.test.ts
  peer/
    PeerManager.test.ts
    state-transitions.test.ts
  call/
    CallMachine.test.ts
    CallCoordinator.test.ts
  connection/
    ConnectionMachine.test.ts
    state-transitions.test.ts
  signaling/
    SignalingService.test.ts
  media/
    MediaMachine.test.ts
    state-transitions.test.ts
  helpers/
    mocks.ts                  # Mock PeerJS, mock MediaDevices
```

---

## Part 6: Key Architectural Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Keep state machine internals | State machines are the right pattern for WebRTC — don't abandon them | Event emitter only (loses type safety), Redux-style reducer (too verbose) |
| Add convenience layer on top of machines | Most users don't want to narrow states to call methods | Replace machines entirely (bad for complex scenarios) |
| Export child machines | Framework integrations need direct access to `CallMachine` and `ConnectionMachine` | Hide completely (limits advanced use cases) |
| Immutable snapshots over live Maps | Enables `useSyncExternalStore`, better React patterns, testability | Use Immer (extra dependency), use structural sharing (complex) |
| Factory functions as primary API | More discoverable than `new` constructor, easier to evolve | Keep `new` only (less flexible), builder pattern (overkill) |
| Keep `new PeerManager()` for compatibility | Non-breaking migration path | Breaking change (alienates existing users) |
| Event constants as exported values | Prevents typos, enables IDE autocomplete | String literals only (error-prone), enum (less flexible) |
| `attachMedia()` is optional | Keeps PeerManager and MediaMachine loosely coupled | Always require media (limits use cases), merge into single class (violates SRP) |

---

## Part 7: What NOT to Change

1. **Don't abandon the state machine pattern** — it's the right choice for WebRTC complexity
2. **Don't remove `AbstractMachine`** — it provides valuable subscription/event infrastructure
3. **Don't hide child machines completely** — advanced users need them
4. **Don't change the parallel data connection strategy** — it's architecturally correct
5. **Don't merge PeerManager and MediaMachine** — separation of concerns is correct
6. **Don't change the PeerJS peer dependency** — consumers should control the version
7. **Don't remove auto-reconnection** — it's a valuable feature

---

## Part 8: Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Breaking changes in convenience methods | Low | Medium | All new methods are additive; existing `new PeerManager()` still works |
| Immutable snapshots hurt performance | Low | Low | Only created on demand (via `getSnapshot()`), internal Maps stay mutable |
| Factory functions limit configurability | Low | Medium | Factory accepts options object; advanced users still use `new PeerManager()` |
| Test coverage gaps | Medium | High | Phase 4 includes comprehensive tests before version bump |
| React example doesn't fully exercise new API | Medium | Low | Update example in Phase 4.7, test manually |

---

## Part 9: Success Criteria

- [ ] All phases implemented and merged
- [ ] `npm run build` passes with zero errors
- [ ] Test coverage ≥ 80% for core modules
- [ ] React example runs without warnings
- [ ] New API used in example (not just old API)
- [ ] README updated with new API examples
- [ ] Migration guide written
- [ ] No breaking changes to existing `new PeerManager()` usage

---

## Appendix A: Current File Sizes

| File | Lines | Concern |
|------|-------|---------|
| `src/peer/state.ts` | ~450 | God object (PeerReadyState) |
| `src/media/state.ts` | ~340 | Acceptable |
| `src/call/state.ts` | ~230 | Acceptable |
| `src/connection/state.ts` | ~155 | Good |
| `src/call/CallCoordinator.ts` | ~120 | Acceptable |
| `src/signaling/SignalingService.ts` | ~85 | Needs DRY |
| `src/media/MediaManager.ts` | ~75 | Good |
| `src/core/machine.ts` | ~95 | Good |
| `src/peer/PeerManager.ts` | ~26 | Too thin (should have convenience methods) |

---

## Appendix B: Event Type Completeness

**Current gaps:**
- `MediaEvents` constant doesn't exist
- `call.rejected` and `call.declined` events exist in code but aren't documented in README
- `media.audio.toggled` and `media.video.toggled` events exist but aren't in any constant

**After fix:**
- All events covered in `MediaEvents` constant
- README updated with complete event table
- Event types on states match constants exactly
