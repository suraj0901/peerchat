# Project Conventions

## Architecture

- **State machines** — Every resource extends `AbstractMachine<State, Event>` from `src/core/machine.ts`
- **States are discriminated unions** with `_tag` property for narrowing
- **Commands live on state, not machine** — narrow via `_tag`, then call methods directly
- **Child machines** — `CallMachine` and `ConnectionMachine` are spawned by `PeerReadyState` via `CallCoordinator` (`src/call/CallCoordinator.ts`)

## Key Files

| File | Purpose |
|---|---|
| `src/core/machine.ts` | `AbstractMachine`, `MachineFactory`, `CallMachineFactory` |
| `src/core/events.ts` | Event name constants (`PeerEvents`, `CallEvents`, `ConnectionEvents`) |
| `src/signaling/` | `SignalingService` — centralized signaling via DataConnection |
| `src/call/CallCoordinator.ts` | Owns call + connection lifecycle, registers signaling handlers |
| `src/peer/state.ts` | `PeerReadyState` — manages `calls: Map<string, CallCoordinator>` |

## Type Exports

- `src/call/types.ts` — `CallEmittedEvent` union type
- `src/connection/types.ts` — `ConnectionEmittedEvent` union type

## Patterns

- **Dependency injection** — `CallCoordinator` accepts optional `CallMachineFactory` for testing
- **Signaling** — uses parallel `DataConnection` separate from media `MediaConnection`
- Events use string literals; prefer constants from `src/core/events.ts`

## Build

```bash
npm run build
```
