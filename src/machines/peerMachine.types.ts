// ── Shared types ──────────────────────────────────────────────────────────────

export type ChatMessage = {
  text: string;
  sender: string;
  timestamp: number;
};

// ── Context ───────────────────────────────────────────────────────────────────

export type PeerContext = {
  // Peer
  peerId: string | null;
  peerError: string | null;

  // Connection (data channel)
  connRemotePeerId: string | null;
  messages: ChatMessage[];
  connError: string | null;

  // Media (call)
  mediaRemotePeerId: string | null;
  isOutgoing: boolean;
  mediaError: string | null;

  // Media device (mute/video/screen-share)
  screenShareError: string | undefined;
};

// ── Events ────────────────────────────────────────────────────────────────────

export type PeerEvent =
  // -- Peer lifecycle
  | { type: "CONNECT" }
  | { type: "PEER_OPEN"; peerId: string }
  | { type: "PEER_ERROR"; error: string }
  | { type: "DESTROY" }
  // -- Data connection
  | { type: "CONNECT_PEER"; remotePeerId: string }
  | { type: "INCOMING_CONNECTION"; remotePeerId: string }
  | { type: "CONNECTION_OPEN" }
  | { type: "SEND_MESSAGE"; text: string }
  | { type: "RECEIVE_MESSAGE"; text: string; sender: string }
  | { type: "CONNECTION_ERROR"; error: string }
  | { type: "CONNECTION_CLOSED" }
  | { type: "DISCONNECT" }
  // -- Media call
  | { type: "START_CALL"; remotePeerId: string }
  | { type: "MEDIA_ACQUIRED"; stream: MediaStream }
  | { type: "MEDIA_ERROR"; error: string }
  | { type: "INCOMING_CALL"; remotePeerId: string }
  | { type: "ACCEPT_CALL" }
  | { type: "DECLINE_CALL" }
  | { type: "CALL_ANSWERED"; remoteStream: MediaStream }
  | { type: "HANG_UP" }
  | { type: "CALL_CLOSED" }
  | { type: "CALL_ERROR"; error: string }
  // -- Media device controls (only meaningful while in_call)
  | { type: "TOGGLE_AUDIO" }
  | { type: "MUTE_AUDIO" }
  | { type: "UNMUTE_AUDIO" }
  | { type: "TOGGLE_VIDEO" }
  | { type: "TURN_VIDEO_ON" }
  | { type: "TURN_VIDEO_OFF" }
  | { type: "TOGGLE_SCREEN_SHARE" }
  | { type: "START_SCREEN_SHARE" }
  | { type: "SCREEN_SHARE_STARTED" }
  | { type: "STOP_SCREEN_SHARE" }
  | { type: "SCREEN_SHARE_ERROR"; error: string };

// ── Sub-state types ───────────────────────────────────────────────────────────

export type PeerRootState = "initializing" | "error" | "ready";
export type ConnState = "disconnected" | "connecting" | "connected";
export type MediaState =
  | "idle"
  | "acquiring_media"
  | "placing_call"
  | "incoming_call"
  | "in_call";
export type AudioState = "unmuted" | "muted";
export type VideoState = "on" | "off";
export type ScreenShareState = "idle" | "requesting" | "active";

// Snapshot of media device sub-states (only active during in_call)
export type MediaDeviceState = {
  audio: AudioState;
  video: VideoState;
  screenShare: ScreenShareState;
};
