# PeerChat User Guide

A comprehensive guide to using PeerChat in your applications.

## Table of Contents

- [Introduction](#introduction)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Peer](#peer)
  - [Media](#media)
  - [Calls](#calls)
  - [Data Channels](#data-channels)
- [Simple API Reference](#simple-api-reference)
  - [Creating a Peer](#creating-a-peer)
  - [Creating Media](#creating-media)
  - [Making Calls](#making-calls)
  - [Handling Incoming Calls](#handling-incoming-calls)
  - [Call Hold / Resume](#call-hold--resume)
  - [Sending Messages](#sending-messages)
  - [Managing Media](#managing-media)
- [Advanced API Reference](#advanced-api-reference)
  - [State Machine Architecture](#state-machine-architecture)
  - [State Narrowing with `is()`](#state-narrowing-with-is)
  - [Peer States](#peer-states)
  - [Call States](#call-states)
  - [Connection States](#connection-states)
  - [Media States](#media-states)
- [Event Reference](#event-reference)
  - [Peer Events](#peer-events)
  - [Call Events](#call-events)
  - [Connection Events](#connection-events)
  - [Media Events](#media-events)
- [Common Patterns](#common-patterns)
  - [Video Call with Auto Answer](#video-call-with-auto-answer)
  - [Call Hold / Resume](#call-hold--resume-1)
  - [Multi-Call Selection](#multi-call-selection)
  - [Chat-Only with Data Channels](#chat-only-with-data-channels)
  - [Screen Sharing](#screen-sharing)
  - [Device Switching](#device-switching)
  - [Mute/Unmute](#muteunmute)
- [React Integration](#react-integration)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## Introduction

PeerChat is a library that simplifies WebRTC communication by wrapping [PeerJS](https://peerjs.com/) with a state-machine-driven API. It handles:

- **Video and audio calls** — initiate, answer, reject, and hang up
- **Data channels** — real-time messaging between peers
- **Media management** — camera/microphone access, device switching, screen sharing
- **State management** — predictable lifecycle management via discriminated union states
- **Reconnection** — automatic retry with exponential backoff

### Architecture at a Glance

```
┌───────────────────────┐
│ PeerManager (Facade)  │
│                       │
│ ┌───────────────────┐ │     ┌──────────────┐
│ │    PeerMachine    │ │────▶│ MediaMachine │
│ │ - peer lifecycle  │ │     │              │
│ └───────────────────┘ │     │ - stream     │
│ - calls (Manager)     │     │ - devices    │
│ - connections         │     │ - permissions│
│ - signaling         │ │     └──────────────┘
└───────────────────────┘
```

Each component is an independent state machine that can be used alone or combined.

---

## Installation

```bash
npm install peerchat peerjs
```

> **Note:** `peerjs` is a peer dependency. You must install it separately — this lets you control the PeerJS version and avoid duplicate instances.

### Browser Compatibility

PeerChat works in all modern browsers that support WebRTC:
- Chrome 74+
- Firefox 67+
- Safari 12.1+
- Edge 79+

---

## Quick Start

Get a peer-to-peer video call running in under 20 lines:

```ts
import { createPeer, createMedia, PeerEvents, CallEvents, MediaEvents } from 'peerchat';

// Create instances
const peer = createPeer();
const media = createMedia();

// Wire media to peer
peer.attachMedia(media);

// Wait for peer to be ready
peer.on(PeerEvents.READY, ({ peerId }) => {
  console.log('My ID:', peerId);
  // Share this ID with the person you want to call
});

// Handle incoming calls
peer.on(CallEvents.INCOMING, ({ callId }) => {
  peer.answer(callId); // Answer with attached media
});

// Make a call
peer.call('friend-peer-id');

// Display remote video
peer.on(CallEvents.ACTIVE, ({ remoteStream }) => {
  videoElement.srcObject = remoteStream;
});
```

---

## Core Concepts

### Peer

The **Peer** represents your connection to the PeerJS signaling server. Every peer has a unique ID and can:

- Connect to other peers
- Send and receive data messages
- Make and receive calls
- Manage multiple simultaneous calls and connections

### Media

The **Media** component handles local media streams. It manages:

- Camera and microphone access
- Screen sharing
- Device enumeration and switching
- Permission monitoring
- Audio/video mute toggling

### Calls

A **Call** is a WebRTC media connection between two peers. Calls have a lifecycle:

```
Incoming:  ringing ──answer──▶ connecting ──stream──▶ live ──hangup──▶ ended
Outgoing:              connecting ──stream──▶ live ──hangup──▶ ended

Hold/Resume:  live ──hold()──▶ held ──resume()──▶ live
Remote Hold:  live ──signal──▶ remoteHeld ──signal──▶ live
```

Each call has:
- A unique `callId`
- A `remotePeerId` — the other party
- A `direction` — `'inbound'` or `'outbound'`
- A state — `'ringing'`, `'connecting'`, `'live'`, `'held'`, `'remoteHeld'`, `'ended'`, or `'error'`

**Only one call can be `live` at a time.** When you answer a second call, the first is automatically put on hold. Outbound calls are blocked if a live call already exists. Multiple calls can be in `held` state simultaneously.

When the active call ends while calls remain on hold, PeerChat emits a `call.selectionRequired` event so the UI can present a call picker.

### Data Channels

**Data channels** provide reliable, ordered messaging between peers. Each connection has:

- A unique `connectionId`
- A `remotePeerId`
- A state — `'connecting'`, `'open'`, `'closed'`, or `'error'`

Multiple connections to the same peer are supported. Data channels are independent of calls — you can chat without calling.

---

## Simple API Reference

### Creating a Peer

```ts
import { createPeer } from 'peerchat';

// Auto-generated peer ID
const peer = createPeer();

// Custom peer ID
const peer = createPeer({ peerId: 'my-unique-id' });

// With custom PeerJS server
const peer = createPeer({
  peerJsOptions: {
    host: 'my-signaling-server.com',
    port: 443,
    secure: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:my-turn-server.com', username: 'user', credential: 'pass' },
      ],
    },
  },
  maxRetries: 5,        // Reconnection attempts
  baseRetryDelay: 1000, // Base delay for exponential backoff (ms)
});
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `peerId` | `string` | _auto-generated_ | Unique identifier for this peer |
| `peerJsOptions` | `Peer.Options` | `{}` | PeerJS constructor options |
| `logging` | `boolean` | `false` | Enable internal logging |
| `maxRetries` | `number` | `5` | Maximum reconnection attempts |
| `baseRetryDelay` | `number` | `1000` | Base delay (ms) for backoff |

### Creating Media

```ts
import { createMedia } from 'peerchat';

// Default: auto-check permissions
const media = createMedia();

// Manual permission handling
const media = createMedia({ autoPermissions: false });
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoPermissions` | `boolean` | `true` | Check permissions on creation |

### Making Calls

```ts
// Call using attached media (must call peer.attachMedia(media) first)
// Blocked if a live call already exists — hold or hang up first
peer.call('friend-id');

// Call with explicit stream
peer.call('friend-id', { stream: myStream });

// Call with media constraints (acquires media first)
peer.call('friend-id', { audio: true, video: true });

// Audio-only call
peer.call('friend-id', { audio: true, video: false });
```

#### `call(remotePeerId, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `remotePeerId` | `string` | The peer ID to call |
| `options` | `CallOptions` | Optional call configuration |

**CallOptions:**

```ts
interface CallOptions {
  stream?: MediaStream;   // Explicit stream (overrides attached media)
  audio?: boolean;        // Audio constraint (acquires media if no stream)
  video?: boolean;        // Video constraint (acquires media if no stream)
}
```

### Handling Incoming Calls

```ts
import { CallEvents } from 'peerchat';

// Listen for incoming calls
peer.on(CallEvents.INCOMING, ({ callId, remotePeerId }) => {
  console.log(`Incoming call from ${remotePeerId}`);

  // Answer with attached media
  peer.answer(callId);

  // Or with explicit stream
  // peer.answer(callId, { stream: myStream });

  // Or reject
  // peer.reject(callId);
});

// When call becomes active (remote stream available)
peer.on(CallEvents.ACTIVE, ({ callId, remotePeerId, remoteStream }) => {
  videoElement.srcObject = remoteStream;
});

// When call ends
peer.on(CallEvents.ENDED, ({ callId }) => {
  console.log('Call ended');
  videoElement.srcObject = null;
});

// Call errors
peer.on(CallEvents.ERROR, ({ callId, error }) => {
  console.error('Call error:', error);
});

// Call rejected by remote peer
peer.on(CallEvents.REJECTED, ({ callId, remotePeerId }) => {
  console.log(`${remotePeerId} rejected the call`);
});

// Call put on hold by remote peer
peer.on(CallEvents.REMOTE_HELD, ({ callId, remotePeerId }) => {
  console.log(`${remotePeerId} put you on hold`);
});

// Call resumed by remote peer
peer.on(CallEvents.REMOTE_RESUMED, ({ callId, remotePeerId }) => {
  console.log(`${remotePeerId} resumed the call`);
});
```

> **Note:** `answer()` automatically holds any currently live call before answering the new one.

#### `answer(callId, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `callId` | `string` | The incoming call ID |
| `options` | `AnswerOptions` | Optional answer configuration |

**AnswerOptions:**

```ts
interface AnswerOptions {
  stream?: MediaStream; // Explicit stream (overrides attached media)
}
```

#### `reject(callId)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `callId` | `string` | The incoming call ID to reject |

#### `hangUp(callId)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `callId` | `string` | The active call ID to hang up (`live`, `connecting`, `held`, or `remoteHeld`) |

### Call Hold / Resume

PeerChat enforces a **single active call** policy. Only one call can be in the `live` state at any time.

```ts
import { CallEvents } from 'peerchat';

// Put a live call on hold
peer.hold(callId);
// Disables media tracks on both sides, but keeps the WebRTC connection alive.
// The remote peer receives a 'call.remoteHeld' event.

// Resume a held call
peer.resume(callId);
// Re-enables media tracks. Any currently live call is auto-held first.
// The remote peer receives a 'call.remoteResumed' event.

// Listen for hold/resume events
peer.on(CallEvents.HELD, ({ callId, remotePeerId }) => {
  console.log(`Call ${callId} is now on hold`);
});

peer.on(CallEvents.RESUMED, ({ callId, remotePeerId }) => {
  console.log(`Call ${callId} is now live again`);
});

peer.on(CallEvents.REMOTE_HELD, ({ callId, remotePeerId }) => {
  console.log(`${remotePeerId} put you on hold`);
  // Your UI should show "On Hold" state. You cannot resume — only the remote peer can.
});

peer.on(CallEvents.REMOTE_RESUMED, ({ callId, remotePeerId }) => {
  console.log(`${remotePeerId} resumed the call`);
});
```

#### `hold(callId)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `callId` | `string` | The live call ID to put on hold |

Returns `true` if the call was held, `false` if not found or not in `live` state.

#### `resume(callId)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `callId` | `string` | The held call ID to resume |

Returns `true` if the call was resumed, `false` if not found or not in `held` state.

> **Important:** `resume()` automatically holds any currently live call before resuming the target call.

#### Multi-Call Selection

When the active call ends and one or more calls are still on hold, PeerChat emits a `call.selectionRequired` event. The UI should respond by showing a call picker.

```ts
import { CallEvents } from 'peerchat';

// Listen for selection required
peer.on(CallEvents.SELECTION_REQUIRED, ({ heldCallIds }) => {
  console.log('Pick a call to resume:', heldCallIds);
  // Show UI picker, then resume the user's choice
});

// You can also check the computed property at any time
if (peer.needsCallSelection) {
  const heldCalls = peer.getHeldCalls();
  // Render call picker with heldCalls
}
```

#### `needsCallSelection` (getter)

Returns `true` when there are held calls but no live call. Use this to conditionally render a call picker in your UI.

```ts
if (peer.needsCallSelection) {
  // Show call picker
}
```

#### `getHeldCalls()`

Returns an immutable snapshot of all calls in the `held` state.

```ts
const heldCalls = peer.getHeldCalls();
// → [{ callId, remotePeerId, state: 'held', direction }]
```

#### Automatic Hold Behavior

| Scenario | What Happens |
|---|---|
| Already in a live call, accept a new incoming call | The existing live call is auto-held |
| Already in a live call, try to make an outbound call | `call()` returns `false` (blocked) |
| Resume a held call while another call is live | The live call is auto-held, then the target is resumed |
| Hang up the active call with held calls remaining | `call.selectionRequired` event emitted |

### Sending Messages

```ts
import { ConnectionEvents } from 'peerchat';

// Send a message (auto-connects if needed)
peer.send('friend-id', { type: 'chat', text: 'Hello!' });

// Receive messages
peer.on(ConnectionEvents.DATA, ({ connectionId, remotePeerId, data }) => {
  console.log(`Message from ${remotePeerId}:`, data);
});

// Connection opened
peer.on(ConnectionEvents.OPENED, ({ connectionId, remotePeerId }) => {
  console.log(`Connected to ${remotePeerId}`);
});

// Connection closed
peer.on(ConnectionEvents.CLOSED, ({ connectionId }) => {
  console.log('Connection closed');
});
```

#### `send(remotePeerId, data)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `remotePeerId` | `string` | The peer ID to send to |
| `data` | `any` | Serializable data (objects, strings, etc.) |

> **Note:** `send()` auto-connects if no open connection exists. The connection is reused across calls.

### Managing Media

```ts
import { MediaEvents, MediaEvents } from 'peerchat';

// Attach media to peer
peer.attachMedia(media);

// Request camera and microphone
const state = media.getState();
if (state.is('idle')) {
  state.request({ audio: true, video: true });
}

// When media is ready
media.on(MediaEvents.STREAM_READY, ({ stream, mode }) => {
  console.log('Media ready, mode:', mode); // 'camera' or 'screen'
  previewElement.srcObject = stream;
});

// Screen sharing
media.getState(); // MediaActiveState or MediaIdleState
// If idle:
// media.getState().requestScreen({ video: { displaySurface: 'monitor' } });

// Stop media
media.getState(); // MediaActiveState
// media.getState().stop();

// Mute/unmute (when media is active)
const activeState = media.getState();
if (activeState.is('active')) {
  activeState.toggleAudio(); // Toggle microphone
  activeState.toggleVideo(); // Toggle video
}

// Switch devices
media.on(MediaEvents.DEVICES_UPDATED, ({ devices }) => {
  console.log('Available devices:', devices);
});

// Switch to specific camera
// media.getState().switchDevice('video', deviceId);

// Check permissions
media.on(MediaEvents.PERMISSION_STATUS, ({ permissions }) => {
  console.log('Camera:', permissions.camera);
  console.log('Microphone:', permissions.microphone);
});

// Handle permission denied
media.on(MediaEvents.PERMISSION_DENIED, () => {
  console.log('Permission denied');
  // Can retry with: media.getState().retry();
});

// Handle track ended (e.g., user unplugged camera)
media.on(MediaEvents.TRACK_ENDED, ({ kind }) => {
  console.log(`${kind} track ended`);
});

// Clean up
media.destroy();
```

#### Media Methods (on state objects after narrowing)

```ts
// From MediaIdleState (use state.is('idle') to narrow)
state.request(constraints: MediaStreamConstraints);
state.requestScreen(constraints?: MediaStreamConstraints);
state.checkPermissions();

// From MediaActiveState (use state.is('active') to narrow)
state.switchDevice(kind: 'audio' | 'video', deviceId: string);
state.stop();
state.toggleAudio();
state.toggleVideo();

// From MediaDeniedState (use state.is('denied') to narrow)
state.retry();
```

---

## Event Reference

All events are strongly typed. Use the exported constants to avoid typos.

### Peer Events

```ts
import { PeerEvents } from 'peerchat';
```

| Event | Constant | Payload | Description |
|-------|----------|---------|-------------|
| `peer.ready` | `PeerEvents.READY` | `{ peerId: string }` | Peer connected to signaling server |
| `peer.disconnected` | — | — | Peer disconnected from server |
| `peer.error` | `PeerEvents.ERROR` | `{ error: Error }` | Peer error occurred |

### Call Events

```ts
import { CallEvents } from 'peerchat';
```

| Event | Constant | Payload | Description |
|-------|----------|---------|-------------|
| `call.incoming` | `CallEvents.INCOMING` | `{ callId, remotePeerId }` | Incoming call received |
| `call.active` | `CallEvents.ACTIVE` | `{ callId, remotePeerId, remoteStream }` | Call is live with remote stream |
| `call.ended` | `CallEvents.ENDED` | `{ callId }` | Call ended |
| `call.error` | `CallEvents.ERROR` | `{ callId, error }` | Call error occurred |
| `call.rejected` | `CallEvents.REJECTED` | `{ callId, remotePeerId }` | Remote peer rejected (timeout) |
| `call.declined` | `CallEvents.DECLINED` | `{ callId, remotePeerId }` | Remote peer declined |
| `call.held` | `CallEvents.HELD` | `{ callId, remotePeerId }` | Local user put call on hold |
| `call.resumed` | `CallEvents.RESUMED` | `{ callId, remotePeerId }` | Local user resumed a held call |
| `call.remoteHeld` | `CallEvents.REMOTE_HELD` | `{ callId, remotePeerId }` | Remote peer put you on hold |
| `call.remoteResumed` | `CallEvents.REMOTE_RESUMED` | `{ callId, remotePeerId }` | Remote peer resumed the call |
| `call.selectionRequired` | `CallEvents.SELECTION_REQUIRED` | `{ heldCallIds }` | Active call ended, held calls remain — show picker |

### Connection Events

```ts
import { ConnectionEvents } from 'peerchat';
```

| Event | Constant | Payload | Description |
|-------|----------|---------|-------------|
| `connection.opened` | `ConnectionEvents.OPENED` | `{ connectionId, remotePeerId }` | Data channel opened |
| `connection.closed` | `ConnectionEvents.CLOSED` | `{ connectionId }` | Data channel closed |
| `connection.error` | `ConnectionEvents.ERROR` | `{ connectionId, error }` | Data channel error |
| `connection.data` | `ConnectionEvents.DATA` | `{ connectionId, remotePeerId, data }` | Message received |

### Media Events

```ts
import { MediaEvents } from 'peerchat';
```

| Event | Constant | Payload | Description |
|-------|----------|---------|-------------|
| `media.stream.ready` | `MediaEvents.STREAM_READY` | `{ stream, mode }` | Media stream acquired |
| `media.stream.stopped` | `MediaEvents.STREAM_STOPPED` | — | Media stream stopped |
| `media.stream.error` | `MediaEvents.STREAM_ERROR` | `{ error }` | Media error occurred |
| `media.permission.denied` | `MediaEvents.PERMISSION_DENIED` | — | Permission denied |
| `media.permission.status` | `MediaEvents.PERMISSION_STATUS` | `{ permissions }` | Permission status changed |
| `media.track.ended` | `MediaEvents.TRACK_ENDED` | `{ kind }` | Media track ended |
| `media.recovering` | `MediaEvents.RECOVERING` | — | Media recovering from track loss |
| `media.device.switched` | `MediaEvents.DEVICE_SWITCHED` | `{ kind, stream }` | Device switched successfully |
| `media.device.switch.failed` | `MediaEvents.DEVICE_SWITCH_FAILED` | `{ kind, error }` | Device switch failed |
| `media.devices.updated` | `MediaEvents.DEVICES_UPDATED` | `{ devices }` | Available devices changed |
| `media.audio.toggled` | `MediaEvents.AUDIO_TOGGLED` | `{ muted }` | Audio mute state changed |
| `media.video.toggled` | `MediaEvents.VIDEO_TOGGLED` | `{ muted }` | Video mute state changed |

---

## Common Patterns

### Video Call with Auto Answer

```ts
import { createPeer, createMedia, CallEvents, PeerEvents } from 'peerchat';

const peer = createPeer();
const media = createMedia();
peer.attachMedia(media);

// Auto-answer all incoming calls
peer.on(CallEvents.INCOMING, ({ callId }) => {
  peer.answer(callId);
});

peer.on(CallEvents.ACTIVE, ({ remoteStream }) => {
  videoElement.srcObject = remoteStream;
});

peer.on(CallEvents.ENDED, () => {
  videoElement.srcObject = null;
});
```

### Call Hold / Resume

```ts
import { createPeer, createMedia, CallEvents } from 'peerchat';

const peer = createPeer();
const media = createMedia();
peer.attachMedia(media);

// Accept a second call while on a live call — first call auto-held
peer.on(CallEvents.INCOMING, ({ callId }) => {
  peer.answer(callId); // Existing live call is automatically held
});

// Show held state in UI
peer.on(CallEvents.HELD, ({ callId }) => {
  console.log(`Call ${callId} is now on hold`);
  // Update UI to show held indicator
});

// Show when remote peer puts you on hold
peer.on(CallEvents.REMOTE_HELD, ({ callId, remotePeerId }) => {
  console.log(`${remotePeerId} put you on hold`);
  // Show "You are on hold" UI
});

peer.on(CallEvents.REMOTE_RESUMED, ({ callId }) => {
  console.log(`Call ${callId} resumed by remote`);
  // Remove "on hold" UI
});

// Manual hold/resume
function holdCall(callId: string) {
  peer.hold(callId);
}

function resumeCall(callId: string) {
  peer.resume(callId); // Any other live call is auto-held
}

// Switch between calls: resume call A (auto-holds call B)
function switchToCall(callId: string) {
  peer.resume(callId);
}
```

### Multi-Call Selection

Handle the scenario where the active call ends while multiple calls are on hold:

```ts
import { createPeer, createMedia, CallEvents } from 'peerchat';

const peer = createPeer();
const media = createMedia();
peer.attachMedia(media);

// Scenario: User has Call A (held), Call B (held), Call C (live)
// User hangs up Call C → need to pick between A and B

peer.on(CallEvents.SELECTION_REQUIRED, ({ heldCallIds }) => {
  console.log('Calls on hold:', heldCallIds);
  // Show a call picker UI to the user
  showCallPicker(heldCallIds);
});

// When user picks a call from the picker
function onUserPicksCall(callId: string) {
  peer.resume(callId); // Auto-holds any other live call
}

// Or check the property reactively (e.g., in React)
function renderCallUI() {
  if (peer.needsCallSelection) {
    const heldCalls = peer.getHeldCalls();
    // Render picker with heldCalls[].callId and heldCalls[].remotePeerId
  }
}
```

### Chat-Only with Data Channels

```ts
import { createPeer, ConnectionEvents, PeerEvents } from 'peerchat';

const peer = createPeer();

peer.on(PeerEvents.READY, ({ peerId }) => {
  console.log('My ID:', peerId);
});

// Send message
function sendMessage(toPeerId: string, message: string) {
  peer.send(toPeerId, { type: 'chat', text: message, timestamp: Date.now() });
}

// Receive messages
peer.on(ConnectionEvents.DATA, ({ remotePeerId, data }) => {
  if (data.type === 'chat') {
    console.log(`${remotePeerId}: ${data.text}`);
  }
});

// Connection status
peer.on(ConnectionEvents.OPENED, ({ remotePeerId }) => {
  console.log(`Connected to ${remotePeerId}`);
});

peer.on(ConnectionEvents.CLOSED, ({ remotePeerId }) => {
  console.log(`Disconnected from ${remotePeerId}`);
});
```

### Screen Sharing

```ts
import { createMedia, MediaEvents } from 'peerchat';

const media = createMedia();

// Request screen share
const state = media.getState();
if (state.is('idle') || state.is('active')) {
  state.requestScreen({ video: { displaySurface: 'monitor' } });
}

// Display screen share
media.on(MediaEvents.STREAM_READY, ({ stream, mode }) => {
  if (mode === 'screen') {
    videoElement.srcObject = stream;
  }
});

// Stop screen share and return to camera
media.on(MediaEvents.STREAM_STOPPED, () => {
  // Re-request camera
  const state = media.getState();
  if (state.is('idle')) {
    state.request({ audio: true, video: true });
  }
});
```

### Device Switching

```ts
import { createMedia, MediaEvents } from 'peerchat';

const media = createMedia({ autoPermissions: false });

// Request media first
const state = media.getState();
if (state.is('idle')) {
  state.request({ audio: true, video: true });
}

// Get available devices
media.on(MediaEvents.DEVICES_UPDATED, async ({ devices }) => {
  const videoDevices = devices.filter(d => d.kind === 'videoinput');
  console.log('Available cameras:', videoDevices);
});

// Switch to a different camera
media.on(MediaEvents.STREAM_READY, ({ stream }) => {
  // Later, when user wants to switch:
  const activeState = media.getState();
  if (activeState.is('active')) {
    // activeState.switchDevice('video', 'device-id-from-updated-list');
  }
});
```

### Mute/Unmute

```ts
// Toggle audio (microphone)
const state = media.getState();
if (state.is('active')) {
  state.toggleAudio();
}

// Toggle video (camera)
const state = media.getState();
if (state.is('active')) {
  state.toggleVideo();
}

// Listen for mute changes
media.on(MediaEvents.AUDIO_TOGGLED, ({ muted }) => {
  console.log('Microphone:', muted ? 'muted' : 'unmuted');
});

media.on(MediaEvents.VIDEO_TOGGLED, ({ muted }) => {
  console.log('Camera:', muted ? 'off' : 'on');
});
```

---

## Advanced API Reference

### State Machine Architecture

PeerChat uses a composable state machine architecture where every resource is a machine with typed, discriminated-union states. Each state has a `_tag` property that identifies its type:

```ts
import { PeerManager, MediaMachine } from 'peerchat';
import type { PeerState, MediaState } from 'peerchat';

// Get current state
const peerState = peer.getState();
const mediaState = media.getState();

// Check state type using _tag
if (peerState._tag === 'ready') {
  // TypeScript narrows to PeerReadyState
  console.log('Peer ID:', peerState.peerId);
}

if (mediaState._tag === 'active') {
  // TypeScript narrows to MediaActiveState
  mediaState.toggleAudio();
}
```

### State Narrowing with `is()`

Every state object provides a type-safe `is()` method for checking state types with automatic TypeScript type narrowing:

```ts
const state = peer.getState();

// Type-safe check with automatic type narrowing
if (state.is('initializing')) {
  // TypeScript narrows state to PeerInitializingState
  console.log('Peer is initializing...');
}

if (state.is('ready')) {
  // TypeScript narrows state to PeerReadyState
  state.connect('remote-peer-id');
  state.call('remote-peer-id', localStream);
}

if (state.is('disconnected')) {
  // TypeScript narrows state to PeerDisconnectedState
  console.log('Retry count:', state.retryCount);
}

if (state.is('error')) {
  // TypeScript narrows state to PeerErrorState
  console.error('Peer error:', state.lastError);
}

if (state.is('destroyed')) {
  // TypeScript narrows state to PeerDestroyedState
  console.log('Peer has been destroyed');
}
```

The `is()` method is available on all state types:
- **Peer states**: `'initializing'`, `'ready'`, `'disconnected'`, `'error'`, `'destroyed'`
- **Call states**: `'ringing'`, `'connecting'`, `'live'`, `'held'`, `'remoteHeld'`, `'ended'`, `'error'`
- **Connection states**: `'connecting'`, `'open'`, `'closed'`, `'error'`
- **Media states**: `'idle'`, `'checkingPermissions'`, `'requesting'`, `'active'`, `'switching'`, `'recovering'`, `'denied'`

**Benefits of `is()`:**
- ✅ Type-safe — only accepts valid state tags
- ✅ Auto-narrowing — TypeScript automatically narrows the type after the check
- ✅ IDE support — autocomplete and inline documentation
- ✅ No runtime overhead — simple string comparison

### Peer States

```ts
import type { PeerState } from 'peerchat';

type PeerState =
  | PeerInitializingState  // Waiting for PeerJS "open" event
  | PeerReadyState         // Connected, can make calls/connections
  | PeerDisconnectedState  // Lost connection to signaling server (auto-reconnecting)
  | PeerErrorState         // Fatal error occurred
  | PeerDestroyedState;    // Peer has been destroyed
```

#### PeerInitializingState (`_tag: 'initializing'`)

```ts
if (state.is('initializing')) {
  state.peer;        // PeerJS instance
  state.maxRetries;  // Maximum retry attempts
  state.baseRetryDelay; // Base delay for exponential backoff
}
```

#### PeerReadyState (`_tag: 'ready'`)

```ts
if (state.is('ready')) {
  state.peerId;           // Unique peer ID
}
```

#### PeerDisconnectedState (`_tag: 'disconnected'`)

```ts
if (state.is('disconnected')) {
  state.peerId;
  state.maxRetries;
  state.baseRetryDelay;
  
  // Methods
  state.reconnect(); // Force reconnection
}
```

### Call States

```ts
import type { CallState } from 'peerchat';

type CallState =
  | CallRingingState     // Inbound call waiting for answer
  | CallConnectingState  // Call answered, waiting for stream
  | CallLiveState        // Call is active with remote stream
  | CallHeldState        // Call held by local user
  | CallRemoteHeldState  // Call held by remote peer
  | CallEndedState       // Call ended normally
  | CallErrorState;      // Call ended due to error
```

#### CallRingingState (`_tag: 'ringing'`)

```ts
if (callState.is('ringing')) {
  callState.callId;
  callState.remotePeerId;
  callState.direction; // Always 'inbound'
  
  // Methods
  callState.answer(localStream);
  callState.reject();
}
```

#### CallConnectingState (`_tag: 'connecting'`)

```ts
if (callState.is('connecting')) {
  callState.callId;
  callState.remotePeerId;
  callState.direction; // 'inbound' or 'outbound'
  
  // Methods
  callState.hangUp();
}
```

#### CallLiveState (`_tag: 'live'`)

```ts
if (callState.is('live')) {
  callState.callId;
  callState.remotePeerId;
  callState.direction;
  callState.remoteStream; // MediaStream
  
  // Methods
  callState.hangUp();
  callState.hold();       // Put on hold → CallHeldState
  callState.remoteHeld(); // Remote initiated hold → CallRemoteHeldState (internal)
}
```

#### CallHeldState (`_tag: 'held'`)

The local user has put this call on hold. Media tracks are disabled but the WebRTC connection is alive.

```ts
if (callState.is('held')) {
  callState.callId;
  callState.remotePeerId;
  callState.direction;
  callState.remoteStream; // MediaStream (tracks disabled)
  
  // Methods
  callState.resume();  // Resume → CallLiveState
  callState.hangUp();  // End call → CallEndedState
}
```

#### CallRemoteHeldState (`_tag: 'remoteHeld'`)

The remote peer has put you on hold. Only the remote peer can resume.

```ts
if (callState.is('remoteHeld')) {
  callState.callId;
  callState.remotePeerId;
  callState.direction;
  callState.remoteStream; // MediaStream (tracks disabled)
  
  // Methods
  callState.remoteResumed(); // Remote resumed → CallLiveState (triggered by signal)
  callState.hangUp();        // End call → CallEndedState
}
```

### Connection States

```ts
import type { ConnectionState } from 'peerchat';

type ConnectionState =
  | ConnectionConnectingState // Waiting for data channel to open
  | ConnectionOpenState       // Data channel open, can send/receive
  | ConnectionClosedState     // Connection closed
  | ConnectionErrorState;     // Connection failed
```

#### ConnectionOpenState (`_tag: 'open'`)

```ts
if (connState.is('open')) {
  connState.connectionId;
  connState.remotePeerId;
  connState.connection; // PeerJS DataConnection
  
  // Methods
  connState.send(data);
  connState.close();
}
```

### Media States

```ts
import type { MediaState } from 'peerchat';

type MediaState =
  | MediaIdleState               // No active media
  | MediaCheckingPermissionsState // Checking browser permissions
  | MediaRequestingState         // Requesting media stream
  | MediaActiveState             // Stream active, can control
  | MediaSwitchingState          // Switching devices
  | MediaRecoveringState         // Recovering from track loss
  | MediaDeniedState;            // Permission denied
```

#### MediaIdleState (`_tag: 'idle'`)

```ts
if (state.is('idle')) {
  state.permissions; // { camera, microphone }
  
  // Methods
  state.request({ audio: true, video: true });
  state.requestScreen();
  state.checkPermissions();
}
```

#### MediaActiveState (`_tag: 'active'`)

```ts
if (state.is('active')) {
  state.stream;          // MediaStream
  state.mode;           // 'user' or 'screen'
  state.audioMuted;
  state.videoMuted;
  state.permissions;
  
  // Methods
  state.toggleAudio();
  state.toggleVideo();
  state.switchDevice('video', deviceId);
  state.stop();
}
```

#### MediaDeniedState (`_tag: 'denied'`)

```ts
if (state.is('denied')) {
  state.permissions;
  
  // Methods
  state.retry(); // Return to idle, allows retry
}
```

---

## React Integration

### Basic Pattern with `useSyncExternalStore`

```tsx
import { useRef, useEffect, useSyncExternalStore } from 'react';
import { createPeer, createMedia } from 'peerchat';
import type { PeerState } from 'peerchat';

function usePeerManager() {
  const peerRef = useRef<ReturnType<typeof createPeer>>();

  if (!peerRef.current) {
    peerRef.current = createPeer();
  }

  const { state } = useSyncExternalStore(
    (cb) => peerRef.current!.subscribe(cb).unsubscribe,
    () => peerRef.current!.getSnapshot(),
  );

  useEffect(() => () => peerRef.current?.destroy(), []);

  return { peer: peerRef.current!, state: state.state as PeerState };
}

function VideoCall() {
  const { peer, state } = usePeerManager();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Handle active calls using is() method
  if (state.is('ready')) {
    for (const [callId, coordinator] of state.calls) {
      const callState = coordinator.callMachine.getState();
      if (callState.is('live') && videoRef.current) {
        videoRef.current.srcObject = callState.remoteStream;
      }
    }
  }

  return <video ref={videoRef} autoPlay playsInline />;
}
```

### Force-Update Pattern (for Map mutations)

```tsx
import { useReducer, useEffect } from 'react';

function useMachineState<S>(machine: {
  subscribe: (cb: () => void) => { unsubscribe: () => void };
  getState: () => S;
}): S {
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);
  useEffect(() => machine.subscribe(forceUpdate).unsubscribe, [machine]);
  return machine.getState();
}

// Usage
function ChatApp() {
  const peer = useRef(createPeer()).current;
  const state = useMachineState(peer);

  // Re-renders on any state change using is()
  if (state.is('ready')) {
    return <div>Connected as {state.peerId}</div>;
  }

  return <div>Connecting...</div>;
}
```

### Full Example

A complete React application is available in [`example-react/`](./example-react/). To run it:

```bash
cd example-react
npm install
npm run dev
```

---

## Troubleshooting

### Common Issues

#### "Peer is not connected to the signaling server"

**Cause:** The peer hasn't completed initialization before you tried to use it.

**Fix:** Wait for the `READY` event:

```ts
peer.on(PeerEvents.READY, ({ peerId }) => {
  // Now safe to make calls
  peer.call('friend-id');
});
```

#### "Media permission denied"

**Cause:** User denied browser permission prompt, or permissions blocked.

**Fix:** Handle the denied state and offer retry:

```ts
media.on(MediaEvents.PERMISSION_DENIED, () => {
  // Inform user they need to enable permissions
  // In browser settings, or retry if they change their mind
  const state = media.getState();
  if (state.is('denied')) {
    // state.retry();
  }
});
```

#### "No remote video"

**Possible causes:**
1. Call not yet active — wait for `CallEvents.ACTIVE`
2. Remote peer didn't answer — check `CallEvents.REJECTED` or `CallEvents.DECLINED`
3. Stream not attached to video element — ensure `videoElement.srcObject = remoteStream`

**Debug steps:**
```ts
peer.on(CallEvents.ACTIVE, ({ callId, remoteStream }) => {
  console.log('Call active, stream:', remoteStream);
  console.log('Tracks:', remoteStream.getTracks());
  videoElement.srcObject = remoteStream;
});

peer.on(CallEvents.ERROR, ({ callId, error }) => {
  console.error('Call error:', error);
});
```

#### "Data channel not opening"

**Cause:** The remote peer may not be online, or connection failed.

**Fix:** Check connection state and error events:

```ts
peer.on(ConnectionEvents.OPENED, ({ connectionId, remotePeerId }) => {
  console.log(`Connected to ${remotePeerId}`);
});

peer.on(ConnectionEvents.ERROR, ({ connectionId, error }) => {
  console.error('Connection error:', error);
});

peer.on(ConnectionEvents.CLOSED, ({ connectionId }) => {
  console.log('Connection closed, may need to reconnect');
});
```

#### "Peer disconnected and not reconnecting"

**Cause:** Network issue or PeerJS server unavailable.

**Fix:** The library auto-reconnects by default. To customize:

```ts
const peer = createPeer({
  maxRetries: 10,        // More attempts
  baseRetryDelay: 500,   // Faster initial retries
});
```

### Debug Mode

Enable logging to see internal state transitions:

```ts
import { createPeer, setLogging } from 'peerchat';

setLogging(true);
const peer = createPeer();
```

### Browser DevTools

- **Chrome:** `chrome://webrtc-internals` — see all WebRTC connections
- **Firefox:** `about:webrtc` — similar diagnostics

---

## FAQ

### Do I need a signaling server?

PeerJS provides a free public signaling server by default. For production, you should run your own PeerServer:

```bash
npm install peer
npx peerjs --port 9000
```

Then configure PeerChat to use it:

```ts
const peer = createPeer({
  peerJsOptions: {
    host: 'your-server.com',
    port: 9000,
    secure: false,
  },
});
```

### How many simultaneous calls are supported?

PeerChat enforces a **single active call** policy — only one call can be in the `live` state at a time. However, you can have **multiple calls on hold simultaneously** in `held`, `remoteHeld`, `ringing`, or `connecting` states.

When you accept a second incoming call, the first is automatically put on hold. You can switch between held calls using `peer.resume(callId)`.

When the active call ends with held calls remaining, PeerChat emits `call.selectionRequired` so the UI can present a call picker. Use `peer.needsCallSelection` and `peer.getHeldCalls()` to query this state.

Practical limits for total concurrent connections depend on:
- **Browser** — Chrome supports ~256 concurrent WebRTC connections
- **Bandwidth** — each video call uses 1-4 Mbps
- **CPU** — encoding/decoding video is CPU-intensive

### Can I use PeerChat without PeerJS?

No. PeerChat is specifically a wrapper around PeerJS. If you need raw WebRTC without PeerJS, consider other libraries.

### Is PeerChat suitable for production?

PeerChat is designed for production use with features like:
- Automatic reconnection with exponential backoff
- State machine architecture preventing invalid states
- TypeScript for compile-time safety
- React integration via `useSyncExternalStore`

However, always test thoroughly for your specific use case.

### How does PeerChat handle NAT/firewalls?

PeerJS uses STUN/TURN servers for NAT traversal. By default, it uses Google's public STUN server. For enterprise deployments, configure your own TURN server:

```ts
const peer = createPeer({
  peerJsOptions: {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: 'turn:your-turn-server.com',
          username: 'user',
          credential: 'pass',
        },
      ],
    },
  },
});
```

### Can I use PeerChat with Vue, Svelte, or Angular?

Yes! The state machine API is framework-agnostic:

**Vue:**
```ts
import { ref, onMounted, onUnmounted } from 'vue';

export function usePeer() {
  const peer = createPeer();
  const state = ref(peer.getState());

  const sub = peer.subscribe(() => {
    state.value = peer.getState();
  });

  onUnmounted(() => {
    sub.unsubscribe();
    peer.destroy();
  });

  return { peer, state };
}
```

**Svelte:**
```ts
import { readable } from 'svelte/store';

export function createPeerStore() {
  const peer = createPeer();
  return readable(peer.getState(), (set) => {
    const sub = peer.subscribe(() => set(peer.getState()));
    return () => {
      sub.unsubscribe();
      peer.destroy();
    };
  });
}
```

### What's the difference between Simple and Advanced API?

| Feature | Simple API | Advanced API |
|---------|-----------|--------------|
| Entry point | `createPeer()` | `new PeerManager()` |
| Methods | `peer.call()`, `peer.send()` | State narrowing + method calls |
| State access | Query methods | Direct machine subscription |
| Use case | App development | Framework integrations |

**Use the Simple API unless you need fine-grained control.**

---

## Next Steps

- Read the [Developer Guide](./DEVELOPER_GUIDE.md) for architecture details and contribution guidelines
- Explore the [example React app](./example-react/) for a complete working demo
- Check the [API reference in README](./README.md) for detailed type definitions
