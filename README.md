# PeerChat

A composable, state-machine-driven wrapper around [PeerJS](https://peerjs.com/) for video calls, data channels, and media management.

- 🔊 **Video & audio calls** — answer, reject, hang up, hold/resume, with timeout handling
- 💬 **Data channels** — real-time messaging with typed events
- 🎥 **Media management** — camera/mic acquisition, device switching, screen sharing, permission monitoring
- 🔄 **State machine architecture** — every resource is a machine with typed, discriminated-union states
- 📦 **Composable** — use the simple API for quick starts, or the advanced machine API for full control
- ⚡ **ESM & CJS** — ships dual-format with full TypeScript declarations

## Install

```bash
npm install peerchat peerjs
```

> `peerjs` is a peer dependency — you bring your own version.

## Quick Start

```ts
import { createPeer, createMedia, PeerEvents, CallEvents, MediaEvents } from 'peerchat';

// Create peer and media with sensible defaults
const peer = createPeer();
const media = createMedia();

// Attach media to peer for automatic stream handling
peer.attachMedia(media);

// Wait for the peer to be ready
peer.on(PeerEvents.READY, ({ peerId }) => {
  console.log('Connected as:', peerId);
});

// When media is ready, you can make calls
media.on(MediaEvents.STREAM_READY, ({ stream }) => {
  console.log('Local media ready');
});

// Handle incoming calls
peer.on(CallEvents.INCOMING, ({ callId, remotePeerId }) => {
  console.log('Incoming call from', remotePeerId);
  // Answer with attached media
  peer.answer(callId);
});

// Make a call (uses attached media)
peer.call('friend-id');

// Send data messages
peer.send('friend-id', { type: 'chat', text: 'Hello!' });

// Handle active call
peer.on(CallEvents.ACTIVE, ({ callId, remoteStream }) => {
  videoElement.srcObject = remoteStream;
});

// Hold and resume calls
peer.hold(callId);   // Put current call on hold
peer.resume(callId); // Resume a held call

// Hang up
peer.hangUp(callId);
```

## Architecture

PeerChat is built around composable state machines. Every machine extends `AbstractMachine<State, Event>` and exposes:

| Method | Description |
|---|---|
| `getState()` | Returns the current state (a discriminated union with `_tag`) |
| `getSnapshot()` | Returns `{ state, version }` — immutable snapshot for React `useSyncExternalStore` |
| `subscribe(fn)` | Called on every state change — ideal for React/Svelte bindings |
| `onTransition(fn)` | Called with `(next, prev)` on state transitions |
| `on(eventType, fn)` | Subscribe to typed events emitted by the machine |
| `destroy()` | Tear down the machine and all listeners |

**Two API tiers:**

- **Simple API** — `createPeer()`, `createMedia()`, convenience methods like `peer.call()`, `peer.send()`
- **Advanced API** — Direct machine access, state narrowing, child machines

**Commands live on the state, not the machine.** Narrow the state via `_tag`, then call methods directly:

```ts
const state = peer.getState();
if (state._tag === 'ready') {
  state.connect('remote-peer-id');
  state.call('remote-peer-id', localStream);
}
```

## Simple API (Recommended for Most Users)

### Creating Peer and Media

```ts
import { createPeer, createMedia } from 'peerchat';

// Auto-generated peer ID
const peer = createPeer();

// Custom peer ID with signaling server
const peer = createPeer({
  peerId: 'my-unique-id',
  peerJsOptions: {
    host: 'my-server.com',
    port: 443,
    secure: true,
  },
  maxRetries: 5,
  baseRetryDelay: 1000,
});

// Media with auto permission check
const media = createMedia();
```

### Peer Convenience Methods

```ts
// Connect to a peer (idempotent)
peer.connect('remote-id');

// Send data (auto-connects if needed)
peer.send('remote-id', { text: 'hello' });

// Make a call (uses attached media or provided stream)
// Blocked if a live call already exists — hold or hang up first
peer.call('remote-id');
peer.call('remote-id', { stream: myStream });

// Answer an incoming call
// Automatically puts any live call on hold
peer.answer(callId);
peer.answer(callId, { stream: myStream });

// Reject an incoming call
peer.reject(callId);

// Hang up an active call (works from live, connecting, held, or remoteHeld)
peer.hangUp(callId);

// Hold a live call (disables media tracks, keeps connection alive)
peer.hold(callId);

// Resume a held call (automatically holds any other live call)
peer.resume(callId);

// Attach/detach media
peer.attachMedia(media);
peer.detachMedia();
```

### Query Methods (Immutable Snapshots)

```ts
// Get all active calls
const calls = peer.getActiveCalls();
// → [{ callId, remotePeerId, state: 'live' | 'ringing' | 'held' | 'remoteHeld' | ..., direction: 'inbound' | 'outbound' }]

// Get all connections
const connections = peer.getActiveConnections();
// → [{ connectionId, remotePeerId, state: 'open' | 'connecting' | ... }]

// Get specific machines for advanced access
const callMachine = peer.getCallMachine(callId);
const connMachine = peer.getConnectionMachine(connectionId);
```

### Event Constants

```ts
import { PeerEvents, CallEvents, ConnectionEvents, MediaEvents } from 'peerchat';

peer.on(PeerEvents.READY, ({ peerId }) => { ... });
peer.on(CallEvents.INCOMING, ({ callId, remotePeerId }) => { ... });
peer.on(CallEvents.ACTIVE, ({ callId, remoteStream }) => { ... });
peer.on(ConnectionEvents.DATA, ({ connectionId, data }) => { ... });
media.on(MediaEvents.STREAM_READY, ({ stream, mode }) => { ... });
```

## Advanced API (Machine Access)

For framework integrations and testing, you can access machines directly:

```ts
import { PeerManager, MediaMachine, CallMachine, ConnectionMachine } from 'peerchat';
import Peer from 'peerjs';

// Direct instantiation (still supported)
const peer = new PeerManager({ peer: new Peer('my-id') });
const media = new MediaMachine();

// Access the underlying machine
const machine = peer.machine;

// Subscribe to state changes (for React useSyncExternalStore)
const snapshot = useSyncExternalStore(
  (cb) => peer.subscribe(cb).unsubscribe,
  () => peer.getSnapshot(),
);

// Access child machines with proper types
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

## Machines

### `PeerManager`

The top-level machine that manages the PeerJS connection lifecycle, spawning child `CallMachine` and `ConnectionMachine` instances.

```ts
const peer = new PeerManager({
  peer: new Peer('my-id'),
  maxRetries: 5,         // optional, default 5
  baseRetryDelay: 1000,  // optional, default 1000ms
});
```

#### States

| State | `_tag` | Key Properties | Commands |
|---|---|---|---|
| `PeerInitializingState` | `initializing` | `peer` | — |
| `PeerReadyState` | `ready` | `peer`, `peerId`, `connections`, `calls` | `connect(remotePeerId)`, `call(remotePeerId, stream)` |
| `PeerDisconnectedState` | `disconnected` | `peer`, `peerId`, `connections`, `calls` | `reconnect()` |
| `PeerErrorState` | `error` | `lastError` | — |
| `PeerDestroyedState` | `destroyed` | — | — |

#### Events

| Event | Payload |
|---|---|
| `peer.ready` | `{ peerId }` |
| `peer.disconnected` | — |
| `peer.error` | `{ error }` |
| `connection.opened` | `{ connectionId, remotePeerId }` |
| `connection.closed` | `{ connectionId }` |
| `connection.error` | `{ connectionId, error }` |
| `connection.data` | `{ connectionId, data }` |
| `call.incoming` | `{ callId, remotePeerId }` |
| `call.active` | `{ callId, remotePeerId, remoteStream }` |
| `call.ended` | `{ callId }` |
| `call.error` | `{ callId, error }` |
| `call.rejected` | `{ callId, remotePeerId }` |
| `call.declined` | `{ callId, remotePeerId }` |
| `call.held` | `{ callId, remotePeerId }` |
| `call.resumed` | `{ callId, remotePeerId }` |
| `call.remoteHeld` | `{ callId, remotePeerId }` |
| `call.remoteResumed` | `{ callId, remotePeerId }` |

### `MediaMachine`

Manages local media streams — acquisition, device switching, screen sharing, and permission monitoring.

```ts
const media = new MediaMachine();
```

#### States

| State | `_tag` | Key Properties | Commands |
|---|---|---|---|
| `MediaIdleState` | `idle` | `permissions` | `request(constraints)`, `requestScreen(constraints?)`, `checkPermissions()` |
| `MediaCheckingPermissionsState` | `checkingPermissions` | `permissions` | — |
| `MediaRequestingState` | `requesting` | `mode`, `permissions` | `stop()` |
| `MediaActiveState` | `active` | `stream`, `devices`, `mode`, `permissions` | `switchDevice(kind, deviceId)`, `stop()` |
| `MediaSwitchingState` | `switching` | `stream`, `devices`, `mode`, `permissions` | `stop()` |
| `MediaRecoveringState` | `recovering` | `oldStream`, `mode`, `permissions` | `stop()` |
| `MediaDeniedState` | `denied` | `permissions` | `retry()` |

#### Events

| Event | Payload |
|---|---|
| `media.stream.ready` | `{ stream, mode }` |
| `media.stream.stopped` | — |
| `media.stream.error` | `{ error }` |
| `media.permission.denied` | — |
| `media.permission.status` | `{ permissions }` |
| `media.track.ended` | `{ kind }` |
| `media.recovering` | — |
| `media.device.switched` | `{ kind, stream }` |
| `media.device.switch.failed` | `{ kind, error }` |
| `media.devices.updated` | `{ devices }` |
| `media.audio.toggled` | `{ muted }` |
| `media.video.toggled` | `{ muted }` |

### Child Machines

`PeerReadyState` spawns child machines automatically. Access them via query methods or directly:

#### `CallMachine` states

| `_tag` | Commands |
|---|---|
| `ringing` | `answer(localStream)`, `reject()` |
| `connecting` | `hangUp()` |
| `live` | `hangUp()`, `hold()`, `remoteHeld()` |
| `held` | `resume()`, `hangUp()` |
| `remoteHeld` | `remoteResumed()`, `hangUp()` |
| `ended` | — |
| `error` | — |

#### `ConnectionMachine` states

| `_tag` | Commands |
|---|---|
| `connecting` | — |
| `open` | `send(data)`, `close()` |
| `closed` | — |
| `error` | — |

## React Integration

```tsx
import { useRef, useEffect, useSyncExternalStore } from 'react';
import { createPeer, createMedia, PeerManager } from 'peerchat';
import type { PeerState } from 'peerchat';

function usePeerManager() {
  const peerRef = useRef<ReturnType<typeof createPeer>>();

  if (!peerRef.current) {
    peerRef.current = createPeer();
  }

  // useSyncExternalStore with versioned snapshots
  const { state } = useSyncExternalStore(
    (cb) => peerRef.current!.subscribe(cb).unsubscribe,
    () => peerRef.current!.getSnapshot(),
  );

  useEffect(() => () => peerRef.current?.destroy(), []);

  return { peer: peerRef.current, state: state.state };
}

// Or use the convenience hook with force-update (for Map mutations)
import { useReducer, useEffect } from 'react';

function useMachineState<S>(machine: { subscribe: (cb: () => void) => { unsubscribe: () => void }; getState: () => S }): S {
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);
  useEffect(() => machine.subscribe(forceUpdate).unsubscribe, [machine]);
  return machine.getState();
}
```

## Example

A full working demo lives in [`example-react/`](./example-react). To run it:

```bash
cd example-react
npm install
npm run dev
```

## Migration from 0.1.0

The 0.2.0 API is **backward compatible**. All existing code using `new PeerManager()` and `new MediaMachine()` continues to work. New additions:

| New Feature | How to Use |
|---|---|
| Factory functions | `createPeer()` instead of `new PeerManager({ peer: new Peer() })` |
| Event constants | `import { PeerEvents, CallEvents, MediaEvents } from 'peerchat'` |
| Convenience methods | `peer.call()`, `peer.send()`, `peer.answer()`, `peer.hangUp()`, `peer.reject()` |
| Media attachment | `peer.attachMedia(media)` for automatic stream wiring |
| Query methods | `peer.getActiveCalls()`, `peer.getActiveConnections()` |
| Child machine access | `peer.getCallMachine(callId)`, `peer.getConnectionMachine(connectionId)` |
| React snapshots | `peer.getSnapshot()` returns `{ state, version }` |
| Exported classes | `CallMachine`, `ConnectionMachine` now exported |

### ⚠️ Breaking Change: New Call States

The `CallState` type union now includes `CallHeldState` (`_tag: 'held'`) and `CallRemoteHeldState` (`_tag: 'remoteHeld'`). If your code does exhaustive matching on `CallState['_tag']`, you must handle these new cases.

**New Convenience Methods:**

| Method | Description |
|---|---|
| `peer.hold(callId)` | Put a live call on hold |
| `peer.resume(callId)` | Resume a held call (auto-holds any live call) |

**New Call Events:**

| Event | When |
|---|---|
| `call.held` | Local user put a call on hold |
| `call.resumed` | Local user resumed a held call |
| `call.remoteHeld` | Remote peer put you on hold |
| `call.remoteResumed` | Remote peer resumed the call |

**Behavioral Changes:**
- `call()` is now **blocked** if a live call already exists (returns `false`)
- `answer()` now **auto-holds** any existing live call before answering
- `hangUp()` now works from `held` and `remoteHeld` states too

## License

MIT
