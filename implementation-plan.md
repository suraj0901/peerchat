# Implementation Plan — peerchat Library Cleanup & Safety

## Context

peerchat is a TypeScript library that provides a high-level, event-driven wrapper around PeerJS for video calls and P2P data channels. The codebase uses a class-based hierarchical state machine pattern (`AbstractMachine<S, E>`) with discriminated union states (`_tag` property). An architecture review identified ~15 issues across four priority levels. This plan addresses Phases 1–3 from the architecture plan: cleanup (dead code, consistency), safety (transition validation, tests, ownership registry), and architecture (error hierarchy, telemetry, PeerJS adapter interfaces).

**Stack:** TypeScript 5.9, tsup (build), Vitest + jsdom (test), PeerJS 1.5 (peer dependency). ES module, Node/bun compatible.

## Conventions

- **Class-based state machines** — states are classes with `ctx.transition(next)`; the unused `Interpreter` (reducer-driven) will be deleted
- **No `any`** — use `unknown` and narrow explicitly; existing `any` in error handlers must be replaced with proper types
- **File names:** kebab-case. **Export names:** PascalCase for types/classes, camelCase for functions
- **Result types** — use the existing `Result<T, E>` from `src/core/types.ts` where return-value error handling is appropriate
- **Event constants** — all event string literals must use constants from `src/core/events.ts`
- **Constructor pattern** — all machine constructors accept a single config object (not positional parameters)
- **Imports** — use relative imports within the library; barrel exports from `src/core/index.ts` for core abstractions
- **Tests** — Vitest with `jsdom` environment; use `vi.fn()` for mocks; `@fast-check/vitest` for property tests where applicable
- **No `throw`** for expected errors — use typed error results or emit error events; only throw for programmer errors (invariant violations)

---

## Phase 1 — Cleanup & Consistency (Quick Wins)

### TASK-01: Delete dead file `test-call.ts`

**File:** `test-call.ts` *(delete)*

**Purpose:**
Remove the dead test file that imports a non-existent `TransitionTable` export and references a table-based transition pattern that does not exist in the codebase.

**Depends on:** none

**Instructions:**

1. Delete the file `test-call.ts` in the project root.

**Done when:**
- `test-call.ts` no longer exists in the project root
- `npm run build` succeeds without errors

---

### TASK-02: Delete `src/core/interpreter.ts` and its test

**File:** `src/core/interpreter.ts` *(delete)*
**File:** `src/core/interpreter.test.ts` *(delete)*

**Purpose:**
Remove the unused `Interpreter` class (~120 lines) and its test file. Zero concrete machines use it; all machines extend `AbstractMachine` and manage state directly. Shipping dead code confuses contributors.

**Depends on:** none

**Instructions:**

1. Delete `src/core/interpreter.ts`.
2. Delete `src/core/interpreter.test.ts`.
3. Verify no other file imports from `./interpreter` — search for `from.*interpreter` across `src/`. If any import exists, remove it.

**Done when:**
- `src/core/interpreter.ts` and `src/core/interpreter.test.ts` do not exist
- No remaining import references `interpreter`
- `npm run build` succeeds
- `npm run test` passes (fewer tests, but no failures)

---

### TASK-03: Complete event constants in `src/core/events.ts` and wire them everywhere

**File:** `src/core/events.ts` *(edit)*
**File:** `src/peer/state.ts` *(edit)*
**File:** `src/call/state.ts` *(edit)*
**File:** `src/connection/state.ts` *(edit)*
**File:** `src/media/state.ts` *(edit)*

**Purpose:**
`src/core/events.ts` defines constants for Peer, Call, and Connection events but they are never imported. Add missing Media events and constants, then replace all hardcoded event string literals with constant references. This eliminates typo risks and creates a single source of truth.

**Depends on:** TASK-02 (clean slate before mass edits)

**Instructions:**

1. **Extend `src/core/events.ts`** — Add the following constants:

```typescript
export const PeerEvents = {
  READY: 'peer.ready',
  DISCONNECTED: 'peer.disconnected',
  ERROR: 'peer.error',
  DESTROYED: 'peer.destroyed',
  CONNECTION_OPENED: 'connection.opened',
  CONNECTION_CLOSED: 'connection.closed',
  CONNECTION_ERROR: 'connection.error',
  CONNECTION_DATA: 'connection.data',
  CALL_INCOMING: 'call.incoming',
  CALL_ACTIVE: 'call.active',
  CALL_ENDED: 'call.ended',
  CALL_ERROR: 'call.error',
  CALL_REJECTED: 'call.rejected',
  CALL_DECLINED: 'call.declined',
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
  ACTIVE: 'media.active',
  INACTIVE: 'media.inactive',
  PERMISSION_STATUS: 'media.permission.status',
  PERMISSION_ERROR: 'media.permission.error',
  DEVICE_CHANGED: 'media.device.changed',
  TRACK_ENDED: 'media.track.ended',
  TRACK_MUTED: 'media.track.muted',
  TRACK_UNMUTED: 'media.track.unmuted',
  STREAM_READY: 'media.stream.ready',
  STREAM_STOPPED: 'media.stream.stopped',
  STREAM_ERROR: 'media.stream.error',
  RECOVERING: 'media.recovering',
  RECOVERED: 'media.recovered',
  AUDIO_TOGGLED: 'media.audio.toggled',
  VIDEO_TOGGLED: 'media.video.toggled',
  DEVICE_SWITCHED: 'media.device.switched',
  DEVICE_SWITCH_FAILED: 'media.device.switch.failed',
  DEVICES_UPDATED: 'media.devices.updated',
  PERMISSION_DENIED: 'media.permission.denied',
} as const;
```

2. **Replace all hardcoded event strings in `src/peer/state.ts`** — Every occurrence of `this.ctx.emit({ type: "peer.ready", ... })` becomes `this.ctx.emit({ type: PeerEvents.READY, ... })`. Do the same for `peer.error`, `peer.disconnected`, `connection.opened`, `connection.closed`, `connection.error`, `connection.data`, `call.incoming`, `call.active`, `call.ended`, `call.error`, `call.rejected`, `call.declined`. Add `import { PeerEvents } from '../core/events'` at the top.

3. **Replace all hardcoded event strings in `src/call/state.ts`** — No direct `emit` calls in call state (events are emitted by the parent), so skip emit replacements. But add `import { CallEvents } from '../core/events'` for future use.

4. **Replace all hardcoded event strings in `src/connection/state.ts`** — Connection state doesn't directly emit, but add `import { ConnectionEvents } from '../core/events'` for future use.

5. **Replace all hardcoded event strings in `src/media/state.ts`** — Every `this.ctx.emit({ type: "media.stream.ready", ... })` becomes `this.ctx.emit({ type: MediaEvents.STREAM_READY, ... })`. Do this for all media event types. Add `import { MediaEvents } from '../core/events'`.

6. **Export all event constants from `src/core/index.ts`** — Verify `export * from './events'` already exists (it does).

**Done when:**
- `src/core/events.ts` contains `PeerEvents`, `CallEvents`, `ConnectionEvents`, and `MediaEvents` constants
- `src/peer/state.ts` has zero hardcoded event string literals — all use `PeerEvents.*` constants
- `src/media/state.ts` has zero hardcoded event string literals — all use `MediaEvents.*` constants
- All four state files import from `../core/events`
- `npm run build` succeeds with no type errors

---

### TASK-04: Standardize all machine constructors to config object pattern

**File:** `src/connection/ConnectionMachine.ts` *(edit)*
**File:** `src/call/CallMachine.ts` *(edit)*
**File:** `src/peer/state.ts` *(edit)* — `PeerInitializingState`, `PeerReadyState`, `PeerDisconnectedState`
**File:** `src/call/state.ts` *(edit)* — all 5 call state classes
**File:** `src/connection/state.ts` *(edit)* — all 4 connection state classes
**File:** `src/media/state.ts` *(edit)* — all 7 media state classes
**File:** `src/peer/PeerManager.ts` *(edit)* — update call site

**Purpose:**
`PeerManager` already uses a config object. `ConnectionMachine` and `CallMachine` use positional parameters. State classes also use a mix of positional params. Standardize to a single config object per constructor for consistency, testability, and extensibility.

**Depends on:** TASK-03

**Instructions:**

1. **`ConnectionMachine`** — Replace the constructor:

```typescript
export interface ConnectionMachineConfig {
  connection: DataConnection;
  connectionId: string;
  remotePeerId: string;
  onData: DataListener;
}

// Constructor becomes:
constructor(config: ConnectionMachineConfig) {
  super();
  this.log.info(`🔧 ConnectionMachine created for "${config.remotePeerId}" (id: ${config.connectionId})`);
  const ctx = this.createContext<ConnectionContext>({
    emitData: config.onData,
  });
  this.currentState = new ConnectionConnectingState(
    config.connection,
    config.connectionId,
    config.remotePeerId,
    ctx,
  );
}
```

2. **`CallMachine`** — Replace the constructor:

```typescript
export interface CallMachineConfig {
  call: MediaConnection;
  callId: string;
  remotePeerId: string;
  direction: CallDirection;
  onCallEnded?: (reason: 'rejected' | 'declined', callId: string) => void;
}

// Constructor becomes:
constructor(config: CallMachineConfig) {
  super();
  this.log.info(`🔧 CallMachine created — ${config.direction} call "${config.callId}" with "${config.remotePeerId}"`);
  const ctx = this.createContext<CallContext>();
  ctx.sendRemoteCallEndedMessage = config.onCallEnded ?? (() => {});
  if (config.direction === 'inbound') {
    this.currentState = new CallRingingState(config.call, config.callId, config.remotePeerId, ctx);
  } else {
    this.currentState = new CallConnectingState(config.call, config.callId, config.remotePeerId, config.direction, ctx);
  }
}
```

3. **`CallCoordinator`** — Update the default factory invocation in `CallCoordinator.setupParallelConnection` (the `defaultFactory` inline) to use the new config object format when calling `factory.create()`. The `CallMachineFactory` interface in `src/core/machine.ts` already accepts `create(config: {...}): unknown`. Update the config shape to match the new `CallMachineConfig`:

```typescript
// In src/core/machine.ts, update CallMachineFactory:
export interface CallMachineFactory {
  create(config: CallMachineConfig): unknown;
}
```

Import `CallMachineConfig` from `../call/CallMachine` in `machine.ts`. If this creates a circular import, define the interface inline in `machine.ts` matching the shape.

4. **`PeerReadyState.spawnConnectionChild`** — Update to use config object:

```typescript
private spawnConnectionChild(connection: DataConnection, connectionId: string, remotePeerId: string): ConnectionMachine {
  const machine = new ConnectionMachine({
    connection,
    connectionId,
    remotePeerId,
    onData: (id, data) => { /* existing logic */ },
  });
  // ... rest unchanged
}
```

5. **State classes** — No need to change internal state class constructors (they are internal implementation details, not public API). The machine constructors are the public-facing entry points. Keep state class constructors as-is with positional parameters — they are created internally by the machine.

6. **Re-export new config types** from appropriate barrel files if they will be needed by consumers.

**Done when:**
- `new ConnectionMachine(conn, id, peerId, onData)` call sites replaced with `new ConnectionMachine({ connection: conn, connectionId: id, remotePeerId: peerId, onData })`
- `new CallMachine(call, id, peerId, dir, onEnded)` call sites replaced with `new CallMachine({ call, callId: id, remotePeerId: peerId, direction: dir, onCallEnded })`
- `CallMachineFactory` interface updated to accept `CallMachineConfig`
- `npm run build` succeeds

---

### TASK-05: Add `destroy()` to `SignalingService` and wire cleanup

**File:** `src/signaling/SignalingService.ts` *(edit)*
**File:** `src/peer/state.ts` *(edit)* — `PeerReadyState.destroy()`

**Purpose:**
`SignalingService` holds a `handlers: Map<string, SignalingHandler>` that is never cleared. Add a `destroy()` method and call it from parent cleanup.

**Depends on:** none (independent)

**Instructions:**

1. **Add `destroy()` to `SignalingService`:**

```typescript
public destroy(): void {
  log.debug(`SignalingService.destroy() — clearing ${this.handlers.size} handler(s)`);
  this.handlers.clear();
}
```

2. **Wire cleanup in `PeerReadyState.destroy()`:** Add `this.signalingService.destroy()` to the existing `destroy()` method, before unregistering PeerJS listeners:

```typescript
public destroy() {
  log.debug("  PeerReadyState.destroy() — unregistering PeerJS listeners");
  this.signalingService.destroy();
  this.peer.off("connection", this.onConnection);
  this.peer.off("call", this.onIncomingCall);
  this.peer.off("disconnected", this.onDisconnected);
  this.peer.off("error", this.onError);
  this.peer.off("close", this.onClose);
}
```

**Done when:**
- `SignalingService` has a `destroy()` method that calls `this.handlers.clear()`
- `PeerReadyState.destroy()` calls `this.signalingService.destroy()`
- No memory leak: after `PeerManager.destroy()` → `PeerReadyState.destroy()` → `SignalingService.destroy()`, the handlers map is empty

---

### TASK-06: Clarify and expand public API in `src/index.ts`

**File:** `src/index.ts` *(edit)*
**File:** `README.md` *(edit)*

**Purpose:**
Currently only `PeerManager`, `MediaMachine`, `setLogging`, and a few types are exported. `CallCoordinator`, `ConnectionMachine`, and `SignalingService` are internal. Document the public API boundary and export the config types consumers need.

**Depends on:** TASK-04 (config types must be finalized)

**Instructions:**

1. **Update `src/index.ts`** — Keep the current exports (they are correct: machines + types only). Add the new config types:

```typescript
// ── Machines ──────────────────────────────────────────────────────────────────
export { PeerManager } from './peer/PeerManager';
export { MediaMachine } from './media/MediaManager';

// ── Logging ───────────────────────────────────────────────────────────────────
export { setLogging } from './core/logger';

// ── Core types ────────────────────────────────────────────────────────────────
export type { PeerId, CallId, ConnectionId, Result, State, Event, Command } from './core/types';

// ── Peer types ────────────────────────────────────────────────────────────────
export type { PeerState } from './peer/state';
export type { PeerEmittedEvent } from './peer/types';

// ── Call types ────────────────────────────────────────────────────────────────
export type { CallState } from './call/state';
export type { CallEmittedEvent } from './call/types';
export type { CallDirection } from './call/state';

// ── Connection types ──────────────────────────────────────────────────────────
export type { ConnectionState } from './connection/state';
export type { ConnectionEmittedEvent } from './connection/types';

// ── Media types ───────────────────────────────────────────────────────────────
export type { MediaState } from './media/state';
export type { MediaEmittedEvent } from './media/types';
export type { MediaMode, PermissionState, MediaPermissions } from './media/state';

// ── Event constants ───────────────────────────────────────────────────────────
export { PeerEvents, CallEvents, ConnectionEvents, MediaEvents } from './core/events';
```

2. **Do NOT export** — `CallCoordinator`, `SignalingService`, `ConnectionMachine`, `CallMachine`, individual state classes, `AbstractMachine`, `createLogger`. These are internal implementation details.

3. **Update `README.md`** — Add a "Public API" section documenting:
   - `PeerManager` — the primary entry point; manages peer lifecycle, connections, and calls
   - `MediaMachine` — standalone machine for local media device management
   - `setLogging(enabled)` — toggle console output
   - Event constants (`PeerEvents`, `CallEvents`, etc.) — for use with `machine.on()`
   - Type exports — all `*State`, `*EmittedEvent`, and utility types
   - Note that `CallCoordinator`, `SignalingService`, and individual machines are internal and may change without notice

**Done when:**
- `src/index.ts` exports event constants and core types in addition to existing exports
- `README.md` has a "Public API" section listing all exports and noting what is internal
- `npm run build` succeeds and `dist/index.d.ts` includes the new exports

---

## Phase 2 — Safety & Testing

### TASK-07: Add state transition validation via adjacency maps

**File:** `src/core/machine.ts` *(edit)*
**File:** `src/peer/state.ts` *(edit)* — add `PEER_TRANSITIONS` map
**File:** `src/call/state.ts` *(edit)* — add `CALL_TRANSITIONS` map
**File:** `src/connection/state.ts` *(edit)* — add `CONNECTION_TRANSITIONS` map
**File:** `src/media/state.ts` *(edit)* — add `MEDIA_TRANSITIONS` map

**Purpose:**
Any state can currently transition to any other state at runtime with no validation. Add adjacency maps per machine and a runtime guard in `AbstractMachine.transition()` that validates allowed transitions. In dev mode (or always), throw/warn on illegal transitions.

**Depends on:** TASK-05 (independent of Phase 1 cleanup)

**Instructions:**

1. **Define adjacency map type** in `src/core/machine.ts`:

```typescript
export type TransitionMap<S extends { _tag: string }> = Record<string, ReadonlySet<string>>;
```

2. **Add transition validation to `AbstractMachine.transition()`** — Modify the `createContext` method's `transition` callback to validate before assigning:

```typescript
transition: (nextState: S) => {
  const prevTag = (this.currentState as any)?._tag ?? 'unknown';
  const nextTag = (nextState as any)?._tag ?? 'unknown';

  // Validate transition if a transition map is provided
  if (this.transitionMap) {
    const allowed = this.transitionMap.get(prevTag);
    if (!allowed || !allowed.has(nextTag)) {
      this.log.error(`⛔ illegal transition: ${prevTag} → ${nextTag}`);
      throw new Error(
        `Invalid state transition: "${prevTag}" → "${nextTag}". ` +
        `Allowed from "${prevTag}": ${allowed ? [...allowed].join(', ') : '(none)'}`
      );
    }
  }

  if (prevState !== nextState) {
    // ... existing transition logic
  }
}
```

3. **Add `transitionMap` as an optional protected property** on `AbstractMachine`:

```typescript
protected transitionMap?: TransitionMap<S> = undefined;
```

4. **Define adjacency maps in each state module:**

```typescript
// src/peer/state.ts
export const PEER_TRANSITIONS: TransitionMap<PeerState> = {
  initializing: new Set(['ready', 'disconnected', 'error', 'destroyed']),
  ready:       new Set(['disconnected', 'error', 'destroyed']),
  disconnected: new Set(['initializing', 'error', 'destroyed']),
  error:       new Set(['destroyed']),
  destroyed:   new Set([]),
} as const;

// src/call/state.ts
export const CALL_TRANSITIONS: TransitionMap<CallState> = {
  ringing:     new Set(['connecting', 'ended', 'error']),
  connecting:  new Set(['live', 'ended', 'error']),
  live:        new Set(['ended', 'error']),
  ended:       new Set([]),
  error:       new Set([]),
} as const;

// src/connection/state.ts
export const CONNECTION_TRANSITIONS: TransitionMap<ConnectionState> = {
  connecting: new Set(['open', 'closed', 'error']),
  open:       new Set(['closed', 'error']),
  closed:     new Set([]),
  error:      new Set([]),
} as const;

// src/media/state.ts
export const MEDIA_TRANSITIONS: TransitionMap<MediaState> = {
  idle:                new Set(['checkingPermissions', 'requesting']),
  checkingPermissions: new Set(['idle', 'denied']),
  requesting:          new Set(['active', 'idle', 'denied']),
  active:              new Set(['switching', 'recovering', 'idle', 'denied']),
  switching:           new Set(['active', 'idle']),
  recovering:          new Set(['active', 'idle', 'denied']),
  denied:              new Set(['idle']),
} as const;
```

5. **Wire maps into machines** — Set `this.transitionMap` before creating context:

```typescript
// In PeerManager constructor, before createContext:
this.transitionMap = PEER_TRANSITIONS;

// In ConnectionMachine constructor, before createContext:
this.transitionMap = CONNECTION_TRANSITIONS;

// In CallMachine constructor, before createContext:
this.transitionMap = CALL_TRANSITIONS;

// In MediaMachine constructor, before createContext:
this.transitionMap = MEDIA_TRANSITIONS;
```

6. **Fix the illegal transition in `PeerInitializingState.onOpen`** — The current code transitions `initializing → ready`, which is allowed. But `PeerInitializingState.onDisconnected` transitions `initializing → disconnected`. Check all existing transitions against the maps above and ensure they are all valid. If any are not, either fix the transition or adjust the adjacency map.

**Done when:**
- `AbstractMachine` has an optional `transitionMap` property and validates transitions in `createContext().transition()`
- All four machines (`PeerManager`, `ConnectionMachine`, `CallMachine`, `MediaMachine`) set their `transitionMap`
- Attempting an illegal transition throws an `Error` with a descriptive message
- `npm run build` succeeds
- `npm run test` passes

---

### TASK-08: Add parent-child ownership registry to `AbstractMachine`

**File:** `src/core/machine.ts` *(edit)*
**File:** `src/peer/state.ts` *(edit)* — use `addChildMachine` / auto-destroy
**File:** `src/call/CallCoordinator.ts` *(edit)* — use `addChildMachine`
**File:** `src/connection/ConnectionMachine.ts` *(edit)* — no changes needed (leaf machine)

**Purpose:**
`PeerReadyState` manually tracks `connections: Map` and `calls: Map` and has bespoke `cleanupChildren()` logic. Centralize child tracking in `AbstractMachine` so `destroy()` automatically destroys all registered children.

**Depends on:** TASK-07

**Instructions:**

1. **Add child registry to `AbstractMachine`:**

```typescript
private childMachines = new Set<AbstractMachine<any, any>>();

protected addChildMachine(child: AbstractMachine<any, any>): void {
  this.childMachines.add(child);
}

protected removeChildMachine(child: AbstractMachine<any, any>): void {
  this.childMachines.delete(child);
}
```

2. **Override `destroy()` in `AbstractMachine`** to auto-destroy children before clearing listeners:

```typescript
public destroy() {
  this.log.info('💀 destroy()');
  // Auto-destroy all children
  for (const child of this.childMachines) {
    try {
      child.destroy();
    } catch {
      /* ignore child errors during parent destruction */
    }
  }
  this.childMachines.clear();

  if (this.currentState) {
    this.currentState.destroy();
  }
  this.transitionListeners.clear();
  this.stateSubscribers.clear();
  this.eventListeners.clear();
}
```

3. **Wire `PeerReadyState` to use the registry** — After creating a `ConnectionMachine` or `CallCoordinator`, call `this.addChildMachine(child)`. Note: `PeerReadyState` is a state class, not the machine itself. The machine is `PeerManager`. The state classes hold references to children. This is a design constraint: the registry lives on the machine, but children are spawned by states.

   **Solution:** Pass the parent machine's `addChildMachine` through the context:

```typescript
// In PeerContext, add:
export interface PeerContext extends MachineContext<PeerState> {
  emit: (event: PeerEmittedEvent) => void;
  notifyChange: () => void;
  addChild: (child: AbstractMachine<any, any>) => void;
  removeChild: (child: AbstractMachine<any, any>) => void;
}
```

4. **In `PeerManager` constructor**, add to context:

```typescript
const ctx = this.createContext<PeerContext>({
  emit: (event) => this.emit(event),
  notifyChange: () => this.notifySubscribers(),
  addChild: (child) => { this.addChildMachine(child); },
  removeChild: (child) => { this.removeChildMachine(child); },
});
```

5. **In `PeerReadyState.spawnConnectionChild`**, after creating the machine:

```typescript
this.ctx.addChild(machine);
```

6. **In `PeerReadyState.spawnCallCoordinator`**, after creating the coordinator:

```typescript
const coordinator = new CallCoordinator(config);
this.ctx.addChild(coordinator);
```

7. **In `PeerReadyState.removeConnection` and `removeCall`**, call `this.ctx.removeChild(child)` before destroying.

8. **Simplify `PeerReadyState.cleanupChildren`** — Replace the manual iteration with a call to the parent machine's `destroy()`, which now auto-destroys children. Or keep the explicit cleanup but remove the manual `conn.destroy()` / `call.destroy()` calls since `PeerManager.destroy()` will handle them via the registry.

   Actually, `PeerReadyState` is the state, not the machine. `PeerManager` is the machine. When `PeerManager.destroy()` is called, it destroys the current state AND all registered children. The `cleanupChildren()` calls happen when transitioning away from `PeerReadyState` (e.g., on error or close). In those cases, we still need explicit child cleanup because the machine itself isn't being destroyed yet.

   Keep `cleanupChildren()` but simplify it to use the context:

```typescript
private cleanupChildren() {
  this.log.debug(`  cleaning up children via parent registry`);
  // Children registered via addChildMachine will be auto-destroyed
  // when PeerManager.destroy() is called. For pre-destroy cleanup,
  // we iterate our local maps and destroy individually.
  // This is unchanged — the registry is for final cleanup, not mid-life cleanup.
}
```

   The registry handles the case where `PeerManager.destroy()` is called and the state forgets to clean up. The local maps handle mid-life cleanup (transitions between states). Both are needed.

9. **For `CallCoordinator`** — it owns a `CallMachine`. Add the same pattern: pass `addChildMachine` through the config, register the `CallMachine` as a child.

**Done when:**
- `AbstractMachine` has `addChildMachine()`, `removeChildMachine()`, and auto-destroys children in `destroy()`
- `PeerManager` registers all `ConnectionMachine` and `CallCoordinator` instances via the context
- `CallCoordinator` registers its `CallMachine` as a child
- Calling `PeerManager.destroy()` destroys all descendants even if the current state doesn't call `cleanupChildren()`
- `npm run build` succeeds

---

### TASK-09: Unit tests for `SignalingService`

**File:** `src/signaling/SignalingService.test.ts` *(create)*

**Purpose:**
Test the signaling message routing, handler registration, and new `destroy()` method.

**Depends on:** TASK-05

**Instructions:**

1. Create `src/signaling/SignalingService.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SignalingService } from './SignalingService';
import type { SignalingServiceConfig, SignalingMessage } from './types';
```

2. **Test: `destroy()` clears handlers** — Create a `SignalingService` with a mock config, register a handler, call `destroy()`, verify `handlers` map is empty (or test indirectly by verifying no callback is invoked).

3. **Test: `registerHandler` / `unregisterHandler`** — Register a handler for a callId, verify `handleMessage` routes to it. Unregister, verify no callback.

4. **Test: `sendRemoteClose`** — Mock `getConnection` to return `{ connectionId: 'c1', send: vi.fn() }`. Call `sendRemoteClose('call-1', 'peer-2')`. Verify `send` was called with `{ type: 'remote_close', callId: 'call-1' }`.

5. **Test: `sendCallRejected`** — Same pattern, verify `{ type: 'call_rejected', callId }`.

6. **Test: `sendCallDeclined`** — Same pattern, verify `{ type: 'call_declined', callId }`.

7. **Test: `send*` with no connection** — Mock `getConnection` to return `null`. Verify no error is thrown and no send occurs.

8. **Test: `handleMessage` with unknown callId** — Register no handler, send a `remote_close` message. Verify no error (just a warning logged).

**Done when:**
- `src/signaling/SignalingService.test.ts` exists with ≥8 test cases
- All tests pass
- `destroy()` test verifies handlers are cleared

---

### TASK-10: Unit tests for `ConnectionMachine` state transitions

**File:** `src/connection/ConnectionMachine.test.ts` *(create)*
**File:** `src/connection/state.test.ts` *(create)*

**Purpose:**
Test all 4 connection states and their transitions: `connecting → open`, `connecting → closed`, `connecting → error`, `open → closed`, `open → error`.

**Depends on:** TASK-04, TASK-07

**Instructions:**

1. **Create mock `DataConnection` factory:**

```typescript
function createMockDataConnection(overrides: Partial<DataConnection> = {}): DataConnection {
  return {
    connectionId: 'conn-1',
    peer: 'remote-peer',
    open: false,
    type: 'data',
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as DataConnection;
}
```

2. **Test: `connecting → open`** — Create `ConnectionMachine` with mock. Simulate `connection.on('open')` callback. Verify state `_tag === 'open'`.

3. **Test: `connecting → closed`** — Simulate `connection.on('close')` while connecting. Verify `_tag === 'closed'`.

4. **Test: `connecting → error`** — Simulate `connection.on('error')`. Verify `_tag === 'error'`.

5. **Test: `connecting → error` (timeout)** — Use `vi.useFakeTimers()`. Advance past `CONNECTION_TIMEOUT_MS` (15000). Verify `_tag === 'error'`.

6. **Test: `open → closed`** — Transition to open first, then simulate `close`. Verify `_tag === 'closed'`.

7. **Test: `open → error`** — Transition to open, simulate `error`. Verify `_tag === 'error'`.

8. **Test: `send()` in open state** — Transition to open, call `state.send({ test: true })`. Verify `connection.send` was called.

9. **Test: `close()` in open state** — Transition to open, call `state.close()`. Verify `_tag === 'closed'` and `connection.close` was called.

10. **Test: `onData` callback** — Transition to open, simulate `connection.on('data')` with payload. Verify the `onData` callback receives the data.

11. **Test: `destroy()` cleans up listeners** — Create machine, call `destroy()`. Verify `connection.off` was called for all registered events.

12. **Test: config object constructor** — Verify `new ConnectionMachine({ connection, connectionId, remotePeerId, onData })` works correctly.

**Done when:**
- All 12 test cases pass
- `npm run test` shows `ConnectionMachine` tests passing
- Coverage for `src/connection/` exceeds 80%

---

### TASK-11: Unit tests for `CallMachine` state transitions

**File:** `src/call/CallMachine.test.ts` *(create)*
**File:** `src/call/state.test.ts` *(create)*

**Purpose:**
Test all 5 call states and transitions for both inbound and outbound calls.

**Depends on:** TASK-04, TASK-07

**Instructions:**

1. **Create mock `MediaConnection` factory:**

```typescript
function createMockMediaConnection(overrides: Partial<MediaConnection> = {}): MediaConnection {
  return {
    connectionId: 'call-1',
    peer: 'remote-peer',
    on: vi.fn(),
    off: vi.fn(),
    answer: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as MediaConnection;
}
```

2. **Test: inbound `ringing → connecting`** — Create `CallMachine` with `direction: 'inbound'`. Simulate `state.answer(stream)`. Verify `_tag === 'connecting'` and `call.answer` was called.

3. **Test: inbound `ringing → ended`** — Call `state.reject()`. Verify `_tag === 'ended'`.

4. **Test: inbound `ringing → ended` (close)** — Simulate `call.on('close')` while ringing. Verify `_tag === 'ended'`.

5. **Test: inbound `ringing → error`** — Simulate `call.on('error')`. Verify `_tag === 'error'`.

6. **Test: inbound `ringing → error` (timeout)** — Use fake timers, advance past `RINGING_TIMEOUT_MS` (30000). Verify `_tag === 'error'`.

7. **Test: outbound `connecting → live`** — Create with `direction: 'outbound'`. Simulate `call.on('stream', remoteStream)`. Verify `_tag === 'live'` and `state.remoteStream === remoteStream`.

8. **Test: outbound `connecting → ended`** — Call `state.hangUp()`. Verify `_tag === 'ended'`.

9. **Test: outbound `connecting → ended` (close)** — Simulate `call.on('close')`. Verify `_tag === 'ended'`.

10. **Test: outbound `connecting → error` (timeout)** — Advance past `CONNECTING_TIMEOUT_MS` (30000). Verify `_tag === 'error'`.

11. **Test: `live → ended`** — From live state, call `state.hangUp()`. Verify `_tag === 'ended'`.

12. **Test: `live → error`** — From live state, simulate `call.on('error')`. Verify `_tag === 'error'`.

13. **Test: `live → ended` (close)** — From live state, simulate `call.on('close')`. Verify `_tag === 'ended'`.

14. **Test: `sendRemoteCallEndedMessage` on reject** — Verify the callback is invoked with `'rejected'`.

15. **Test: `sendRemoteCallEndedMessage` on outbound hangUp while connecting** — Verify callback is invoked with `'declined'`.

16. **Test: config object constructor** — Verify `new CallMachine({ call, callId, remotePeerId, direction })` works.

**Done when:**
- All 16 test cases pass
- Coverage for `src/call/` exceeds 80%

---

### TASK-12: Unit tests for `PeerManager` state transitions

**File:** `src/peer/PeerManager.test.ts` *(create)*
**File:** `src/peer/state.test.ts` *(create)*

**Purpose:**
Test the 5 PeerManager states. Mock PeerJS `Peer` object.

**Depends on:** TASK-07, TASK-08, TASK-10, TASK-11

**Instructions:**

1. **Create mock `Peer` factory:**

```typescript
function createMockPeer(overrides: Partial<Peer> = {}): Peer {
  const peer = {
    id: 'test-peer-1',
    open: false,
    destroyed: false,
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    connect: vi.fn(),
    call: vi.fn(),
    reconnect: vi.fn(),
    ...overrides,
  } as unknown as Peer;
  return peer;
}
```

2. **Test: `initializing → ready`** — Create `PeerManager`. Simulate `peer.on('open', id)`. Verify state `_tag === 'ready'` and `peer.ready` event emitted with `peerId`.

3. **Test: `initializing → error`** — Simulate `peer.on('error', fatalPeerError)`. Use a fatal error type (`'browser-incompatible'`). Verify `_tag === 'error'`.

4. **Test: `initializing → disconnected`** — Simulate `peer.on('disconnected')`. Verify `_tag === 'disconnected'`.

5. **Test: `initializing → destroyed`** — Simulate `peer.on('close')`. Verify `_tag === 'destroyed'` and `peer.destroy()` was called.

6. **Test: `ready → disconnected`** — From ready state, simulate `peer.on('disconnected')`. Verify `_tag === 'disconnected'`.

7. **Test: `ready → error`** — From ready state, simulate fatal error. Verify `_tag === 'error'`.

8. **Test: `ready → destroyed`** — From ready state, simulate `peer.on('close')`. Verify `_tag === 'destroyed'`.

9. **Test: `disconnected → initializing` (auto-reconnect)** — From disconnected, use fake timers, advance past reconnect delay. Verify `peer.reconnect()` was called and state is `initializing`.

10. **Test: `disconnected → error`** — Simulate fatal error while disconnected. Verify `_tag === 'error'`.

11. **Test: `disconnected → destroyed`** — Simulate `peer.on('close')` while disconnected. Verify `_tag === 'destroyed'`.

12. **Test: `connect()` creates child machine** — From ready state, call `state.connect('remote-peer')`. Verify a `ConnectionMachine` was added to the connections map.

13. **Test: `connect()` prevents duplicates** — Call `connect()` twice for same peer. Verify only one `ConnectionMachine` exists.

14. **Test: `call()` creates child CallCoordinator** — From ready state, call `state.call('remote-peer', mockStream)`. Verify a `CallCoordinator` was added.

15. **Test: `call()` prevents duplicates** — Call `call()` twice for same peer. Verify only one `CallCoordinator` exists.

16. **Test: `destroy()` cleans up** — Create `PeerManager`, transition to ready, call `peerManager.destroy()`. Verify all listeners are cleared and state is destroyed.

17. **Test: illegal transition throws** — From `destroyed` state, attempt any transition. Verify an error is thrown (from TASK-07 validation).

**Done when:**
- All 17 test cases pass
- Coverage for `src/peer/` exceeds 80%

---

### TASK-13: Unit tests for `MediaMachine` state transitions

**File:** `src/media/MediaMachine.test.ts` *(create)*
**File:** `src/media/state.test.ts` *(create)*

**Purpose:**
Test all 7 media states. Mock `navigator.mediaDevices` and `navigator.permissions`.

**Depends on:** TASK-07

**Instructions:**

1. **Mock browser APIs** — In the test file or a `src/__mocks__/navigator.ts` setup file:

```typescript
beforeEach(() => {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(),
      getDisplayMedia: vi.fn(),
      enumerateDevices: vi.fn().mockResolvedValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    permissions: {
      query: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

2. **Test: `idle → requesting → active`** — Create `MediaMachine`. Call `state.request(constraints)`. Mock `getUserMedia` to resolve with a `MediaStream`. Verify `_tag === 'active'`.

3. **Test: `idle → requesting → denied`** — Mock `getUserMedia` to reject with `DOMException` (`name: 'NotAllowedError'`). Verify `_tag === 'denied'`.

4. **Test: `idle → checkingPermissions → idle`** — Call `state.checkPermissions()`. Mock `permissions.query` to resolve. Verify `_tag === 'idle'` with updated permissions.

5. **Test: `active → switching → active`** — From active state, call `state.switchDevice('video', 'device-1')`. Mock `getUserMedia` to resolve. Verify `_tag === 'active'` with new device.

6. **Test: `active → recovering → active`** — Simulate a track ending (from active state). Mock `getUserMedia` to resolve. Verify `_tag === 'active'` with new stream.

7. **Test: `active → recovering → denied`** — Simulate track ending. Mock `getUserMedia` to reject with `NotAllowedError`. Verify `_tag === 'denied'`.

8. **Test: `active → idle` (stop)** — Call `state.stop()`. Verify `_tag === 'idle'` and all tracks were stopped.

9. **Test: `requesting → idle` (stop while requesting)** — Call `state.stop()` while in requesting state. Verify `_tag === 'idle'`.

10. **Test: `denied → idle` (retry)** — From denied state, call `state.retry()`. Verify `_tag === 'idle'`.

11. **Test: `toggleAudio` / `toggleVideo`** — From active state, call `toggleAudio()`. Verify `track.enabled` is flipped and event is emitted.

12. **Test: `destroy()` cleans up** — Call `machine.destroy()`. Verify permission monitor is cleaned up and all track listeners are removed.

**Done when:**
- All 12 test cases pass
- Coverage for `src/media/` exceeds 80%

---

### TASK-14: Property-based tests for state transition invariants

**File:** `src/core/transitions.property.test.ts` *(create)*

**Purpose:**
Use `@fast-check/vitest` (already installed, unused) to verify that illegal transitions always throw, and legal transitions never throw.

**Depends on:** TASK-07

**Instructions:**

1. Create `src/core/transitions.property.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fc from 'fast-check/vitest';
```

2. **Property: Legal transitions never throw** — Generate valid (currentState, nextState) pairs from the adjacency maps. For each pair, verify no error is thrown.

```typescript
it.prop({ pair: fc.constantFrom(...allLegalTransitionPairs) })('legal transition does not throw', ({ pair }) => {
  // Create a minimal machine, transition, verify no throw
});
```

3. **Property: Illegal transitions always throw** — Generate (currentState, nextState) pairs NOT in the adjacency maps. For each, verify an error IS thrown.

4. **Property: Terminal states have no outgoing transitions** — For all machines, verify that from terminal states (`destroyed`, `ended`, `error`, `closed`), no transition is legal.

**Done when:**
- Property tests exist and pass
- `@fast-check/vitest` is now in use

---

### TASK-15: Integration test for `CallCoordinator` end-to-end

**File:** `src/call/CallCoordinator.test.ts` *(create)*

**Purpose:**
Test the coordinator's role in managing parallel signaling connections and call lifecycle.

**Depends on:** TASK-09, TASK-10, TASK-11

**Instructions:**

1. **Create test with mocked dependencies** — Mock `SignalingService`, `ConnectionMachine`, and use the real `CallCoordinator` with a `CallMachine` using mock `MediaConnection`.

2. **Test: outbound call lifecycle** — Create coordinator with `direction: 'outbound'`. Simulate `CallMachine` transitions: `connecting → live → ended`. Verify `onActive` and `onEnded` callbacks are called.

3. **Test: inbound call lifecycle** — Create with `direction: 'inbound'`. Simulate `ringing → connecting → live → ended`. Verify callbacks.

4. **Test: signaling message handling** — Simulate `SignalingService` receiving `call_rejected`. Verify `onEnded` is called with `{ type: 'call.rejected' }`.

5. **Test: `destroy()` cleans up** — Call `coordinator.destroy()`. Verify `signalingService.unregisterHandler` was called and `callMachine.destroy()` was called.

6. **Test: parallel connection reuse** — Mock `getConnection` to return an existing connection. Verify no new connection is opened.

7. **Test: parallel connection creation** — Mock `getConnection` to return `null`. Verify `openConnection` was called.

**Done when:**
- All 7 test cases pass
- `CallCoordinator` is verified to correctly orchestrate call + signaling

---

### TASK-16: Test `PeerReadyState` incoming connection and call handling

**File:** `src/peer/state.test.ts` *(append to TASK-12 tests)*

**Purpose:**
Test the `PeerReadyState` handlers for incoming connections and incoming calls.

**Depends on:** TASK-12, TASK-15

**Instructions:**

1. **Test: incoming connection spawns child** — Create `PeerReadyState`. Simulate `peer.on('connection', mockDataConnection)`. Verify a `ConnectionMachine` is created and added to the connections map.

2. **Test: incoming call spawns coordinator** — Create `PeerReadyState`. Simulate `peer.on('call', mockMediaConnection)`. Verify a `CallCoordinator` is created and `call.incoming` event is emitted.

3. **Test: `onConnection` transition handler** — Verify when a child `ConnectionMachine` transitions to `open`, the `connection.opened` event is emitted.

4. **Test: `onConnection` closed handler** — Verify when a child transitions to `closed`, it is removed from the map and `connection.closed` event is emitted.

5. **Test: `onConnection` error handler** — Verify when a child transitions to `error`, it is removed and `connection.error` event is emitted.

**Done when:**
- All 5 test cases pass
- `PeerReadyState` child management is fully tested

---

## Phase 3 — Architecture

### TASK-17: Create structured error hierarchy

**File:** `src/core/errors.ts` *(create)*
**File:** `src/core/index.ts` *(edit)* — export new error types
**File:** `src/index.ts` *(edit)* — export error types

**Purpose:**
Replace ad-hoc error strings with a typed hierarchy: `PeerChatError` base class with `code`, `message`, `retryable`, and `severity` properties.

**Depends on:** TASK-07

**Instructions:**

1. **Create `src/core/errors.ts`:**

```typescript
export type ErrorCode =
  | 'PEER_INITIALIZATION_FAILED'
  | 'PEER_CONNECTION_LOST'
  | 'PEER_FATAL_ERROR'
  | 'CALL_TIMEOUT'
  | 'CALL_REJECTED'
  | 'CALL_DECLINED'
  | 'CALL_ERROR'
  | 'DATA_CONNECTION_TIMEOUT'
  | 'DATA_CONNECTION_ERROR'
  | 'MEDIA_PERMISSION_DENIED'
  | 'MEDIA_ACQUISITION_FAILED'
  | 'MEDIA_RECOVERY_FAILED'
  | 'INVALID_TRANSITION';

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export class PeerChatError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly severity: ErrorSeverity = 'error',
    public readonly retryable: boolean = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PeerChatError';
  }

  isRetryable(): boolean {
    return this.retryable;
  }
}
```

2. **Create domain-specific error constructors** (factory functions, not subclasses — keeps it simple):

```typescript
export function createPeerInitializationError(message: string, cause?: unknown): PeerChatError {
  return new PeerChatError(message, 'PEER_INITIALIZATION_FAILED', 'critical', false, cause);
}

export function createCallTimeoutError(callId: string, cause?: unknown): PeerChatError {
  return new PeerChatError(`Call ${callId} timed out`, 'CALL_TIMEOUT', 'error', true, cause);
}

export function createMediaPermissionDeniedError(cause?: unknown): PeerChatError {
  return new PeerChatError('Media permission denied', 'MEDIA_PERMISSION_DENIED', 'warning', false, cause);
}

export function createInvalidTransitionError(from: string, to: string): PeerChatError {
  return new PeerChatError(
    `Invalid state transition: "${from}" → "${to}"`,
    'INVALID_TRANSITION',
    'error',
    false,
  );
}
```

3. **Replace inline error creation in state files** — In call state timeout handlers, replace `new Error('Call ringing timed out')` with `createCallTimeoutError(this.callId)`. In media permission denial, replace with `createMediaPermissionDeniedError()`. In transition validation (TASK-07), replace `new Error('Invalid state transition...')` with `createInvalidTransitionError(prevTag, nextTag)`.

4. **Export from `src/core/index.ts`**: `export * from './errors';`

5. **Re-export from `src/index.ts`**: `export { PeerChatError, createPeerInitializationError, createCallTimeoutError, createMediaPermissionDeniedError, createInvalidTransitionError } from './core/errors';`
   Also export types: `export type { ErrorCode, ErrorSeverity } from './core/errors';`

**Done when:**
- `src/core/errors.ts` defines `PeerChatError`, `ErrorCode`, `ErrorSeverity`, and factory functions
- Call timeout errors use `createCallTimeoutError`
- Media permission errors use `createMediaPermissionDeniedError`
- Invalid transition errors use `createInvalidTransitionError`
- `npm run build` succeeds
- All tests pass (errors still thrown/caught correctly)

---

### TASK-18: Add telemetry hooks

**File:** `src/core/telemetry.ts` *(create)*
**File:** `src/core/index.ts` *(edit)* — export telemetry types
**File:** `src/core/machine.ts` *(edit)* — integrate telemetry into `createContext`
**File:** `src/index.ts` *(edit)* — export telemetry types

**Purpose:**
Define a `Telemetry` interface consumers can implement to capture state transitions, errors, and latencies. Default implementation is a no-op.

**Depends on:** TASK-17

**Instructions:**

1. **Create `src/core/telemetry.ts`:**

```typescript
export interface TelemetryEvent {
  readonly machineType: string;
  readonly machineId?: string;
  readonly timestamp: number;
}

export interface TelemetryTransitionEvent extends TelemetryEvent {
  readonly kind: 'transition';
  readonly from: string;
  readonly to: string;
  readonly durationMs?: number;
}

export interface TelemetryEmitEvent extends TelemetryEvent {
  readonly kind: 'emit';
  readonly eventType: string;
}

export interface TelemetryErrorEvent extends TelemetryEvent {
  readonly kind: 'error';
  readonly error: unknown;
  readonly context?: Record<string, unknown>;
}

export type TelemetryRecord = TelemetryTransitionEvent | TelemetryEmitEvent | TelemetryErrorEvent;

export interface Telemetry {
  record(event: TelemetryRecord): void;
}

export const NoOpTelemetry: Telemetry = {
  record: () => {},
};
```

2. **Integrate into `AbstractMachine`** — Add an optional `telemetry` parameter to machines. The simplest approach: add it to `MachineContext`:

```typescript
export interface MachineContext<S> {
  transition: (nextState: S) => void;
  telemetry?: Telemetry;
}
```

3. **Emit telemetry in `createContext().transition()`** — After the transition completes, call `this.telemetry?.record({ kind: 'transition', from: prevTag, to: nextTag, machineType: /* derived from constructor name */, timestamp: Date.now() })`.

4. **Emit telemetry in `AbstractMachine.emit()`** (protected) — Call `this.telemetry?.record({ kind: 'emit', eventType: event.type, ... })`.

5. **For existing machines** — No changes needed to machine constructors. Telemetry is optional and defaults to no-op. Consumers who want telemetry pass a `Telemetry` implementation via an extended context.

6. **Export from `src/core/index.ts`** and `src/index.ts`**.

**Done when:**
- `src/core/telemetry.ts` defines `Telemetry`, `TelemetryRecord`, and `NoOpTelemetry`
- `AbstractMachine` optionally accepts telemetry and records transitions/emits
- Default behavior is no-op (zero overhead for non-telemetry users)
- `npm run build` succeeds

---

### TASK-19: Define PeerJS adapter interfaces (Ports & Adapters)

**File:** `src/adapters/ports.ts` *(create)*
**File:** `src/adapters/peerjs-adapter.ts` *(create)*
**File:** `src/adapters/index.ts` *(create)*
**File:** `src/core/index.ts` *(edit)* — do NOT export adapters (they are internal)

**Purpose:**
Define abstract interfaces for PeerJS types (`Peer`, `MediaConnection`, `DataConnection`) so machines depend on ports, not PeerJS directly. Provide concrete PeerJS adapter implementations. This enables mocking in tests and swapping signaling backends.

**Depends on:** TASK-17 (independent)

**Instructions:**

1. **Create `src/adapters/ports.ts`** — Define the port interfaces:

```typescript
import type { PeerError } from 'peerjs';

export interface IPeerPort {
  readonly id: string | null;
  readonly open: boolean;
  readonly destroyed: boolean;
  on(event: 'open', handler: (id: string) => void): void;
  on(event: 'error', handler: (error: PeerError<string>) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'disconnected', handler: () => void): void;
  on(event: 'connection', handler: (connection: IDataConnectionPort) => void): void;
  on(event: 'call', handler: (call: IMediaConnectionPort) => void): void;
  off(event: 'open', handler: (id: string) => void): void;
  off(event: 'error', handler: (error: PeerError<string>) => void): void;
  off(event: 'close', handler: () => void): void;
  off(event: 'disconnected', handler: () => void): void;
  off(event: 'connection', handler: (connection: IDataConnectionPort) => void): void;
  off(event: 'call', handler: (call: IMediaConnectionPort) => void): void;
  connect(remotePeerId: string, options?: any): IDataConnectionPort;
  call(remotePeerId: string, stream: MediaStream, options?: any): IMediaConnectionPort;
  reconnect(): void;
  destroy(): void;
}

export interface IDataConnectionPort {
  readonly connectionId: string;
  readonly peer: string;
  readonly open: boolean;
  readonly type: string;
  on(event: 'open', handler: () => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (error: any) => void): void;
  on(event: 'data', handler: (data: unknown) => void): void;
  off(event: 'open', handler: () => void): void;
  off(event: 'close', handler: () => void): void;
  off(event: 'error', handler: (error: any) => void): void;
  off(event: 'data', handler: (data: unknown) => void): void;
  send(data: unknown): void;
  close(): void;
}

export interface IMediaConnectionPort {
  readonly connectionId: string;
  readonly peer: string;
  on(event: 'stream', handler: (stream: MediaStream) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (error: any) => void): void;
  off(event: 'stream', handler: (stream: MediaStream) => void): void;
  off(event: 'close', handler: () => void): void;
  off(event: 'error', handler: (error: any) => void): void;
  answer(stream: MediaStream): void;
  close(): void;
}
```

2. **Create `src/adapters/peerjs-adapter.ts`** — Concrete implementations wrapping PeerJS:

```typescript
import type { Peer, DataConnection, MediaConnection } from 'peerjs';
import type { IPeerPort, IDataConnectionPort, IMediaConnectionPort } from './ports';

export class PeerJSPeerAdapter implements IPeerPort {
  constructor(private readonly peer: Peer) {}
  // Implement all IPeerPort methods by delegating to this.peer
  get id() { return this.peer.id; }
  get open() { return this.peer.open; }
  get destroyed() { return this.peer.destroyed; }
  on(event: any, handler: any) { this.peer.on(event, handler); }
  off(event: any, handler: any) { this.peer.off(event, handler); }
  connect(remotePeerId: string, options?: any) {
    return new PeerJSDataConnectionAdapter(this.peer.connect(remotePeerId, options));
  }
  call(remotePeerId: string, stream: MediaStream, options?: any) {
    return new PeerJSMediaConnectionAdapter(this.peer.call(remotePeerId, stream, options));
  }
  reconnect() { this.peer.reconnect(); }
  destroy() { this.peer.destroy(); }
}

export class PeerJSDataConnectionAdapter implements IDataConnectionPort {
  constructor(private readonly conn: DataConnection) {}
  // Implement all IDataConnectionPort methods
  get connectionId() { return this.conn.connectionId; }
  get peer() { return this.conn.peer; }
  get open() { return this.conn.open; }
  get type() { return this.conn.type; }
  on(event: any, handler: any) { this.conn.on(event, handler); }
  off(event: any, handler: any) { this.conn.off(event, handler); }
  send(data: unknown) { this.conn.send(data); }
  close() { this.conn.close(); }
}

export class PeerJSMediaConnectionAdapter implements IMediaConnectionPort {
  constructor(private readonly call: MediaConnection) {}
  // Implement all IMediaConnectionPort methods
  get connectionId() { return this.call.connectionId; }
  get peer() { return this.call.peer; }
  on(event: any, handler: any) { this.call.on(event, handler); }
  off(event: any, handler: any) { this.call.off(event, handler); }
  answer(stream: MediaStream) { this.call.answer(stream); }
  close() { this.call.close(); }
}
```

3. **Create `src/adapters/index.ts`:**

```typescript
export type { IPeerPort, IDataConnectionPort, IMediaConnectionPort } from './ports';
export { PeerJSPeerAdapter, PeerJSDataConnectionAdapter, PeerJSMediaConnectionAdapter } from './peerjs-adapter';
```

4. **Do NOT migrate existing machines to use ports** — That is a major refactor (Phase 4). The interfaces are defined so future work can adopt them incrementally. For now, they serve as:
   - A clear contract for what PeerJS provides
   - Ready-to-use mock targets for testing
   - Documentation of the library's external dependencies

5. **Create mock adapter factories for testing** — In each test file, use the port interfaces to create clean mocks instead of casting `as unknown as Peer`.

**Done when:**
- `src/adapters/ports.ts` defines `IPeerPort`, `IDataConnectionPort`, `IMediaConnectionPort`
- `src/adapters/peerjs-adapter.ts` implements all three wrapping PeerJS
- `src/adapters/index.ts` barrel-exports
- `npm run build` succeeds
- Adapters are NOT imported by existing machines (they are preparatory)

---

## Phase 2 + 3 Combined Test Strategy

### Unit Tests (TASK-09 through TASK-14)

| Module | Test File | Coverage Target | Key Invariants |
|---|---|---|---|
| SignalingService | `SignalingService.test.ts` | 90% | Handler registration, message routing, destroy clears all |
| ConnectionMachine | `ConnectionMachine.test.ts` + `state.test.ts` | 80% | All 4 states reachable, timeouts fire, listeners cleaned up |
| CallMachine | `CallMachine.test.ts` + `state.test.ts` | 80% | Both inbound/outbound paths, all terminal states reachable |
| PeerManager | `PeerManager.test.ts` + `state.test.ts` | 80% | All 5 states, auto-reconnect, duplicate prevention, child cleanup |
| MediaMachine | `MediaMachine.test.ts` + `state.test.ts` | 80% | All 7 states, permission handling, device switching, recovery |
| Transition validation | `transitions.property.test.ts` | N/A | Legal transitions never throw, illegal always throw |
| CallCoordinator | `CallCoordinator.test.ts` | 80% | Lifecycle orchestration, signaling integration |

### Test Database Strategy
No database. All tests use in-memory mocks of PeerJS and browser APIs via `vi.fn()` and `vi.stubGlobal()`.

### Mocking Strategy

| External Dependency | Mock Approach |
|---|---|
| `Peer` | Object with `vi.fn()` for `on`, `off`, `connect`, `call`, `destroy`, `reconnect` |
| `DataConnection` | Object with `vi.fn()` for `on`, `off`, `send`, `close` |
| `MediaConnection` | Object with `vi.fn()` for `on`, `off`, `answer`, `close` |
| `navigator.mediaDevices` | `vi.stubGlobal('navigator', { mediaDevices: { ... } })` |
| `navigator.permissions` | `vi.stubGlobal('navigator', { permissions: { query: vi.fn() } })` |
| `setTimeout`/`clearTimeout` | `vi.useFakeTimers()` + `vi.advanceTimersByTime()` |
| `console.warn` | `vi.spyOn(console, 'warn').mockImplementation(() => {})` |

### Property-Based Testing
Use `@fast-check/vitest` for transition validation invariants (TASK-14). Generators:
- `fc.constantFrom(...stateTags)` for state names
- `fc.tuple(fc.constantFrom(fromStates), fc.constantFrom(toStates))` for transition pairs
- Filter to legal/illegal pairs and assert expected behavior

---

## Non-Functional Considerations

- **Deployment:** No change — library is built with tsup and published via npm. New exports are additive.
- **Security:** No new attack surface. Error messages should not expose internal peer IDs in production — `PeerChatError.message` is safe for logs but not for UI display without sanitization.
- **Performance:** Transition validation adds one `Map.get()` + `Set.has()` per transition — negligible. Telemetry is no-op by default.

---

## Traceability Matrix

| ARCH Plan Item | Description | Task(s) |
|---|---|---|
| 1.4 | Delete `test-call.ts` | TASK-01 |
| 1.1 | Remove/adopt `Interpreter` | TASK-02 |
| 1.2 | Use/remove event constants | TASK-03 |
| 1.3 | Standardize constructors | TASK-04 |
| 1.5 | Add `SignalingService.destroy()` | TASK-05 |
| 1.6 | Clarify public API | TASK-06 |
| 2.1 | State transition validation | TASK-07 |
| 2.3 | Parent-child ownership registry | TASK-08 |
| 2.2 | Unit tests | TASK-09, TASK-10, TASK-11, TASK-12, TASK-13, TASK-15, TASK-16 |
| 2.4 | Property-based tests | TASK-14 |
| 3.2 | Structured error hierarchy | TASK-17 |
| 3.3 | Telemetry hooks | TASK-18 |
| 3.1 | PeerJS adapter interfaces | TASK-19 |

---

## Self-Correction Checklist

- [x] Phase 0 classification declared: **library / complex** — 19 tasks, multiple domains (core, peer, call, connection, media, signaling, adapters), non-trivial consistency requirements
- [x] Active blueprint sections: 1, 3, 4, 5, 7, 10, 11
- [x] Skipped: 2 (no hard-to-reverse decisions — deleting dead code and adding tests are reversible), 6 (no database), 8 (library, no server), 9 (no non-trivial end-to-end flow — this is a library, not a service)
- [x] Every conflict surfaced: Interpreter deletion chosen (class-based is the established pattern), port interfaces are preparatory (migration deferred to Phase 4)
- [x] No task references undefined types/files — all created in dependency order
- [x] Every task has a verifiable done-when
- [x] Test tasks placed immediately after the implementation they cover
- [x] Every ARCH plan item mapped to at least one task
- [x] No vague prose — function signatures, types, and mapping rules are explicit
- [x] Plan is self-contained — a coding agent can execute start to finish

---

## Execution Order Summary

```
TASK-01  (delete test-call.ts)
TASK-02  (delete interpreter)
TASK-03  (event constants) ────────────────────── depends on TASK-02
TASK-04  (standardize constructors) ───────────── depends on TASK-03
TASK-05  (SignalingService.destroy) ───────────── independent, can run with TASK-01
TASK-06  (public API) ────────────────────────── depends on TASK-04
TASK-07  (transition validation) ──────────────── independent
TASK-08  (child ownership registry) ───────────── depends on TASK-07
TASK-09  (SignalingService tests) ─────────────── depends on TASK-05
TASK-10  (ConnectionMachine tests) ────────────── depends on TASK-04, TASK-07
TASK-11  (CallMachine tests) ──────────────────── depends on TASK-04, TASK-07
TASK-12  (PeerManager tests) ──────────────────── depends on TASK-07, TASK-08
TASK-13  (MediaMachine tests) ─────────────────── depends on TASK-07
TASK-14  (property-based tests) ───────────────── depends on TASK-07
TASK-15  (CallCoordinator tests) ──────────────── depends on TASK-09, TASK-10, TASK-11
TASK-16  (PeerReadyState tests) ───────────────── depends on TASK-12, TASK-15
TASK-17  (error hierarchy) ────────────────────── depends on TASK-07
TASK-18  (telemetry hooks) ────────────────────── depends on TASK-17
TASK-19  (PeerJS adapter interfaces) ───────────── independent
```
