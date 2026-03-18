# peer-machine

XState v5 statecharts wrapping PeerJS for type-safe, declarative WebRTC — data connections, media calls, and local stream management.

## Architecture

Four machines. Three are independent; `peerMachine` internally composes two of them.

```
mediaDeviceMachine         (standalone — no PeerJS dependency)
  idle
  requesting               ← acquireStreamActor (getUserMedia / getDisplayMedia)
  active                   ← streamMonitorSource (track health + devicechange)
  switching                ← switchDeviceActor (replaceTrack)
  recovering               ← acquireStreamActor (re-acquire after unexpected track end)
  denied    (final)        ← browser denied permission; user must intervene

peerMachine
  alive                    ← peerEventSource runs here (persists across sub-states)
    initializing           ← waiting for signaling server handshake
    ready                  ← spawns connectionMachine and callMachine actors
    disconnected           ← lost signaling; waits for RECONNECT
  error     (final)        ← fatal PeerJS error, Peer is unusable
  destroyed (final)        ← peer.destroy() was called

  connectionMachine        (one actor per DataConnection)
    active                 ← connectionEventSource runs here
      connecting           ← waiting for CONNECTION_OPEN
      open                 ← accepts SEND, CLOSE commands
    closed    (final)      ← clean close, notifies peerMachine
    error     (final)      ← error close, notifies peerMachine

  callMachine              (one actor per MediaConnection)
    active                 ← callEventSource runs here
      ringing              ← inbound only; accepts ANSWER or REJECT
      connecting           ← outbound / post-answer; waiting for remote stream
      live                 ← stream flowing; accepts HANG_UP
    ended     (final)      ← clean end, notifies peerMachine
    error     (final)      ← error end, notifies peerMachine
```

`mediaDeviceMachine` and `peerMachine` are peers — neither owns the other.
They meet at the moment `localStream` is passed into `CALL` or `ANSWER_CALL`.

## Key design decisions

**Single long-lived event source per machine** — `peerEventSource` is invoked at
the `alive` compound state, not at sub-states. It survives across
`initializing → ready → disconnected → initializing` cycles because the underlying
`Peer` object is the same instance. The same pattern applies to `callMachine` —
`callEventSource` spans all of `active`, covering both `connecting` and `live`.

**Child actors per connection and call** — Each `DataConnection` gets its own
`connectionMachine` actor; each `MediaConnection` gets its own `callMachine` actor.
`peerMachine` spawns them, receives events from them via `sendParent`, and removes
them when they reach a terminal state.

**`emit` for external observation** — Both `peerMachine` and `mediaDeviceMachine`
expose all significant transitions as observable events via XState's `emit` API.
External consumers subscribe with `actor.on(...)` rather than polling `getSnapshot()`.

**Inbound/outbound call split** — Inbound calls start in `ringing` because
`call.answer()` must be called before PeerJS will emit `stream`. This makes it a
type-level error to send `HANG_UP` on an unanswered call — `REJECT` must be used
instead. Outbound calls bypass `ringing` immediately via an `always` guard.

**`answer()` as a transition action** — `call.answer(localStream)` fires during the
`ringing → connecting` transition, not as an entry action on `connecting`, because
`localStream` is only available at the moment `ANSWER` arrives.

**Fatal vs non-fatal peer errors** — Not all PeerJS errors kill the `Peer` instance.
`peer-unavailable` is non-fatal — the peer stays in `ready` and `lastError` is updated.
Fatal errors (`browser-incompatible`, `ssl-unavailable`, etc.) transition to `error` (final).

**Screen vs user media recovery** — When a track ends unexpectedly in user mode,
the machine automatically re-acquires using the same constraints (`recovering` state).
In screen mode, a track ending means the user deliberately stopped sharing via the
browser's built-in UI — the machine returns to `idle` cleanly with no recovery attempt.

**Stream mutation on device switch** — `switchDeviceActor` replaces a track inside
the existing `MediaStream` object — the reference does not change. This means
`callMachine` and any bound `<video>` elements remain valid. However, if the stream
is in an active PeerJS call, `RTCRtpSender.replaceTrack()` must be called at the
application layer to propagate the change to the remote peer.

**`mediaDeviceMachine` does not own calls** — The machine acquires and monitors the
local stream. It hands the stream to the application layer, which passes it to
`peerMachine` as needed. This separation means the same stream can be previewed in a
UI before a call, reused across multiple calls, or stopped independently.

**PeerJS `removeListener` caveat** — PeerJS does not expose `removeListener` / `off`
on its event emitters. Cleanup callbacks in `fromCallback` actors for PeerJS are
no-ops; teardown relies on `connection.close()`, `call.close()`, and `peer.destroy()`.
`MediaStreamTrack` and `navigator.mediaDevices` do support `removeEventListener`, so
`streamMonitorSource` cleans up completely.

## Usage

### Media device management

```typescript
import { createActor } from 'xstate';
import { mediaDeviceMachine } from './src';

const mediaActor = createActor(mediaDeviceMachine, { input: {} });

// Acquire camera + mic
mediaActor.on('media.stream.ready', ({ stream, mode }) => {
  // Attach to a preview element
  previewVideo.srcObject = stream;
});

mediaActor.on('media.permission.denied', () => {
  showPermissionsHelp(); // final state — user must change browser settings
});

mediaActor.on('media.track.ended', ({ kind }) => {
  console.warn(`${kind} track ended unexpectedly — recovering...`);
});

mediaActor.on('media.recovering', () => {
  showReconnectingIndicator();
});

mediaActor.on('media.stream.error', ({ error }) => {
  console.error('Could not acquire stream:', error.message);
});

mediaActor.on('media.devices.updated', ({ devices }) => {
  populateDeviceSelector(devices);
});

mediaActor.start();
mediaActor.send({ type: 'REQUEST', constraints: { audio: true, video: true } });

// Screen share
mediaActor.send({ type: 'REQUEST_SCREEN', constraints: { video: true } });
mediaActor.on('media.stream.stopped', () => {
  // Fires when user clicks "stop sharing" in the browser toolbar
});

// Switch to a different camera or microphone
mediaActor.send({ type: 'SWITCH_DEVICE', kind: 'video', deviceId: 'abc123' });
mediaActor.on('media.device.switched', ({ kind, stream }) => {
  console.log(`${kind} device switched; stream reference unchanged`);
});
mediaActor.on('media.device.switch.failed', ({ kind, error }) => {
  console.error(`Failed to switch ${kind}:`, error.message);
});

// Read available devices from snapshot
const { devices } = mediaActor.getSnapshot().context;

// Stop stream
mediaActor.send({ type: 'STOP' });
```

### Peer and data connections

```typescript
import Peer from 'peerjs';
import { createActor } from 'xstate';
import { peerMachine } from './src';

const peerActor = createActor(peerMachine, { input: { peer: new Peer() } });

peerActor.on('peer.ready', ({ peerId }) => {
  console.log('Peer ready:', peerId);
});

peerActor.on('peer.disconnected', () => {
  peerActor.send({ type: 'RECONNECT' });
});

peerActor.on('peer.error', ({ error }) => {
  console.error('Peer error:', error.type, error.message);
});

peerActor.start();

// Outbound data connection
peerActor.send({ type: 'CONNECT_TO', remotePeerId: 'remote-peer-id' });

peerActor.on('connection.opened', ({ connectionId, remotePeerId }) => {
  peerActor.send({ type: 'SEND', connectionId, data: { hello: 'world' } });
});

peerActor.on('connection.data', ({ connectionId, data }) => {
  console.log('Data from', connectionId, ':', data);
});

peerActor.on('connection.closed', ({ connectionId }) => {
  console.log('Connection closed:', connectionId);
});

peerActor.on('connection.error', ({ connectionId, error }) => {
  console.error('Connection error:', error.message);
});

peerActor.send({ type: 'CLOSE_CONNECTION', connectionId: 'the-connection-id' });
```

### Media calls

```typescript
// Outbound call — acquire stream first, then call
const stream = mediaActor.getSnapshot().context.stream!;
peerActor.send({ type: 'CALL', remotePeerId: 'remote-peer-id', localStream: stream });

// Inbound call
peerActor.on('call.incoming', ({ callId, remotePeerId }) => {
  console.log('Incoming call from', remotePeerId);

  const stream = mediaActor.getSnapshot().context.stream!;

  // Answer:
  peerActor.send({ type: 'ANSWER_CALL', callId, localStream: stream });

  // Or reject without answering:
  peerActor.send({ type: 'REJECT_CALL', callId });
});

peerActor.on('call.active', ({ callId, remoteStream }) => {
  remoteVideo.srcObject = remoteStream;
});

peerActor.on('call.ended', ({ callId }) => {
  console.log('Call ended:', callId);
});

peerActor.on('call.error', ({ callId, error }) => {
  console.error('Call error:', error.message);
});

peerActor.send({ type: 'HANG_UP', callId: 'the-call-id' });
```

### Coordinating both machines for an incoming call

```typescript
// mediaDeviceMachine and peerMachine run concurrently.
// The application layer is responsible for acquiring the stream
// before passing it to the call.

peerActor.on('call.incoming', async ({ callId, remotePeerId }) => {
  const snapshot = mediaActor.getSnapshot();

  if (snapshot.matches('active')) {
    // Stream already ready — answer immediately
    peerActor.send({ type: 'ANSWER_CALL', callId, localStream: snapshot.context.stream! });
  } else {
    // Need to acquire a stream first
    mediaActor.send({ type: 'REQUEST', constraints: { audio: true, video: true } });

    const unsubscribe = mediaActor.on('media.stream.ready', ({ stream }) => {
      unsubscribe();
      peerActor.send({ type: 'ANSWER_CALL', callId, localStream: stream });
    });

    mediaActor.on('media.permission.denied', () => {
      peerActor.send({ type: 'REJECT_CALL', callId });
    });
  }
});
```

### Media track management (outside the machines)

Track state is owned by the application — the machines do not hold `localStream`.

```typescript
const muteAudio   = (s: MediaStream) => s.getAudioTracks().forEach(t => (t.enabled = false));
const unmuteAudio = (s: MediaStream) => s.getAudioTracks().forEach(t => (t.enabled = true));
const disableCam  = (s: MediaStream) => s.getVideoTracks().forEach(t => (t.enabled = false));
const enableCam   = (s: MediaStream) => s.getVideoTracks().forEach(t => (t.enabled = true));

// Remote audio is muted on the element, not the stream
remoteAudio.muted = true;

// Speaker routing (Chrome only)
await remoteAudio.setSinkId(deviceId);
```

### Inspecting state

```typescript
// peerMachine
const peerSnap = peerActor.getSnapshot();
peerSnap.value;                  // e.g. { alive: 'ready' }
peerSnap.context.peerId;         // string | null
peerSnap.context.connections;    // Record<connectionId, ActorRef>
peerSnap.context.calls;          // Record<callId, ActorRef>
peerSnap.context.lastError;      // PeerError | null
peerSnap.matches({ alive: 'ready' });

// mediaDeviceMachine
const mediaSnap = mediaActor.getSnapshot();
mediaSnap.value;                 // 'idle' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'
mediaSnap.context.stream;        // MediaStream | null
mediaSnap.context.devices;       // MediaDeviceInfo[]
mediaSnap.context.mode;          // 'user' | 'screen'
mediaSnap.context.lastError;     // Error | null
mediaSnap.matches('active');
```

### Teardown

```typescript
peerActor.send({ type: 'DESTROY' });
peerActor.stop();

mediaActor.send({ type: 'STOP' });
mediaActor.stop();
```

## What's not included

- **Reconnection back-off** — The `disconnected` state accepts `RECONNECT` immediately.
  Adding exponential back-off means an `after` delayed transition or a dedicated delay
  actor inside `disconnected`.
- **`RTCRtpSender.replaceTrack()` after device switch** — When switching devices
  mid-call, the application must call `replaceTrack` on the relevant sender to push
  the new track to the remote peer. PeerJS does not expose the `RTCPeerConnection`
  directly, so this cannot be handled inside the machines.
- **Room/lobby coordination** — Signaling who to connect to or call is out of scope.
  Use your own signaling server or a service like PeerServer on top of this library.
- **Multiple simultaneous calls** — `peerMachine` supports multiple concurrent
  `callMachine` actors, but `mediaDeviceMachine` manages a single stream. Mixing
  multiple local streams (e.g. camera + screen simultaneously) requires running
  two `mediaDeviceMachine` instances.