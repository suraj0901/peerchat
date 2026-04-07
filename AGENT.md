# PeerChat — Project Context

## Project Overview

**PeerChat** is a composable, state-machine-driven TypeScript wrapper around [PeerJS](https://peerjs.com/) for peer-to-peer video calls, data channels, and media management. It provides a disciplined architecture where every resource is a state machine extending `AbstractMachine<State, Event>`, with discriminated-union states identified by a `_tag` property.

### Key Features

- **Video & audio calls** — answer, reject, hang up, with timeout handling
- **Data channels** — real-time messaging with typed events
- **Media management** — camera/mic acquisition, device switching, screen sharing, permission monitoring
- **State machine architecture** — predictable state transitions, typed events
- **Composable** — `PeerManager` and `MediaMachine` can be used independently
- **Dual-format output** — ships ESM and CJS with full TypeScript declarations

### Core Architecture

The codebase is organized into four main modules under `src/`:

| Module | Purpose |
|---|---|
| `core/` | Shared `AbstractMachine` base class, logger utilities |
| `peer/` | `PeerManager` — top-level machine managing PeerJS connection, spawning child `CallMachine` and `ConnectionMachine` instances |
| `media/` | `MediaMachine` — local media stream acquisition, device switching, permission monitoring |
| `call/` | `CallMachine` — individual call lifecycle (ringing → connecting → live → ended/error) |
| `connection/` | `ConnectionMachine` — data channel lifecycle (connecting → open → closed/error) |

Commands live **on the state, not the machine**. You narrow the state via `_tag`, then call methods directly on the state object (e.g., `state.call()`, `state.connect()`).

## Technologies

- **TypeScript** — strict mode, ESNext target, bundler module resolution
- **tsup** — build tool (wraps esbuild) for dual ESM/CJS output with sourcemaps and `.d.ts` generation
- **PeerJS** — peer dependency (WebRTC abstraction library)
- **Node.js / Bun** — runtime (dev dependencies include `@types/bun`)

## Building and Running

### Build the library

```bash
npm run build
```

This runs `tsup`, producing:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CJS)
- `dist/index.d.ts` / `dist/index.d.cts` (TypeScript declarations)
- Sourcemap files for both formats

### Run the example React app

```bash
cd example-react
npm install
npm run dev
```

### Publishing

The `prepublishOnly` script automatically runs `npm run build` before publishing to npm.

## Development Conventions

### State Machine Pattern

All machines extend `AbstractMachine<S, E>` which provides:

| Method | Description |
|---|---|
| `getState()` | Returns current state (discriminated union with `_tag`) |
| `subscribe(fn)` | Called on every state change — ideal for React/Svelte bindings |
| `onTransition(fn)` | Called with `(next, prev)` on state transitions |
| `on(eventType, fn)` | Subscribe to typed events |
| `destroy()` | Tear down the machine and all listeners |

### TypeScript Configuration

- **Strict mode** enabled
- `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` enforced
- `verbatimModuleSyntax` — ESM/CJS import/export syntax discipline
- `moduleResolution: "bundler"` — optimized for bundler workflows
- Source is in `src/`; `node_modules`, `dist`, and `example` are excluded

### File Naming

- Machine classes use PascalCase with suffix: `PeerManager.ts`, `MediaManager.ts`, `CallMachine.ts`, `ConnectionMachine.ts`
- State definitions live in `state.ts` files within each module
- Event/type definitions live in `types.ts` files

### Logging

A centralized logger (`src/core/logger.ts`) is available via `setLogging()` export. Machines use it for transition and event tracing.

## Project Structure

```
peerchat/
├── src/
│   ├── index.ts                 # Public API exports
│   ├── core/
│   │   ├── machine.ts           # AbstractMachine base class
│   │   ├── logger.ts            # Logging utilities
│   │   └── index.ts
│   ├── peer/
│   │   ├── PeerManager.ts       # Top-level peer machine
│   │   ├── state.ts             # PeerState discriminated unions
│   │   ├── types.ts             # PeerEmittedEvent types
│   │   └── index.ts
│   ├── media/
│   │   ├── MediaManager.ts      # Media machine implementation
│   │   ├── state.ts             # MediaState discriminated unions
│   │   ├── types.ts             # MediaEmittedEvent types
│   │   └── index.ts
│   ├── call/
│   │   ├── CallMachine.ts       # Call lifecycle machine
│   │   ├── state.ts             # CallState discriminated unions
│   │   └── index.ts
│   └── connection/
│       ├── ConnectionMachine.ts # Data channel machine
│       ├── state.ts             # ConnectionState discriminated unions
│       └── index.ts
├── example-react/               # Full working React demo
├── test-call.ts                 # Test script
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```
