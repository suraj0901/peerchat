# Peerchat Refactoring Plan

## Goal

Simplify the library architecture to make it more modular, maintainable, and easier to understand by:
1. Extracting all signaling logic into a dedicated `SignalingService`
2. Introducing `CallCoordinator` to encapsulate call+connection lifecycle
3. Adding missing type exports
4. Adding factory interfaces for better testability

## Current Issues

| Issue | Impact |
|-------|--------|
| PeerReadyState is a God Object (662 lines) | Hard to understand, single point of failure |
| Call + Connection coupling is complex | Non-obvious message flows between machines |
| Signaling logic scattered | `sendRemoteCloseMessage` and `sendRemoteCallEndedMessage` in PeerReadyState |
| Missing type exports | `CallEmittedEvent`, `ConnectionEmittedEvent` don't exist |
| Stringly-typed events | Event names are strings, typos not caught at compile time |
| Connection module is orphaned | `connection/index.ts` is empty |

## Phases Overview

| Phase | Scope | Risk | Impact |
|-------|-------|------|--------|
| 1: Signaling module | Medium | Low | Clarifies message flow |
| 2: CallCoordinator | High | Medium | Major PeerReadyState simplification |
| 3: Type exports | Low | Low | Better developer experience |
| 4: Factory interface | Medium | Low | Better testability |

---

## Phase 1: Extract Signaling Module

### 1.1 Create `src/signaling/types.ts`

Define all message types in one place:

```typescript
export type SignalingMessage =
  | { type: 'remote_close'; callId: string }
  | { type: 'call_rejected'; callId: string }
  | { type: 'call_declined'; callId: string };

export type SignalingHandler = (message: SignalingMessage, connectionId: string) => void;

export interface SignalingServiceConfig {
  getConnection: (remotePeerId: string) => ConnectionOpenState | null;
  emit: (event: PeerEmittedEvent) => void;
  notifyChange: () => void;
}
```

### 1.2 Create `src/signaling/SignalingService.ts`

```typescript
export class SignalingService {
  private handlers: Map<string, SignalingHandler> = new Map();

  constructor(private config: SignalingServiceConfig) {}

  sendRemoteClose(callId: string, remotePeerId: string): void;
  sendCallRejected(callId: string, remotePeerId: string): void;
  sendCallDeclined(callId: string, remotePeerId: string): void;

  handleMessage(connectionId: string, message: SignalingMessage): void;
  registerHandler(callId: string, handler: SignalingHandler): void;
  unregisterHandler(callId: string): void;
}
```

**Key insight:** The `SignalingService` owns the `Map<callId, handler>` for routing messages back to the correct call.

### 1.3 Update `src/peer/state.ts`

- Remove `sendRemoteCloseMessage` method
- Remove `sendRemoteCallEndedMessage` method
- Create `SignalingService` instance in `PeerReadyState`
- Delegate all signaling to `SignalingService`

### 1.4 Update `src/peer/types.ts`

- Remove `DataConnectionMessage` type (moved to signaling)
- Keep `PeerEmittedEvent` here

---

## Phase 2: CallCoordinator Pattern

### 2.1 Create `src/call/CallCoordinator.ts`

```typescript
export interface CallCoordinatorConfig {
  call: MediaConnection;
  callId: string;
  remotePeerId: string;
  direction: CallDirection;
  signalingService: SignalingService;
  onEnded: (callId: string, event: PeerEmittedEvent) => void;
  onActive: (callId: string, remoteStream: MediaStream) => void;
  notifyChange: () => void;
}

export class CallCoordinator {
  public readonly callMachine: CallMachine;
  public readonly connection: ConnectionMachine | null;

  constructor(config: CallCoordinatorConfig) {
    // 1. Create CallMachine
    // 2. Set up transition listener to:
    //    - Call signalingService.sendRemoteClose when ended
    //    - Emit call.active when live
    //    - Call onEnded when ended/error
    // 3. Create parallel data connection via signalingService
  }

  destroy(): void {
    // Clean up callMachine and connection
  }
}
```

### 2.2 Update `src/peer/state.ts` - PeerReadyState

**Before (complex):**
```typescript
private spawnCallChild(call, callId, remotePeerId, direction) {
  const machine = new CallMachine(call, callId, remotePeerId, direction, callback);
  // ... transition handling
}
```

**After (simple):**
```typescript
private callCoordinators: Map<string, CallCoordinator> = new Map();

private spawnCallCoordinator(config: CallCoordinatorConfig): CallCoordinator {
  const coordinator = new CallCoordinator(config);
  this.callCoordinators.set(config.callId, coordinator);
  return coordinator;
}

private removeCallCoordinator(callId: string): void {
  const coordinator = this.callCoordinators.get(callId);
  if (coordinator) {
    coordinator.destroy();
    this.callCoordinators.delete(callId);
  }
}
```

### 2.3 Update `src/call/state.ts`

- Remove `sendRemoteCallEndedMessage` from `CallContext` (moved to coordinator)
- Call states only handle their local behavior
- States become pure data + transitions

---

## Phase 3: Missing Type Exports

### 3.1 Create `src/call/types.ts`

```typescript
export type CallEmittedEvent =
  | { type: 'call.incoming'; callId: string; remotePeerId: string }
  | { type: 'call.active'; callId: string; remotePeerId: string; remoteStream: MediaStream }
  | { type: 'call.ended'; callId: string }
  | { type: 'call.error'; callId: string; error: Error | PeerError<string> }
  | { type: 'call.rejected'; callId: string; remotePeerId: string }
  | { type: 'call.declined'; callId: string; remotePeerId: string };
```

### 3.2 Create `src/connection/types.ts`

```typescript
export type ConnectionEmittedEvent =
  | { type: 'connection.opened'; connectionId: string; remotePeerId: string }
  | { type: 'connection.closed'; connectionId: string }
  | { type: 'connection.error'; connectionId: string; error: Error | PeerError<string> }
  | { type: 'connection.data'; connectionId: string; data: unknown };
```

### 3.3 Update index files

- `src/call/index.ts` - export `CallEmittedEvent`
- `src/connection/index.ts` - export `ConnectionMachine`, `ConnectionEmittedEvent`
- `src/index.ts` - export new types

---

## Phase 4: Machine Factory Interface

### 4.1 Add to `src/core/machine.ts`

```typescript
export interface MachineFactory<S, C = {}> {
  create(context: MachineContext<S>, config?: C): S;
}

export interface CallMachineFactory {
  create(config: {
    call: MediaConnection;
    callId: string;
    remotePeerId: string;
    direction: CallDirection;
  }): CallMachine;
}
```

### 4.2 Update `CallCoordinator` to accept factory

```typescript
constructor(
  config: CallCoordinatorConfig,
  callMachineFactory?: (config: CallMachineConfig) => CallMachine
) {
  this.callMachine = (callMachineFactory ?? CallMachine)(
    config.call, config.callId, config.remotePeerId, config.direction
  );
  // ...
}
```

---

## Phase 5: Event Constants (Optional Polish)

### 5.1 Create `src/core/events.ts`

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
```

---

## File Changes Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/signaling/types.ts` | **NEW** | All signaling message types |
| `src/signaling/SignalingService.ts` | **NEW** | Centralized signaling logic |
| `src/signaling/index.ts` | **NEW** | Re-exports |
| `src/call/CallCoordinator.ts` | **NEW** | Encapsulates call+connection lifecycle |
| `src/call/types.ts` | **NEW** | `CallEmittedEvent` type |
| `src/connection/types.ts` | **NEW** | `ConnectionEmittedEvent` type |
| `src/core/events.ts` | **NEW** | Event name constants |
| `src/core/machine.ts` | MODIFY | Add factory interfaces |
| `src/peer/state.ts` | REFACTOR | Simplify using SignalingService + CallCoordinator |
| `src/peer/types.ts` | MODIFY | Remove DataConnectionMessage (moved) |
| `src/call/state.ts` | MODIFY | Remove callback from context |
| `src/call/CallMachine.ts` | MODIFY | Accept factory |
| `src/call/index.ts` | MODIFY | Export CallEmittedEvent |
| `src/connection/index.ts` | MODIFY | Export ConnectionMachine + types |
| `src/index.ts` | MODIFY | Export new types |

---

## Complexity Reduction

| Metric | Before | After |
|--------|--------|-------|
| PeerReadyState lines | ~662 | ~250 |
| Message handling locations | Scattered in PeerReadyState | Single SignalingService |
| Call+Connection coupling | Complex inline in PeerReadyState | Encapsulated in CallCoordinator |
| Message types location | peer/types.ts | signaling/types.ts |
| Event typing | Stringly-typed | Constant-based |

---

## Migration Path

1. **Add new files** (signaling module, CallCoordinator) - no breaking changes
2. **Update PeerReadyState** to use SignalingService internally - still works same externally
3. **Add type exports** - additive changes
4. **Remove old code** from PeerReadyState

**No breaking API changes** - all public exports remain compatible.

---

## Implementation Order

1. Create `src/signaling/types.ts`
2. Create `src/signaling/SignalingService.ts`
3. Create `src/signaling/index.ts`
4. Update `src/peer/types.ts` (remove DataConnectionMessage)
5. Update `src/peer/state.ts` (use SignalingService)
6. Create `src/call/types.ts`
7. Create `src/call/CallCoordinator.ts`
8. Update `src/call/state.ts` (remove callback from context)
9. Update `src/call/CallMachine.ts` (simplify)
10. Update `src/call/index.ts` (export types)
11. Create `src/connection/types.ts`
12. Update `src/connection/index.ts` (export types)
13. Update `src/core/machine.ts` (add factory interfaces)
14. Create `src/core/events.ts`
15. Update `src/index.ts` (export new types)
16. Run build/typecheck to verify