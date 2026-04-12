# Architecture Plan — peerchat

> **Date:** 2026-04-12
> **Status:** Draft — awaiting prioritization
> **Scope:** Library-wide improvements from architectural review

---

## 1. Current Architecture Overview

### 1.1 Core Design

Every resource in peerchat is modeled as a **hierarchical state machine**:

```
PeerManager (top-level machine)
  ├── ConnectionMachine (spawned per DataConnection)
  └── CallCoordinator (spawned per MediaConnection)
        └── CallMachine (inside CallCoordinator)
```

MediaMachine stands alone as a peer-independent machine for local media management.

### 1.2 Key Patterns in Use

| Pattern | Where |
|---|---|
| State Machine | All modules — `AbstractMachine<States, Events>` |
| Discriminated Union | All state types — `_tag` property for narrowing |
| Observer/Subscriber | `AbstractMachine` — `onTransition`, `subscribe`, `on(event)` |
| Factory Method | `CallMachineFactory`, `MachineFactory` |
| Coordinator | `CallCoordinator` — orchestrates call + signaling connection |
| Dependency Injection | Constructor params + context objects |
| Branded Types | `CallId`, `ConnectionId` in `src/core/types.ts` |
| Exponential Backoff | `PeerDisconnectedState` reconnect logic |
| Abort Controller | Media async states |

### 1.3 File Inventory

| Module | Files | Purpose |
|---|---|---|
| `core/` | `machine.ts`, `interpreter.ts`, `events.ts`, `types.ts`, `logger.ts` | Foundational abstractions |
| `peer/` | `PeerManager.ts`, `state.ts`, `types.ts` | PeerJS lifecycle |
| `call/` | `CallMachine.ts`, `CallCoordinator.ts`, `state.ts`, `types.ts` | MediaCall lifecycle |
| `connection/` | `ConnectionMachine.ts`, `state.ts`, `types.ts` | DataChannel lifecycle |
| `media/` | `MediaManager.ts`, `state.ts`, `types.ts` | MediaDevices API |
| `signaling/` | `SignalingService.ts`, `types.ts` | Signaling message router |

---

## 2. What's Done Well

1. **State machine abstraction** — `AbstractMachine` provides transition listeners, event subscription, and lifecycle management.
2. **Discriminated unions** — `_tag` enables exhaustive narrowing with TypeScript.
3. **Dependency injection** — `CallMachineFactory` and context objects enable testability.
4. **Scoped logging** — Color-coded, prefix-based logger.
5. **Timeout-based error handling** — Auto-timeouts prevent zombie states.
6. **Exponential backoff** — Reconnection with capped backoff.

---

## 3. Issues Found (by Priority)

### P0 — Critical

#### 3.1 No State Transition Validation

**Problem:** Any state can transition to any other state. There is no compile-time or runtime guard preventing illegal transitions (e.g., `ringing → ringing`, `ended → live`).

**Impact:** Bugs from accidental illegal transitions are only caught at runtime through incorrect behavior, not explicit errors.

**Current state:**
```typescript
// In any state class — can transition to ANY other state:
this.ctx.transition(next); // no validation
```

**What's missing:** A transition adjacency map (statechart) with runtime validation in dev mode.

---

#### 3.2 `Interpreter` is Dead Code

**Problem:** `src/core/interpreter.ts` implements a proper FSM with `Reducer`, `Command`, and `CommandHandler` — but **zero** concrete machines use it. The concrete machines manage transitions manually inside state classes.

**Impact:**
- Two competing paradigms coexist
- Confusion for contributors
- Unused code ships to consumers (~120 lines)

**Evidence:** `PeerManager`, `CallMachine`, `ConnectionMachine`, `MediaMachine` all extend `AbstractMachine` and manage state directly. None instantiate `Interpreter`.

---

#### 3.3 Zero Tests for Core Logic

**Problem:** Only `Interpreter` and `types.test.ts` have tests. The following are **completely untested**:

| Module | File | Tests |
|---|---|---|
| Peer | `PeerManager.ts` | ❌ |
| Peer | `state.ts` (5 state classes) | ❌ |
| Call | `CallMachine.ts` | ❌ |
| Call | `CallCoordinator.ts` | ❌ |
| Call | `state.ts` (5 state classes) | ❌ |
| Connection | `ConnectionMachine.ts` | ❌ |
| Connection | `state.ts` (4 state classes) | ❌ |
| Media | `MediaManager.ts` | ❌ |
| Media | `state.ts` (7 state classes) | ❌ |
| Signaling | `SignalingService.ts` | ❌ |

**Note:** `@fast-check/vitest` is installed but unused.

---

### P1 — High

#### 3.4 No Immutability / Pure State Transitions

**Problem:** State classes mutate `this.currentState` directly via `ctx.transition(next)`. States are classes with side effects, not pure values.

**Impact:**
- Harder to unit test (must verify side effects)
- No time-travel debugging
- No state serialization/rehydration
- No undo/redo possibility

**Contrast:** The unused `Interpreter` has the correct pattern: `reducer(state, event) => [nextState, commands]`.

---

#### 3.5 Tight Coupling to PeerJS

**Problem:** State constructors directly accept `Peer`, `MediaConnection`, `DataConnection` types. There is no adapter layer.

**Impact:**
- Cannot swap signaling backends (e.g., custom WebSocket signaling)
- Hard to mock in tests (must mock entire PeerJS API surface)
- Vendor lock-in

**Missing:** Ports & Adapters (Hexagonal Architecture) pattern.

---

#### 3.6 Event Constants Are Unused

**Problem:** `src/core/events.ts` defines `PeerEvents`, `CallEvents`, `ConnectionEvents` constants, but they are **never imported** anywhere.

```typescript
// events.ts — defined but unused:
export const PeerEvents = { READY: 'peer.ready', DISCONNECTED: 'peer.disconnected', ... };

// state.ts — hardcoded string literals used instead:
this.ctx.emit({ type: 'peer.ready', peerId: id });
```

**Impact:** Typos in event names compile fine. No single source of truth.

---

#### 3.7 `SignalingService` Has No Lifecycle Management

**Problem:** `SignalingService` is a plain class, not extending `AbstractMachine`. It manages `handlers: Map` but has no state model, no `destroy()` method, and no cleanup on parent destruction.

**Impact:** Handler maps can leak if `SignalingService` outlives its parent.

---

### P2 — Medium

#### 3.8 No Structured Error Hierarchy

**Problem:** Errors are handled ad-hoc. Some states call `handleFatalError()`, others just emit events. Error types are plain strings (`'browser-incompatible'`, `'invalid-id'`) with no hierarchy.

**Missing:** A unified error type with:
- Error codes (machine-readable)
- User-facing messages
- Retryability flags
- Severity levels

---

#### 3.9 Resource Leak Risks

**Problem:** `PeerReadyState` and `PeerDisconnectedState` hold `Map` references to child machines. If `destroy()` is called but a state forgets `cleanupChildren()`, children leak.

**Missing:** Parent-child ownership registry in `AbstractMachine` that auto-destroys children.

---

#### 3.10 No Public API Surface Discipline

**Problem:** `src/index.ts` exports only `PeerManager`, `MediaMachine`, `setLogging`, and some types. `CallCoordinator`, `SignalingService`, `ConnectionMachine`, `CallMachine` are not exported.

**Impact:** Consumers cannot manage calls/connections directly. The library is opinionated but undocumented about what's public vs internal.

---

#### 3.11 Inconsistent Constructor Patterns

**Problem:** Some machines accept config objects, others take positional parameters:

```typescript
// PeerManager — config object ✅
new PeerManager({ peer, maxRetries?, baseRetryDelay? })

// ConnectionMachine — positional parameters ❌
new ConnectionMachine(connection, connectionId, remotePeerId, onData)

// CallMachine — positional parameters ❌
new CallMachine(call, callId, remotePeerId, direction, onCallEnded)
```

---

#### 3.12 No Telemetry / Observability Hooks

**Problem:** Beyond console logging, there is no structured telemetry — no metrics, tracing, or debug event log.

**Missing:** A `Telemetry` interface consumers can implement to capture state transitions, errors, and latencies.

---

### P3 — Low

#### 3.13 Dead File: `test-call.ts`

References a non-existent `TransitionTable` export. Table-based transition definition does not match the class-based implementation.

#### 3.14 No `destroy()` on `SignalingService`

`SignalingService` has no `destroy()` method to clear its `handlers` map.

#### 3.15 Circular Dependency Risk

`src/peer/state.ts` → `src/call/CallCoordinator.ts` → `src/connection/ConnectionMachine.ts`. Currently acyclic but fragile — a new import could create a cycle.

---

## 4. Recommended Improvements

### Phase 1 — Cleanup & Consistency (Quick Wins)

| # | Task | Effort | Details |
|---|---|---|---|
| 1.1 | **Remove or adopt `Interpreter`** | Medium | Either refactor all machines to use `Interpreter` (reducer-driven) **or** delete `interpreter.ts` and document the class-based approach. |
| 1.2 | **Use or remove event constants** | Low | Either import `PeerEvents`, `CallEvents`, `ConnectionEvents` from `events.ts` everywhere, or delete the file. |
| 1.3 | **Standardize constructor signatures** | Low | Convert all machine constructors to accept a single config object. |
| 1.4 | **Delete `test-call.ts`** | Trivial | Dead file referencing non-existent types. |
| 1.5 | **Add `destroy()` to `SignalingService`** | Trivial | Clear `handlers` map on destroy. Call from parent cleanup. |
| 1.6 | **Clarify public API** | Low | Document what's public vs internal in `index.ts` and README. Decide if `CallCoordinator` etc. should be exported. |

### Phase 2 — Safety & Testing

| # | Task | Effort | Details |
|---|---|---|---|
| 2.1 | **Add state transition validation** | Medium | Define adjacency maps per machine. Add runtime guard in `AbstractMachine.transition()` that validates allowed transitions. Warn/error in dev mode. |
| 2.2 | **Add unit tests with PeerJS mocks** | High | Test all state classes and machines. Mock `Peer`, `MediaConnection`, `DataConnection`. Target 80%+ coverage. |
| 2.3 | **Add parent-child ownership registry** | Medium | `AbstractMachine` tracks spawned child machines. Auto-destroy children on parent destroy. |
| 2.4 | **Add property-based tests** | Medium | Use installed `@fast-check/vitest` for state transition invariants, event ordering, etc. |

### Phase 3 — Architecture

| # | Task | Effort | Details |
|---|---|---|---|
| 3.1 | **Introduce PeerJS adapter interfaces** | High | Define `IPeer`, `IMediaConnection`, `IDataConnection` interfaces. Adapter implementations wrap PeerJS. Enables testing and backend swapping. |
| 3.2 | **Create structured error hierarchy** | Medium | Define `PeerChatError` base class with `code`, `message`, `retryable`, `severity`. Subclass for each domain. |
| 3.3 | **Add telemetry hooks** | Medium | Define `Telemetry` interface (`onTransition`, `onError`, `onEmit`). Pass via context. Default implementation is no-op or console logger. |

### Phase 4 — Advanced (Future)

| # | Task | Effort | Details |
|---|---|---|---|
| 4.1 | **Immutable state transitions** | High | Migrate from class-based states to plain-object states with pure reducers. XState-style. Major refactor. |
| 4.2 | **State serialization / rehydration** | Medium | Only possible after immutable transitions. Enables persisting call state across page reloads. |
| 4.3 | **React hooks package** | Medium | `usePeerManager`, `useCall`, `useConnection` — built on `subscribe()` for `useSyncExternalStore`. |

---

## 5. Implementation Order Recommendation

```
Phase 1 (cleanup)
  ├── 1.4 Delete test-call.ts
  ├── 1.5 Add SignalingService.destroy()
  ├── 1.2 Use/remove event constants
  ├── 1.3 Standardize constructors
  ├── 1.1 Remove or adopt Interpreter  ← decision point
  └── 1.6 Clarify public API

Phase 2 (safety)
  ├── 2.3 Parent-child ownership registry
  ├── 2.1 State transition validation
  └── 2.2 Unit tests (runs parallel with above)

Phase 3 (architecture)
  ├── 3.2 Structured error hierarchy
  ├── 3.3 Telemetry hooks
  └── 3.1 PeerJS adapter interfaces

Phase 4 (future)
  └── As needed
```

---

## 6. Design Patterns to Add

| Pattern | Solves | Priority |
|---|---|---|
| **State Transition Guard** | Illegal transitions | P0 |
| **Parent-Child Ownership (RAII)** | Resource leaks | P1 |
| **Ports & Adapters** | PeerJS coupling | P2 |
| **Error Hierarchy** | Ad-hoc error handling | P2 |
| **Telemetry Interface** | No observability | P2 |
| **Config Object Pattern** | Inconsistent constructors | P1 |
| **Statechart / Adjacency Map** | Transition validation | P0 |

---

## 7. Open Questions

1. **Interpreter fate:** Should we adopt the reducer/command pattern fully, or commit to class-based state machines and delete `interpreter.ts`?
2. **Public API scope:** Should `CallCoordinator`, `SignalingService`, and individual machines be exported, or kept internal?
3. **PeerJS coupling:** Is PeerJS a permanent dependency, or should we prepare for alternative signaling backends?
4. **React integration:** Is a React hooks package in scope for this library, or should it be a separate `peerchat-react` package?

---

## Appendix A — Event Inventory

### Peer Events (11)
- `peer.ready` — PeerJS initialized
- `peer.error` — Error occurred
- `peer.disconnected` — Lost connection to signaling server
- `peer.destroyed` — Peer destroyed
- `connection.opened` — DataConnection established
- `connection.closed` — DataConnection closed
- `connection.error` — DataConnection error
- `connection.data` — Data received
- `call.incoming` — Incoming media call
- `call.active` — Call is now live
- `call.ended` — Call ended (includes `call.error`, `call.rejected`, `call.declined`)

### Call Events (6)
- `call.incoming`, `call.active`, `call.ended`, `call.error`, `call.rejected`, `call.declined`

### Connection Events (4)
- `connection.opened`, `connection.closed`, `connection.error`, `connection.data`

### Media Events (11)
- `media.active`, `media.inactive`, `media.permission.status`, `media.permission.error`,
  `media.device.changed`, `media.track.ended`, `media.track.muted`, `media.track.unmuted`,
  `media.error`, `media.recovering`, `media.recovered`

---

## Appendix B — State Machines Summary

| Machine | States | Transitions | Commands |
|---|---|---|---|
| **PeerManager** | `initializing`, `ready`, `disconnected`, `error`, `destroyed` | 5 | `connect()`, `call()` |
| **CallMachine** | `ringing`, `connecting`, `live`, `ended`, `error` | 5 | `answer()`, `reject()`, `hangUp()` |
| **ConnectionMachine** | `connecting`, `open`, `closed`, `error` | 4 | `send()`, `close()` |
| **MediaMachine** | `idle`, `checkingPermissions`, `requesting`, `active`, `switching`, `recovering`, `denied` | 7 | `startCamera()`, `startScreenShare()`, `stop()` |
