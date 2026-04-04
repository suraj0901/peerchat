# PeerChat

A composable, state-machine-driven wrapper around [PeerJS](https://peerjs.com/) for video calls, data channels, and media management.

- 🔊 **Video & audio calls** — answer, reject, hang up, with timeout handling
- 💬 **Data channels** — real-time messaging with typed events
- 🎥 **Media management** — camera/mic acquisition, device switching, screen sharing, permission monitoring
- 🔄 **State machine architecture** — every resource is a machine with typed, discriminated-union states
- 📦 **Composable** — use `PeerManager` and `MediaMachine` independently or together
- ⚡ **ESM & CJS** — ships dual-format with full TypeScript declarations

## Install

```bash
npm install peerchat peerjs
```

> `peerjs` is a peer dependency — you bring your own version.

## Architecture

PeerChat is built around composable state machines. Every machine extends `AbstractMachine<State, Event>` and exposes:

| Method | Description |
|---|---|
| `getState()` | Returns the current state (a discriminated union with `_tag`) |
| `subscribe(fn)` | Called on every state change — ideal for React/Svelte bindings |
| `onTransition(fn)` | Called with `(next, prev)` on state transitions |
| `on(eventType, fn)` | Subscribe to typed events emitted by the machine |
| `destroy()` | Tear down the machine and all listeners |

**Commands live on the state, not the machine.** Narrow the state via `_tag`, then call methods directly:

```ts
const state = peer.getState();
if (state._tag === 'ready') {
  state.connect('remote-peer-id');
  state.call('remote-peer-id', localStream);
}
```

## Quick Start

```ts
import Peer from 'peerjs';
import { PeerManager, MediaMachine } from 'peerchat';

const peer = new PeerManager({ peer: new Peer('my-id') });
const media = new MediaMachine();

// ── Wait for peer to be ready ──
peer.on('peer.ready', ({ peerId }) => {
  console.log('Connected as:', peerId);
});

// ── Acquire local media ──
const mediaState = media.getState();
if (mediaState._tag === 'idle') {
  mediaState.request({ audio: true, video: true });
}

media.on('media.stream.ready', ({ stream }) => {
  // Now you can make a call
  const state = peer.getState();
  if (state._tag === 'ready') {
    state.call('friend-id', stream);
  }
});

// ── Handle incoming calls ──
peer.on('call.incoming', ({ callId, remotePeerId }) => {
  const state = peer.getState();
  if (state._tag === 'ready') {
    const callMachine = state.calls.get(callId);
    const callState = callMachine?.getState();
    if (callState?._tag === 'ringing') {
      callState.answer(myLocalStream);
    }
  }
});

// ── Handle active call ──
peer.on('call.active', ({ callId, remoteStream }) => {
  videoElement.srcObject = remoteStream;
});

// ── Data channels ──
peer.on('connection.opened', ({ connectionId, remotePeerId }) => {
  console.log('Data channel open with', remotePeerId);
});

peer.on('connection.data', ({ connectionId, data }) => {
  console.log('Received:', data);
});

// Send data
const state = peer.getState();
if (state._tag === 'ready') {
  state.connect('friend-id');
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

### Child Machines

`PeerReadyState` spawns child machines automatically. Access them via `state.calls` and `state.connections`:

#### `CallMachine` states

| `_tag` | Commands |
|---|---|
| `ringing` | `answer(localStream)`, `reject()` |
| `connecting` | `hangUp()` |
| `live` | `hangUp()` |
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

```ts
import { useRef, useState, useEffect, useSyncExternalStore } from 'react';
import Peer from 'peerjs';
import { PeerManager, MediaMachine } from 'peerchat';
import type { PeerState, MediaState } from 'peerchat';

function usePeerManager(peerId: string) {
  const peerRef = useRef<PeerManager>();

  if (!peerRef.current) {
    peerRef.current = new PeerManager({ peer: new Peer(peerId) });
  }

  const state = useSyncExternalStore(
    (cb) => peerRef.current!.subscribe(cb).unsubscribe,
    () => peerRef.current!.getState(),
  );

  useEffect(() => () => peerRef.current?.destroy(), []);

  return { peer: peerRef.current, state };
}
```

## Example

A full working demo lives in [`example-react/`](./example-react). To run it:

```bash
cd example-react
npm install
npm run dev
```

## License

MIT
