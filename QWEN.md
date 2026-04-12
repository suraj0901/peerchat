# PeerChat — Project Context

## Project Overview

**PeerChat** is a composable, state-machine-driven wrapper around [PeerJS](https://peerjs.com/) for WebRTC video calls, data channels, and media management. It provides a high-level, event-driven API for building peer-to-peer real-time communication features.

### Core Features
- **Video & audio calls** — answer, reject, hang up, with timeout handling
- **Data channels** — real-time messaging with typed events
- **Media management** — camera/mic acquisition, device switching, screen sharing, permission monitoring
- **State machine architecture** — every resource is a machine with typed, discriminated-union states
- **Dual ESM/CJS exports** — ships with full TypeScript declarations

### Architecture

The library is built around composable state machines. Every machine extends `AbstractMachine<State, Event>` and exposes:
- `getState()` — current state (discriminated union with `_tag`)
- `getSnapshot()` — `{ state, version }` for React `useSyncExternalStore`
- `subscribe(fn)` — called on every state change
- `on(eventType, fn)` — subscribe to typed events
- `destroy()` — teardown

**Two API tiers:**
1. **Simple API** — `createPeer()`, `createMedia()`, convenience methods (`peer.call()`, `peer.send()`, etc.)
2. **Advanced API** — Direct machine access, state narrowing, child machines

## Tech Stack

| Category | Technology |
|----------|------------|
| Language | TypeScript |
| Build Tool | tsup |
| Runtime | Browser (ESM/CJS) |
| Core Dependency | PeerJS (peer dependency) |
| Package Manager | npm (bun lockfile present) |
| Module System | Dual ESM + CJS |

## Project Structure

```
peerchat/
├── src/
│   ├── index.ts              # All public exports
│   ├── factory.ts            # createPeer(), createMedia() factory functions
│   ├── core/                 # AbstractMachine, event constants, logger
│   ├── peer/                 # PeerManager — top-level machine
│   ├── call/                 # CallMachine, CallCoordinator — call lifecycle
│   ├── connection/           # ConnectionMachine — data channel lifecycle
│   ├── media/                # MediaMachine — local media streams
│   └── signaling/            # SignalingService — internal signaling over data channels
├── example-react/            # Full working React demo
├── test-call.ts              # Transition table definitions (not compiled)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── ARCHITECTURE_REVIEW.md    # Comprehensive architecture review & API redesign plan
```

## Building and Running

### Build the Library
```bash
npm run build
# or
bun run build
```

### Publish (auto-builds first)
```bash
npm run prepublishOnly
```

### Run the Example React App
```bash
cd example-react
npm install
npm run dev
```

### Development
- Source files are in `src/`
- Build output goes to `dist/`
- `tsup` handles ESM + CJS builds with TypeScript declarations

## Key Commands & Patterns

### Simple API (Recommended)
```ts
import { createPeer, createMedia, PeerEvents, CallEvents, MediaEvents } from 'peerchat';

const peer = createPeer();
const media = createMedia();
peer.attachMedia(media);

peer.on(PeerEvents.READY, ({ peerId }) => { ... });
peer.call('friend-id');
peer.send('friend-id', { type: 'chat', text: 'Hello!' });
peer.hangUp(callId);
```

### Advanced API (Machine Access)
```ts
import { PeerManager, CallMachine, ConnectionMachine } from 'peerchat';

const peer = new PeerManager({ peer: new Peer('my-id') });
const state = peer.getState();
if (state._tag === 'ready') {
  state.connect('remote-peer-id');
  state.call('remote-peer-id', localStream);
}
```

## Development Conventions

- **Strict TypeScript** — `strict: true` with additional flags like `noUncheckedIndexedAccess`, `noImplicitOverride`
- **State Machine Pattern** — All lifecycle management uses discriminated unions with `_tag` for type-safe narrowing
- **Commands on State** — Methods live on state objects, not machines. Narrow via `_tag` then call.
- **No Tests Yet** — The project currently has zero test coverage. Adding tests is a planned priority (see ARCHITECTURE_REVIEW.md).
- **ESM-first** — `"type": "module"` in package.json, with CJS as secondary output

## Important Notes

1. **PeerJS is a peer dependency** — consumers bring their own PeerJS version
2. **ARCHITECTURE_REVIEW.md** contains a comprehensive review with P0/P1 issues and a phased implementation plan for API improvements
3. **Backward compatibility** — v0.2.0 API is backward compatible with v0.1.0; factory functions are additive
4. **React integration** — `getSnapshot()` returns versioned snapshots for `useSyncExternalStore`
