# PeerChat Developer Guide

This guide covers PeerChat's architecture, development workflow, and contribution guidelines. It is intended for contributors and developers who want to understand or modify the library internals.

## Table of Contents

- [Architecture Overview](#architecture-overview)
  - [Design Philosophy](#design-philosophy)
  - [System Architecture](#system-architecture)
  - [State Machine Design](#state-machine-design)
- [Core Concepts](#core-concepts)
  - [AbstractMachine](#abstractmachine)
  - [State Classes](#state-classes)
  - [Event System](#event-system)
  - [Child Machines](#child-machines)
- [Machine Deep Dive](#machine-deep-dive)
  - [PeerManager](#peermanager)
  - [MediaMachine](#mediamachine)
  - [CallMachine](#callmachine)
  - [ConnectionMachine](#connectionmachine)
  - [CallCoordinator](#callcoordinator)
  - [SignalingService](#signalingservice)
- [Development Workflow](#development-workflow)
  - [Project Structure](#project-structure)
  - [Build System](#build-system)
  - [TypeScript Configuration](#typescript-configuration)
- [Testing Guide](#testing-guide)
  - [Test Strategy](#test-strategy)
  - [Writing Tests](#writing-tests)
  - [Mocking PeerJS](#mocking-peerjs)
- [Adding Features](#adding-features)
  - [Adding a New State](#adding-a-new-state)
  - [Adding a New Event](#adding-a-new-event)
  - [Adding a Convenience Method](#adding-a-convenience-method)
- [Debugging](#debugging)
- [Performance Considerations](#performance-considerations)
- [Known Issues & Planned Work](#known-issues--planned-work)
- [Contribution Guidelines](#contribution-guidelines)

---

## Architecture Overview

### Design Philosophy

PeerChat is built on three core principles:

1. **State machines for lifecycle management** — WebRTC has complex async state (connecting, connected, disconnected, error). State machines make every lifecycle phase explicit and type-safe.

2. **Commands on state, not machines** — Methods live on state objects. Narrow the state via `_tag` (discriminated union), then call methods. This prevents invalid operations at compile time (e.g., you can't `hangUp()` when a call is already `ended`).

3. **Composable, independent machines** — Each machine manages one concern (peer connection, media, calls, data channels). Machines spawn child machines as needed.

### System Architecture

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

### State Machine Design

Every machine in PeerChat follows the same pattern:

```
┌──────────────┐   event   ┌──────────────┐   event   ┌──────────────┐
│   State A    │ ─────────▶│   State B    │ ─────────▶│   State C    │
│              │           │              │           │              │
│ - commands   │           │ - commands   │           │ - commands   │
│ - properties │           │ - properties │           │ - properties │
└──────────────┘           └──────────────┘           └──────────────┘
```

**Key characteristics:**

- States are classes with a `_tag` property for discriminated union narrowing
- Transitions are triggered by events via the `ctx.transition()` function
- Commands are methods on state objects (not on machines)
- Each state manages its own constructor/destructor lifecycle

---

## Core Concepts

### AbstractMachine

The `AbstractMachine` base class (in `src/core/machine.ts`) provides the core state machine infrastructure:

```typescript
abstract class AbstractMachine<S extends { destroy(): void }, E extends { type: string } = never>
```

#### Key Methods

| Method | Description |
|--------|-------------|
| `getState()` | Returns the current state |
| `getSnapshot()` | Returns `{ state, version }` for React `useSyncExternalStore` |
| `subscribe(fn)` | Subscribe to state changes |
| `onTransition(fn)` | Subscribe to transitions with `(next, prev)` pairs |
| `on(eventType, fn)` | Subscribe to typed events |
| `destroy()` | Tear down the machine |
| `emit(event)` | Emit an event (protected) |
| `createContext(ctx)` | Create a context object with `transition` function (protected) |
| `bumpVersion()` | Increment snapshot version for mutable state changes (protected) |

#### Context Pattern

States receive a context object with the `transition` function:

```typescript
interface MachineContext<S> {
  transition: (nextState: S) => void;
}
```

Additional context properties are added per machine (e.g., `emit`, `notifyChange`).

### State Classes

State classes are the core unit of behavior. Each state:

1. Has a `_tag` property for discriminated union narrowing
2. Receives a context object with `transition()`
3. Registers event listeners in the constructor
4. Cleans up listeners in `destroy()`
5. Transitions to the next state via `ctx.transition()`

**Example: PeerInitializingState**

```typescript
export class PeerInitializingState implements BasePeerState {
  public readonly _tag = 'initializing';

  constructor(
    public readonly peer: Peer,
    private ctx: PeerContext,
  ) {
    // Register listeners
    this.peer.on('open', this.onOpen);
    this.peer.on('error', this.onError);
  }

  private onOpen = (id: string) => {
    // Clean up current listeners
    this.destroy();

    // Create next state
    const next = new PeerReadyState(this.peer, id, ...);

    // Transition
    this.ctx.transition(next);
    this.ctx.emit({ type: 'peer.ready', peerId: id });
  };

  public destroy() {
    this.peer.off('open', this.onOpen);
    this.peer.off('error', this.onError);
  }
}
```

### Event System

Events are strongly typed and defined in `src/core/events.ts`:

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
  // ... more
} as const;
```

Events are emitted via `this.emit()` and consumed via `machine.on(eventType, handler)`.

### Child Machines

Machines spawn child machines to manage independent lifecycles:

- **PeerManager** spawns **ConnectionMachine** for each data connection
- **PeerManager** spawns **CallCoordinator** (which contains **CallMachine**) for each call
- **CallCoordinator** uses **SignalingService** for internal signaling messages

Child machines are stored in `Map`s keyed by their ID:

```typescript
// In PeerReadyState
public readonly connections: Map<string, ConnectionMachine>;
public readonly calls: Map<string, CallCoordinator>;
```

---

## Machine Deep Dive

### PeerManager

**File:** `src/peer/PeerManager.ts`

The top-level machine managing the PeerJS lifecycle, data connections, and calls.

#### States

| State | `_tag` | Description | Key Properties |
|-------|--------|-------------|----------------|
| `PeerInitializingState` | `initializing` | Waiting for PeerJS `open` event | `peer` |
| `PeerReadyState` | `ready` | Connected and accepting connections | `peer`, `peerId`, `connections`, `calls` |
| `PeerDisconnectedState` | `disconnected` | Lost connection to signaling server | `peer`, `peerId`, auto-reconnect logic |
| `PeerErrorState` | `error` | Fatal error occurred | `lastError` |
| `PeerDestroyedState` | `destroyed` | Machine destroyed | — |

#### Convenience Methods

PeerManager adds convenience methods that narrow state and delegate to state commands:

```typescript
call(remotePeerId: string, options?: CallOptions): boolean
answer(callId: string, options?: AnswerOptions): boolean
reject(callId: string): boolean
hangUp(callId: string): boolean
send(remotePeerId: string, data: unknown): boolean
connect(remotePeerId: string): void
attachMedia(media: MediaMachine): void
detachMedia(): void
getActiveCalls(): readonly CallInfo[]
getActiveConnections(): readonly ConnectionInfo[]
getCallMachine(callId: string): CallMachine | null
getConnectionMachine(connectionId: string): ConnectionMachine | null
```

#### Media Attachment

`attachMedia()` wires a MediaMachine to the PeerManager:

```typescript
attachMedia(media: MediaMachine): void {
  this.attachedMedia = media;

  // Capture current stream if media is active
  const mediaState = media.getState();
  if (mediaState._tag === 'active') {
    this.pendingLocalStream = mediaState.stream;
  }

  // Listen for future stream changes
  media.on('media.stream.ready', ({ stream }) => {
    this.pendingLocalStream = stream;
  });
}
```

### MediaMachine

**File:** `src/media/MediaManager.ts`

Manages local media streams — acquisition, device switching, screen sharing, and permission monitoring.

#### States

| State | `_tag` | Description | Key Commands |
|-------|--------|-------------|--------------|
| `MediaIdleState` | `idle` | No active stream | `request()`, `requestScreen()`, `checkPermissions()` |
| `MediaCheckingPermissionsState` | `checkingPermissions` | Checking browser permissions | — |
| `MediaRequestingState` | `requesting` | Requesting media stream | `stop()` |
| `MediaActiveState` | `active` | Stream active | `switchDevice()`, `stop()`, `toggleAudio()`, `toggleVideo()` |
| `MediaSwitchingState` | `switching` | Switching device | `stop()` |
| `MediaRecoveringState` | `recovering` | Recovering from track loss | `stop()` |
| `MediaDeniedState` | `denied` | Permission denied | `retry()` |

#### Permission Monitor

MediaMachine uses the browser Permissions API to monitor camera/microphone permissions:

```typescript
private startPermissionMonitor(): () => void {
  // Queries camera and microphone permissions
  // Listens for changes via `onchange` callback
  // Emits 'media.permission.status' on change
}
```

### CallMachine

**File:** `src/call/CallMachine.ts`

Manages a single call's lifecycle. Created by CallCoordinator.

#### States

| State | `_tag` | Description | Commands |
|-------|--------|-------------|----------|
| `CallRingingState` | `ringing` | Call incoming/outgoing, waiting for answer | `answer(stream)`, `reject()` |
| `CallConnectingState` | `connecting` | WebRTC negotiation in progress | `hangUp()` |
| `CallLiveState` | `live` | Call is active | `hangUp()` |
| `CallEndedState` | `ended` | Call ended normally | — |
| `CallErrorState` | `error` | Call ended due to error | — |

### ConnectionMachine

**File:** `src/connection/ConnectionMachine.ts`

Manages a single data channel's lifecycle.

#### States

| State | `_tag` | Description | Commands |
|-------|--------|-------------|----------|
| `ConnectionConnectingState` | `connecting` | Connection being established | — |
| `ConnectionOpenState` | `open` | Connection ready for data | `send(data)`, `close()` |
| `ConnectionClosedState` | `closed` | Connection closed | — |
| `ConnectionErrorState` | `error` | Connection error | — |

### CallCoordinator

**File:** `src/call/CallCoordinator.ts`

Coordinates a call with a parallel data channel for signaling. This is the key architectural innovation of PeerChat.

#### Why a Coordinator?

PeerJS separates media connections (`MediaConnection`) from data connections (`DataConnection`). The CallCoordinator:

1. Spawns a `CallMachine` for the media connection
2. Ensures a parallel data channel exists for signaling messages (remote hang-up notification, rejection, etc.)
3. Routes signaling messages between the data channel and the call
4. Cleans up both the call and connection when the call ends

#### Signaling Flow

```
Peer A                         Peer B
  │                              │
  ├──── MediaConnection ─────────┤  (call audio/video)
  │                              │
  ├──── DataConnection ──────────┤  (signaling messages)
  │         │                    │
  │         ├─ remote_close ────▶│
  │         ├─ call_rejected ───▶│
  │         └─ call_declined ───▶│
  │                              │
```

### SignalingService

**File:** `src/signaling/SignalingService.ts`

Internal service for sending signaling messages over data channels. Not exported as public API.

Handles:
- `remote_close` — notify the other side that a call is closing
- `call_rejected` — notify that a call was rejected (timeout)
- `call_declined` — notify that a call was actively declined

---

## Development Workflow

### Project Structure

```
peerchat/
├── src/
│   ├── index.ts              # All public exports
│   ├── factory.ts            # createPeer(), createMedia() factory functions
│   ├── core/                 # AbstractMachine, event constants, logger
│   │   ├── machine.ts        # AbstractMachine base class
│   │   ├── events.ts         # Event constants (PeerEvents, CallEvents, etc.)
│   │   └── logger.ts         # Logging utility
│   ├── peer/                 # PeerManager — top-level machine
│   │   ├── PeerManager.ts    # PeerManager class with convenience methods
│   │   ├── state.ts          # Peer state classes
│   │   └── types.ts          # PeerEmittedEvent, type guards
│   ├── call/                 # CallMachine, CallCoordinator
│   │   ├── CallMachine.ts    # Call machine
│   │   ├── CallCoordinator.ts# Coordinator for call + parallel data channel
│   │   ├── state.ts          # Call state classes
│   │   └── types.ts          # CallEmittedEvent, CallInfo
│   ├── connection/           # ConnectionMachine
│   │   ├── ConnectionMachine.ts
│   │   ├── state.ts
│   │   └── types.ts
│   ├── media/                # MediaMachine
│   │   ├── MediaManager.ts
│   │   ├── state.ts
│   │   └── types.ts
│   └── signaling/            # SignalingService (internal)
│       ├── SignalingService.ts
│       └── types.ts
├── example-react/            # Full working React demo
├── test-call.ts              # Transition table definitions (not compiled)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── ARCHITECTURE_REVIEW.md    # Comprehensive architecture review
```

### Build System

PeerChat uses **tsup** for building. Configuration is in `tsup.config.ts`:

```bash
# Build the library
npm run build

# Build and watch (for development)
npm run build:watch

# Prepublish (auto-builds first)
npm run prepublishOnly
```

Build output goes to `dist/` with:
- `dist/index.mjs` — ESM build
- `dist/index.js` — CJS build
- `dist/index.d.ts` — TypeScript declarations

### TypeScript Configuration

The project uses strict TypeScript settings in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    // ... more strict flags
  }
}
```

**Important rules:**
- All indexed access is checked (`noUncheckedIndexedAccess`)
- Override methods must use `override` keyword (`noImplicitOverride`)
- Strict null checks, strict function types, etc.

---

## Testing Guide

### Test Strategy

PeerChat currently has **zero test coverage**. Adding tests is a top priority. The testing strategy should cover:

#### Unit Tests

| Area | What to Test |
|------|-------------|
| **State transitions** | Happy path and error paths for each machine |
| **Event emission** | Events are emitted with correct payloads |
| **Child machine lifecycle** | Spawn, cleanup, error handling |
| **Signaling message routing** | Messages are correctly routed between peers |
| **Media permission flows** | Idle → requesting → active → denied flows |

#### Integration Tests

| Area | What to Test |
|------|-------------|
| **Peer-to-peer calls** | Two peers connect, call, and hang up |
| **Data channel messaging** | Messages are sent and received correctly |
| **Media attachment** | `attachMedia()` correctly wires streams |
| **Reconnection** | Auto-reconnect after network interruption |

### Writing Tests

Tests should be placed in a `tests/` directory mirroring the `src/` structure:

```
tests/
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
  signaling/
    SignalingService.test.ts
  media/
    MediaMachine.test.ts
  helpers/
    mocks.ts
```

### Mocking PeerJS

Since PeerJS is a peer dependency, tests should mock it:

```typescript
// tests/helpers/mocks.ts

export function createMockPeer(options: Partial<Peer> = {}): Peer {
  const peer = {
    id: options.id ?? 'test-peer-id',
    open: true,
    destroyed: false,
    connect: jest.fn(),
    call: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    destroy: jest.fn(),
    reconnect: jest.fn(),
    ...options,
  } as unknown as Peer;

  return peer;
}

export function createMockDataConnection(options: Partial<DataConnection> = {}): DataConnection {
  const conn = {
    connectionId: 'test-connection-id',
    peer: 'remote-peer-id',
    open: false,
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    ...options,
  } as unknown as DataConnection;

  return conn;
}

export function createMockMediaConnection(options: Partial<MediaConnection> = {}): MediaConnection {
  const call = {
    connectionId: 'test-call-id',
    peer: 'remote-peer-id',
    answerStream: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    ...options,
  } as unknown as MediaConnection;

  return call;
}

export function createMockMediaStream(): MediaStream {
  return {
    getTracks: () => [],
    addTrack: jest.fn(),
    removeTrack: jest.fn(),
    clone: jest.fn(),
  } as unknown as MediaStream;
}
```

### Example: Testing Peer State Transitions

```typescript
// tests/peer/state-transitions.test.ts

import { PeerManager } from '../../src/peer/PeerManager';
import { createMockPeer } from '../helpers/mocks';

describe('PeerManager state transitions', () => {
  it('should transition from initializing to ready on open', () => {
    const mockPeer = createMockPeer({ id: 'test-id', open: false });
    const pm = new PeerManager({ peer: mockPeer });

    // Initial state should be initializing
    expect(pm.getState()._tag).toBe('initializing');

    // Simulate PeerJS 'open' event
    const openHandler = (mockPeer.on as jest.Mock).mock.calls
      .find(([event]) => event === 'open')?.[1];

    openHandler('test-id');

    // Should transition to ready
    expect(pm.getState()._tag).toBe('ready');
    expect(pm.getState().peerId).toBe('test-id');
  });

  it('should transition to error on fatal error', () => {
    const mockPeer = createMockPeer();
    const pm = new PeerManager({ peer: mockPeer });

    // Simulate fatal error
    const errorHandler = (mockPeer.on as jest.Mock).mock.calls
      .find(([event]) => event === 'error')?.[1];

    errorHandler({ type: 'unavailable-id', message: 'Peer ID unavailable' });

    expect(pm.getState()._tag).toBe('error');
  });
});
```

---

## Adding Features

### Adding a New State

1. **Define the state class** in the appropriate `state.ts` file:

```typescript
// Example: Adding a PeerReconnectingState
export class PeerReconnectingState implements BasePeerState {
  public readonly _tag = 'reconnecting';

  constructor(
    public readonly peer: Peer,
    public readonly peerId: string,
    private ctx: PeerContext,
  ) {
    this.peer.on('open', this.onReconnected);
    this.peer.on('error', this.onError);
  }

  private onReconnected = () => {
    this.destroy();
    const next = new PeerReadyState(this.peer, this.peerId, ...);
    this.ctx.transition(next);
    this.ctx.emit({ type: 'peer.ready', peerId: this.peerId });
  };

  public destroy() {
    this.peer.off('open', this.onReconnected);
    this.peer.off('error', this.onError);
  }
}
```

2. **Update the union type:**

```typescript
export type PeerState =
  | PeerInitializingState
  | PeerReadyState
  | PeerReconnectingState  // ← Add here
  | PeerDisconnectedState
  | PeerErrorState
  | PeerDestroyedState;
```

3. **Export from `index.ts`** if the state should be public (most states are kept internal).

4. **Update state transition logic** in the source state that transitions to the new state.

### Adding a New Event

1. **Add the event constant** in `src/core/events.ts`:

```typescript
export const PeerEvents = {
  READY: 'peer.ready',
  // Add your new event:
  RECONNECTING: 'peer.reconnecting',
  // ...
} as const;
```

2. **Add the event to the emitted event type** in the appropriate `types.ts`:

```typescript
// src/peer/types.ts
export type PeerEmittedEvent =
  | { type: 'peer.ready'; peerId: string }
  | { type: 'peer.disconnected' }
  | { type: 'peer.error'; error: PeerError<string> }
  | { type: 'peer.reconnecting'; peerId: string }  // ← Add here
  // ...
```

3. **Emit the event** in the relevant state:

```typescript
this.ctx.emit({ type: 'peer.reconnecting', peerId: this.peerId });
```

### Adding a Convenience Method

Add the method to `PeerManager`:

```typescript
// In PeerManager.ts
someNewMethod(param: string): boolean {
  const state = this.getState();
  if (state._tag !== 'ready') {
    this.log.warn(`someNewMethod() failed — state is "${state._tag}"`);
    return false;
  }

  // Call the state's command
  state.doSomething(param);
  return true;
}
```

Then add the command on the state class:

```typescript
// In PeerReadyState
public doSomething(param: string) {
  // Implementation
}
```

---

## Debugging

### Enable Logging

```typescript
import { setLogging } from 'peerchat';

setLogging(true); // Enable all logging
```

The logger outputs:
- State transitions: `⏭ transition: initializing → ready`
- Events: `📢 emit: peer.ready`
- Method calls: `📞 call("friend-id") called`
- Errors: `❌ PeerJS "error" in ready state`

### WebRTC Internals

- **Chrome:** Navigate to `chrome://webrtc-internals`
- **Firefox:** Navigate to `about:webrtc`

These pages show real-time WebRTC statistics, connection states, and error logs.

### Debugging State Machines

Use `onTransition` to trace state changes:

```typescript
peer.onTransition((next, prev) => {
  console.log(`State: ${prev._tag} → ${next._tag}`);
});
```

### Debugging React Re-renders

If React isn't picking up state changes, check:

1. **Version bumping:** If you're mutating Maps/Sets, call `this.bumpVersion()` after the mutation
2. **Snapshot version:** `getSnapshot()` returns `{ state, version }` — ensure the version changes on state mutations
3. **Reference equality:** Use `useSyncExternalStore` correctly — don't recreate the peer on every render

---

## Performance Considerations

### Mutable Maps vs Immutable Snapshots

PeerManager stores connections and calls in Maps:

```typescript
public readonly connections: Map<string, ConnectionMachine>;
public readonly calls: Map<string, CallCoordinator>;
```

These Maps are mutated in place. React's `useSyncExternalStore` uses `Object.is` comparison, which **doesn't detect** mutations to existing objects.

**Solution:** Call `bumpVersion()` after any Map mutation. This ensures the snapshot version changes, triggering re-renders:

```typescript
this.calls.set(callId, coordinator);
this.ctx.bumpVersion();  // ← Important!
this.ctx.notifyChange();
```

### Event Listener Cleanup

Every state class must clean up its event listeners in `destroy()`:

```typescript
public destroy() {
  this.peer.off('open', this.onOpen);
  this.peer.off('error', this.onError);
  // ...
}
```

Arrow function handlers stored as class properties (`private onOpen = (id: string) => {...}`) ensure the same function reference for `on`/`off`.

### Memory Management

- Call `destroy()` on machines when done — this cleans up all listeners and child machines
- PeerJS connections are automatically closed when the Peer is destroyed
- Media streams should be stopped via `stream.getTracks().forEach(t => t.stop())`

---

## Known Issues & Planned Work

### Current Limitations

| Issue | Status | Details |
|-------|--------|---------|
| Zero test coverage | Planned | See [Testing Guide](#testing-guide) |
| Mutable Maps break React `useSyncExternalStore` | Mitigated | `bumpVersion()` is called after mutations |
| `CallMachineFactory.create` returns `unknown` | Fixed | Now returns `CallMachine` directly |
| State classes exported (not interfaces) | As-is | Consumers should treat states as interfaces |
| `SignalingService` has redundant code | Planned | Three nearly identical send methods |
| `PeerReadyState` is a God object (~450 lines) | Planned | Should extract into separate managers |
| `MediaActiveState.devices` mutation | Planned | Uses type assertion to mutate readonly |

### Planned Improvements (from ARCHITECTURE_REVIEW.md)

See [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) for the complete implementation plan with phases:

- **Phase 1:** Internal refactoring (fix type issues, DRY up signaling)
- **Phase 2:** Public API layer (convenience methods, factory functions)
- **Phase 3:** Immutable snapshots for React
- **Phase 4:** Developer experience (JSDoc, tests, examples)
- **Phase 5:** Version bump and cleanup

---

## Contribution Guidelines

### Before You Start

1. **Read the ARCHITECTURE_REVIEW.md** — it contains a comprehensive review with prioritized issues
2. **Check for open issues** — see if your change is already planned
3. **Understand the state machine pattern** — all changes should follow it

### Making Changes

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/my-change`)
3. **Write tests** — any new functionality should have tests
4. **Update documentation** — update relevant sections in this guide or README
5. **Build and verify** — run `npm run build` and ensure no errors
6. **Test the example app** — run `cd example-react && npm run dev` and verify it works

### Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary (with comment explaining why)
- **Private fields for internal state** — use `private` for implementation details
- **Arrow functions for handlers** — store as class properties for consistent `this` binding
- **JSDoc on public methods** — document behavior, parameters, return values
- **Log key operations** — use `this.log.info()` for user-visible operations, `this.log.debug()` for internals

### Commit Messages

Follow conventional commit format:

```
type(scope): description

feat(peer): add attachMedia method
fix(call): prevent duplicate call to same peer
docs(readme): update quick start example
refactor(media): extract device management into separate class
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

### Pull Request Checklist

- [ ] All tests pass (when tests are added)
- [ ] `npm run build` succeeds
- [ ] Example React app works correctly
- [ ] TypeScript types are correct (no `@ts-ignore`)
- [ ] JSDoc added/updated for public API
- [ ] Documentation updated
- [ ] Changes follow the state machine pattern

### Reporting Issues

When reporting bugs, include:

1. **PeerChat version** (from `package.json`)
2. **PeerJS version** (from your `package.json`)
3. **Browser and version**
4. **Minimal reproduction** — code snippet or example repo
5. **Expected vs actual behavior**
6. **Logs** — enable with `setLogging(true)` if applicable

---

## Resources

- [User Guide](./USER_GUIDE.md) — End-user API reference
- [README](./README.md) — Project overview and quick start
- [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) — Detailed architecture analysis
- [PeerJS Documentation](https://peerjs.com/docs/) — Underlying WebRTC library
- [Example React App](./example-react/) — Working demo
