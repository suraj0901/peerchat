# PeerChat

A high-level, event-driven wrapper around [PeerJS](https://peerjs.com/) for video calls and data channels.

- 🔊 **Video & audio calls** with mute, camera toggle, screen share, and device switching
- 💬 **Data channels** for real-time messaging
- 🔄 **State machine-backed** connection lifecycle with typed events
- 📦 **Tiny API surface** — `PeerChat`, `Call`, `Channel` + device utilities
- ⚡ **ESM & CJS** — ships dual-format with full TypeScript declarations

## Install

```bash
npm install peerchat peerjs
```

> `peerjs` is a peer dependency — you bring your own version.

## Quick Start

```ts
import { PeerChat } from "peerchat";

const peer = new PeerChat("my-id");

peer.on("status", (s) => console.log("Peer:", s));

// ── Data channel ──
const channel = peer.connect("friend-id");
channel.on("status", (s) => {
  if (s === "open") channel.send("hello!");
});
channel.on("message", (data) => console.log("Got:", data));

// ── Video call ──
const result = await peer.call("friend-id");
if (result.isOk()) {
  const call = result.value;
  call.on("remoteStream", (stream) => {
    videoEl.srcObject = stream;
  });
}

// ── Incoming ──
peer.on("incomingCall", (call) => {
  call.answer();
  call.on("remoteStream", (stream) => { /* ... */ });
});

peer.on("incomingConnection", (channel) => {
  channel.on("message", (data) => console.log(data));
});
```

## API

### `PeerChat`

| Method / Property | Description |
|---|---|
| `new PeerChat(id?, options?)` | Create a peer. Options are passed through to PeerJS. |
| `peer.id` | The peer ID assigned by the signaling server |
| `peer.status` | `"connecting"` \| `"ready"` \| `"disconnected"` \| `"destroyed"` |
| `peer.call(remoteId, constraints?)` | Start a video/audio call → `ResultAsync<Call>` |
| `peer.connect(remoteId)` | Open a data channel → `Channel` |
| `peer.disconnect()` | Disconnect (allows reconnect) |
| `peer.reconnect()` | Reconnect after disconnect |
| `peer.destroy()` | Permanently tear down |

**Events:** `status`, `incomingCall`, `incomingConnection`, `error`

### `Call`

| Method / Property | Description |
|---|---|
| `call.status` | `"connecting"` \| `"ringing"` \| `"active"` \| `"ended"` |
| `call.answer(stream?)` | Answer an incoming call |
| `call.reject()` | Reject an incoming call |
| `call.hangup()` | End the call |
| `call.toggleMute()` / `mute()` / `unmute()` | Audio controls |
| `call.toggleCamera()` / `cameraOn()` / `cameraOff()` | Video controls |
| `call.switchCamera(deviceId)` | Switch camera device |
| `call.switchMicrophone(deviceId)` | Switch microphone device |
| `call.startScreenShare()` / `stopScreenShare()` | Screen sharing |

**Events:** `status`, `remoteStream`, `error`

### `Channel`

| Method / Property | Description |
|---|---|
| `channel.status` | `"connecting"` \| `"open"` \| `"closed"` |
| `channel.send(data)` | Send data to the remote peer |
| `channel.close()` | Close the channel |

**Events:** `status`, `message`, `error`

### Device Utilities

```ts
import { getMicrophones, getCameras, getSpeakers } from "peerchat";

const mics = await getMicrophones();    // ResultAsync<Microphone[]>
const cams = await getCameras();        // ResultAsync<Camera[]>
const spkrs = await getSpeakers();      // ResultAsync<Speaker[]>
```

## Example

A full working demo lives in [`example/`](./example). To run it:

```bash
cd example
npm install
npm run dev
```

Open two browser tabs at `http://localhost:3000`, copy one peer's ID into the other, connect, and chat or call.

## License

MIT
