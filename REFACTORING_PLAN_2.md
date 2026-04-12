# PeerChat Refactoring Plan

> Practical, incremental improvements to a solid foundation

---

## Current State Assessment

**What's Working:**

- Discriminated union states with `_tag` property (excellent TypeScript pattern)
- Hierarchical machine composition (Peer → Call/Connection)
- Dependency injection for testing (`CallMachineFactory`)
- Event bus with type-safe events
- Signaling separation (DataConnection vs MediaConnection)

**What Needs Work:**

- File sizes (peer/state.ts: 584 lines, media/state.ts: 498 lines)
- Side effects in state constructors
- No tests
- Race conditions on concurrent operations
- Terminal error states with no recovery
- Mutable properties (`audioMuted`, `videoMuted`) in "immutable" states

---

## Phase 1: Test Foundation (Week 1)

### 1.1 Setup

```bash
bun add -d vitest @vitest/coverage-v8
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["node_modules/", "tests/"],
    },
  },
});
```

### 1.2 Mocks

```typescript
// tests/mocks/peerjs.ts
import { vi } from "vitest";

type MockPeer = ReturnType<typeof createMockPeer>;
type MockDataConnection = ReturnType<typeof createMockDataConnection>;
type MockMediaConnection = ReturnType<typeof createMockMediaConnection>;

export function createMockPeer(id = "test-peer") {
  const listeners = new Map<string, Set<Function>>();

  return {
    id,
    open: false,
    destroyed: false,

    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),

    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),

    emit: vi.fn((event: string, ...args: any[]) => {
      listeners.get(event)?.forEach((h) => h(...args));
    }),

    connect: vi.fn(() => createMockDataConnection()),
    call: vi.fn(() => createMockMediaConnection()),
    destroy: vi.fn(function (this: MockPeer) {
      this.destroyed = true;
      this.emit("close");
    }),
    reconnect: vi.fn(),
  };
}

export function createMockDataConnection(remotePeerId = "remote-peer") {
  const listeners = new Map<string, Set<Function>>();
  const connectionId = `conn-${Date.now()}`;

  return {
    connectionId,
    peer: remotePeerId,
    open: false,

    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),

    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),

    emit: vi.fn((event: string, ...args: any[]) => {
      listeners.get(event)?.forEach((h) => h(...args));
    }),

    send: vi.fn(),
    close: vi.fn(),
  };
}

export function createMockMediaConnection(remotePeerId = "remote-peer") {
  const listeners = new Map<string, Set<Function>>();
  const connectionId = `call-${Date.now()}`;

  return {
    connectionId,
    peer: remotePeerId,
    open: false,

    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),

    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),

    emit: vi.fn((event: string, ...args: any[]) => {
      listeners.get(event)?.forEach((h) => h(...args));
    }),

    answer: vi.fn(),
    close: vi.fn(),
  };
}

export function createMockStream(
  opts: { video?: boolean; audio?: boolean } = {},
) {
  const { video = true, audio = true } = opts;
  const tracks: MediaStreamTrack[] = [];

  if (video) {
    tracks.push({
      kind: "video",
      enabled: true,
      stop: vi.fn(),
      readyState: "live",
    } as any);
  }
  if (audio) {
    tracks.push({
      kind: "audio",
      enabled: true,
      stop: vi.fn(),
      readyState: "live",
    } as any);
  }

  return {
    id: `stream-${Date.now()}`,
    active: true,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
  } as unknown as MediaStream;
}
```

### 1.3 Test Utilities

```typescript
// tests/utils.ts
import { vi } from "vitest";

export async function waitFor(
  condition: () => boolean,
  timeout_ms = 5000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout_ms) {
      throw new Error("Timeout waiting for condition");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function captureEvents(machine: { on: Function }) {
  const events: any[] = [];
  const unsubscribe = machine.on("*", (e: any) => events.push(e));
  return { events, unsubscribe };
}
```

### 1.4 First Tests

```typescript
// tests/peer/PeerManager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { PeerManager } from "../../src/peer/PeerManager";
import { createMockPeer } from "../mocks/peerjs";

describe("PeerManager", () => {
  it("starts in initializing state", () => {
    const peer = createMockPeer();
    const manager = new PeerManager({ peer });
    expect(manager.getState()._tag).toBe("initializing");
  });

  it("transitions to ready on peer open", async () => {
    const peer = createMockPeer();
    const manager = new PeerManager({ peer });

    (peer as any).emit("open", "test-peer");

    expect(manager.getState()._tag).toBe("ready");
    if (manager.getState()._tag === "ready") {
      expect(manager.getState().peerId).toBe("test-peer");
    }
  });
});
```

**Deliverables:**

- [ ] Vitest configured
- [ ] PeerJS mocks implemented
- [ ] 60% coverage baseline

---

## Phase 2: Split Large Files (Week 2)

### 2.1 New Structure

```
src/peer/
  index.ts
  PeerManager.ts
  context.ts
  types.ts
  states/
    index.ts
    Initializing.ts
    Ready.ts
    Disconnected.ts
    Error.ts
    Destroyed.ts
```

### 2.2 Implementation

```typescript
// src/peer/types.ts
import type { PeerError } from "peerjs";

export type PeerStateTag =
  | "initializing"
  | "ready"
  | "disconnected"
  | "error"
  | "destroyed";

export interface BasePeerState {
  readonly _tag: PeerStateTag;
  destroy(): void;
}

export const FATAL_ERRORS = new Set([
  "browser-incompatible",
  "invalid-id",
  "invalid-key",
  "ssl-unavailable",
  "server-error",
  "socket-error",
  "socket-closed",
]);

export function isFatalError(error: PeerError<string>): boolean {
  return FATAL_ERRORS.has(error.type);
}
```

```typescript
// src/peer/context.ts
import type { PeerState } from "./states";
import type { PeerEmittedEvent } from "./types";

export interface PeerContext {
  transition: (next: PeerState) => void;
  emit: (event: PeerEmittedEvent) => void;
  notifyChange: () => void;
}
```

```typescript
// src/peer/states/Initializing.ts
import type { Peer } from "peerjs";
import type { BasePeerState } from "../types";
import type { PeerContext } from "../context";
import { Ready } from "./Ready";
import { Disconnected } from "./Disconnected";
import { Error } from "./Error";
import { Destroyed } from "./Destroyed";
import { isFatalError } from "../types";
import { createLogger } from "../../core/logger";

const log = createLogger("peer:initializing");

export class Initializing implements BasePeerState {
  readonly _tag = "initializing" as const;

  constructor(
    public readonly peer: Peer,
    private readonly maxRetries: number,
    private readonly baseRetryDelay: number,
    private readonly ctx: PeerContext,
  ) {
    this.attachListeners();
  }

  private attachListeners() {
    this.peer.on("open", this.onOpen);
    this.peer.on("error", this.onError);
    this.peer.on("close", this.onClose);
    this.peer.on("disconnected", this.onDisconnected);
  }

  private onOpen = (id: string) => {
    log.info(`PeerJS open: ${id}`);
    this.destroy();
    this.ctx.transition(
      new Ready(
        this.peer,
        id,
        new Map(),
        new Map(),
        this.maxRetries,
        this.baseRetryDelay,
        this.ctx,
      ),
    );
    this.ctx.emit({ type: "peer.ready", peerId: id });
  };

  private onError = (error: any) => {
    log.error("PeerJS error", error.type);
    this.ctx.emit({ type: "peer.error", error });
    if (isFatalError(error)) {
      this.destroy();
      this.ctx.transition(new Error(error));
    }
  };

  private onClose = () => {
    log.warn("PeerJS close");
    this.destroy();
    this.peer.destroy();
    this.ctx.transition(new Destroyed());
  };

  private onDisconnected = () => {
    log.warn("PeerJS disconnected");
    this.destroy();
    this.ctx.transition(
      new Disconnected(
        this.peer,
        "",
        new Map(),
        new Map(),
        0,
        this.maxRetries,
        this.baseRetryDelay,
        this.ctx,
      ),
    );
    this.ctx.emit({ type: "peer.disconnected" });
  };

  destroy() {
    this.peer.off("open", this.onOpen);
    this.peer.off("error", this.onError);
    this.peer.off("close", this.onClose);
    this.peer.off("disconnected", this.onDisconnected);
  }
}
```

```typescript
// src/peer/states/index.ts
export { Initializing } from "./Initializing";
export { Ready } from "./Ready";
export { Disconnected } from "./Disconnected";
export { Error } from "./Error";
export { Destroyed } from "./Destroyed";

export type PeerState = Initializing | Ready | Disconnected | Error | Destroyed;
```

**Deliverables:**

- [ ] `peer/state.ts` split into `states/*.ts`
- [ ] `media/state.ts` split into `states/*.ts`
- [ ] `call/state.ts` split into `states/*.ts`
- [ ] `connection/state.ts` split into `states/*.ts`
- [ ] All tests passing

---

## Phase 3: Fix Race Conditions (Week 2-3)

### 3.1 Problem

```typescript
// Current: race condition window
public connect(remotePeerId: string) {
  // Check happens BEFORE connection created
  for (const child of this.connections.values()) { ... }  // Check
  const connection = this.peer.connect(remotePeerId);      // Call PeerJS
  this.connections.set(connection.connectionId, child);   // Add to map
}
```

Two rapid `connect('peer-a')` calls both pass the check before either is added.

### 3.2 Solution: Pending Set

```typescript
// src/peer/states/Ready.ts
export class Ready implements BasePeerState {
  readonly _tag = "ready" as const;

  private pendingConnections = new Set<string>();
  private pendingCalls = new Set<string>();

  connect(remotePeerId: string) {
    // Check pending FIRST
    if (this.pendingConnections.has(remotePeerId)) {
      log.warn(`Connection to ${remotePeerId} already pending`);
      return;
    }

    // Check existing
    for (const child of this.connections.values()) {
      const state = child.getState();
      if (
        (state._tag === "connecting" || state._tag === "open") &&
        state.remotePeerId === remotePeerId
      ) {
        log.warn(`Already connected to ${remotePeerId}`);
        return;
      }
    }

    // Mark pending BEFORE creating
    this.pendingConnections.add(remotePeerId);

    const connection = this.peer.connect(remotePeerId);
    const machine = this.spawnConnection(connection, remotePeerId);

    // Remove from pending when added
    machine.onTransition((next) => {
      if (
        next._tag === "open" ||
        next._tag === "closed" ||
        next._tag === "error"
      ) {
        this.pendingConnections.delete(remotePeerId);
      }
    });

    this.connections.set(connection.connectionId, machine);
    this.ctx.notifyChange();
  }
}
```

### 3.3 Test Race Conditions

```typescript
// tests/peer/race-conditions.test.ts
import { describe, it, expect } from "vitest";
import { PeerManager } from "../../src/peer/PeerManager";
import { createMockPeer } from "../mocks/peerjs";

describe("Race conditions", () => {
  it("prevents duplicate connections from concurrent calls", async () => {
    const peer = createMockPeer();
    const manager = new PeerManager({ peer });

    (peer as any).emit("open", "test-peer");

    const ready = manager.getState();
    if (ready._tag !== "ready") throw new Error("Not ready");

    // Fire two connect calls immediately
    ready.connect("peer-a");
    ready.connect("peer-a");

    // Should only create one connection
    expect(ready.connections.size).toBe(1);
  });
});
```

**Deliverables:**

- [ ] Pending sets for connections
- [ ] Pending sets for calls
- [ ] Race condition tests

---

## Phase 4: Error Recovery (Week 3)

### 4.1 Add Recovering States

```typescript
// src/peer/states/Recovering.ts
export class Recovering implements BasePeerState {
  readonly _tag = "recovering" as const;
  private attempt: number;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    public readonly peer: Peer,
    public readonly peerId: string,
    public readonly lastError: Error,
    attempt: number,
    private readonly maxRetries: number,
    private readonly baseDelay: number,
    private readonly ctx: PeerContext,
  ) {
    this.attempt = attempt;
    this.scheduleRetry();
  }

  private scheduleRetry() {
    const delay = Math.min(this.baseDelay * Math.pow(2, this.attempt), 30_000);

    this.timer = setTimeout(() => {
      this.attempt++;
      if (this.attempt >= this.maxRetries) {
        this.ctx.transition(new Error(this.lastError));
        this.ctx.emit({ type: "peer.error", error: this.lastError as any });
        return;
      }

      this.destroy();
      this.ctx.transition(
        new Initializing(this.peer, this.maxRetries, this.baseDelay, this.ctx),
      );
      this.peer.reconnect();
    }, delay);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
  }
}
```

### 4.2 Add Error Recovery to Media

```typescript
// src/media/states/Recovering.ts
export class Recovering implements BaseMediaState {
  readonly _tag = "recovering" as const;
  private controller = new AbortController();

  constructor(
    public readonly oldStream: MediaStream,
    private readonly constraints: MediaStreamConstraints,
    private readonly ctx: MediaContext,
  ) {
    this.acquire();
  }

  private async acquire() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        this.constraints,
      );
      if (this.controller.signal.aborted) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.oldStream.getTracks().forEach((t) => t.stop());
      this.destroy();
      this.ctx.transition(
        new Active(stream, [], "user", this.constraints, this.ctx),
      );
      this.ctx.emit({ type: "media.stream.ready", stream, mode: "user" });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.destroy();
      this.oldStream.getTracks().forEach((t) => t.stop());
      this.ctx.transition(new Idle({}, this.ctx));
      this.ctx.emit({
        type: "media.stream.error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  stop() {
    this.controller.abort();
    this.oldStream.getTracks().forEach((t) => t.stop());
    this.destroy();
    this.ctx.transition(new Idle({}, this.ctx));
  }

  destroy() {
    this.controller.abort();
  }
}
```

**Deliverables:**

- [ ] `PeerRecovering` state
- [ ] `MediaRecovering` state (already exists, verify)
- [ ] Exponential backoff with jitter
- [ ] Recovery tests

---

## Phase 5: Cleanup Mutable State (Week 4)

### 5.1 Problem

```typescript
// media/state.ts - mutable properties
export class MediaActiveState {
  public audioMuted: boolean; // Mutable!
  public videoMuted: boolean; // Mutable!
}
```

### 5.2 Solution: Transition on Mute

```typescript
// Option A: Mute triggers state change
export class MediaActiveState {
  readonly audioMuted: boolean;
  readonly videoMuted: boolean;

  toggleAudio(): [MediaState, Effect[]] {
    const next = new MediaActiveState(
      this.stream,
      this.devices,
      this.mode,
      this.constraints,
      this.permissions,
      this.ctx,
      !this.audioMuted,  // New value
      this.videoMuted
    );
    return [next, [
      { type: 'applyMute', stream: this.stream, audioMuted: !this.audioMuted }
    ]];
  }
}

// In context, transition is called
toggleAudio() {
  const [next, effects] = this.currentState.toggleAudio();
  this.currentState = next;
  this.executeEffects(effects);
  this.notifySubscribers();
}
```

### 5.3 Alternative: Simpler Approach

Keep the mutable fields but document them clearly as UI state (not machine state):

```typescript
/**
 * UI state for mute toggles.
 * These are intentionally mutable for real-time UI updates.
 * They do NOT trigger state transitions.
 */
export class MediaActiveState {
  readonly _tag = "active";

  // UI state (mutable, no transitions)
  audioMuted = false;
  videoMuted = false;

  toggleAudio() {
    this.audioMuted = !this.audioMuted;
    this.stream.getAudioTracks().forEach((t) => (t.enabled = !this.audioMuted));
    this.ctx.emit({ type: "media.audio.toggled", muted: this.audioMuted });
    this.ctx.notifyChange();
  }
}
```

**Recommendation:** Keep current approach (Option B). It's pragmatic and the mutable fields don't affect machine correctness.

**Deliverables:**

- [ ] Document mutable UI state fields
- [ ] Ensure mute operations emit events
- [ ] Tests for mute toggles

---

## Phase 6: API Hardening (Week 4)

### 6.1 Add Input Validation

```typescript
// src/peer/states/Ready.ts
import { Result, Err, Ok } from "../../core/result";

export class Ready implements BasePeerState {
  connect(remotePeerId: string): Result<void, string> {
    if (!remotePeerId || remotePeerId.trim() === "") {
      return Err("remotePeerId is required");
    }

    if (remotePeerId === this.peerId) {
      return Err("Cannot connect to self");
    }

    if (this.pendingConnections.has(remotePeerId)) {
      return Err(`Connection to ${remotePeerId} already pending`);
    }

    // ... rest of logic
    return Ok(undefined);
  }
}
```

```typescript
// src/core/result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

### 6.2 Add Guards

```typescript
// src/peer/guards.ts
import type { PeerState } from "./states";

export function canConnect(state: PeerState): state is Ready {
  return state._tag === "ready";
}

export function canCall(state: PeerState): state is Ready {
  return state._tag === "ready";
}

export function canMakeCall(
  state: PeerState,
  remotePeerId: string,
): Result<void, string> {
  if (!canCall(state)) {
    return Err(`Cannot call in ${state._tag} state`);
  }

  if (state.pendingCalls.has(remotePeerId)) {
    return Err(`Call to ${remotePeerId} already pending`);
  }

  for (const coordinator of state.calls.values()) {
    const callState = coordinator.callMachine.getState();
    if (
      (callState._tag === "ringing" || callState._tag === "live") &&
      callState.remotePeerId === remotePeerId
    ) {
      return Err(`Already in call with ${remotePeerId}`);
    }
  }

  return Ok(undefined);
}
```

**Deliverables:**

- [ ] Result type
- [ ] Input validation on public methods
- [ ] Guard functions
- [ ] Tests for validation

---

## Phase 7: Documentation (Week 5)

### 7.1 Update AGENTS.md

```markdown
## Architecture

### State Machines

All resources extend `AbstractMachine<State, Event>`. States are discriminated
unions with `_tag` property.

### File Structure

Each domain (peer, call, connection, media) has:

- `states/` — One file per state class (max 100 lines)
- `context.ts` — Context interface
- `types.ts` — Type definitions

### Patterns

- Commands on state: `state.method()`
- Dependency injection: `CallMachineFactory` for testing
- Event bus: `machine.on('event.type', handler)`
```

### 7.2 API Documentation

````typescript
/**
 * Manages WebRTC peer connections via PeerJS.
 *
 * @example
 * ```ts
 * import { Peer } from 'peerjs';
 * import { PeerManager } from 'peerchat';
 *
 * const peer = new Peer('my-id');
 * const manager = new PeerManager({ peer });
 *
 * manager.on('peer.ready', (e) => console.log('Ready:', e.peerId));
 * manager.on('call.incoming', (e) => {
 *   // Answer or reject
 *   const call = manager.getState().calls.get(e.callId);
 * });
 * ```
 */
export class PeerManager extends AbstractMachine<PeerState, PeerEmittedEvent> {
  // ...
}
````

**Deliverables:**

- [ ] AGENTS.md updated
- [ ] JSDoc on public APIs
- [ ] README examples
- [ ] Type exports verified

---

## Final File Structure

```
src/
  core/
    index.ts
    machine.ts
    logger.ts
    events.ts
    result.ts          # NEW

  peer/
    index.ts
    PeerManager.ts
    context.ts
    types.ts
    guards.ts          # NEW
    states/
      index.ts
      Initializing.ts
      Ready.ts
      Disconnected.ts
      Recovering.ts    # NEW
      Error.ts
      Destroyed.ts

  call/
    (same structure)

  connection/
    (same structure)

  media/
    (same structure)

tests/
  mocks/
    peerjs.ts
  utils.ts
  peer/
    PeerManager.test.ts
    race-conditions.test.ts
  call/
    CallMachine.test.ts
  media/
    MediaMachine.test.ts
```

---

## Success Metrics

| Metric          | Before    | After               |
| --------------- | --------- | ------------------- |
| Test coverage   | 0%        | ≥80%                |
| Largest file    | 584 lines | ≤150 lines          |
| Race conditions | Yes       | No                  |
| Error recovery  | None      | Exponential backoff |
| API validation  | None      | Result types        |

---

## Implementation Order

```
Week 1: Tests
├─ [x] Setup Vitest
├─ [ ] Create peerjs.ts mocks
├─ [ ] Write PeerManager tests (baseline)
└─ [ ] Achieve 60% coverage

Week 2: Split Files
├─ [ ] Split peer/state.ts → states/*.ts
├─ [ ] Split media/state.ts → states/*.ts
├─ [ ] Split call/state.ts → states/*.ts
├─ [ ] Split connection/state.ts → states/*.ts
└─ [ ] All tests passing

Week 3: Race Conditions + Recovery
├─ [ ] Add pendingConnections/pendingCalls sets
├─ [ ] Write race condition tests
├─ [ ] Add Recovering state to peer
└─ [ ] Write recovery tests

Week 4: Validation + Cleanup
├─ [ ] Add Result type
├─ [ ] Add input validation
├─ [ ] Add guards
├─ [ ] Document mutable UI state
└─ [ ] Tests for validation

Week 5: Documentation
├─ [ ] Update AGENTS.md
├─ [ ] Add JSDoc to all public APIs
├─ [ ] README examples
└─ [ ] Final coverage check
```

---

## Breaking Changes

**None.** All changes are internal. Public API remains:

```typescript
import { PeerManager, MediaMachine } from "peerchat";

const peer = new PeerManager({ peer: peerJsInstance });
peer.on("call.incoming", handler);
peer.getState(); // Returns current state
```
