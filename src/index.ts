// Public API
export { PeerClient } from "./PeerClient";
export type { ClientSnapshot, Listener, MediaDeviceSnapshot } from "./PeerClient";

// Export machine factory for full typescript support downstream
export { createPeerMachine } from "./machines/peerMachine";
export { PeerActor } from "./machines/PeerActor";
export type {
  PeerContext,
  PeerEvent,
  PeerRootState,
  ConnState,
  MediaState,
  AudioState,
  VideoState,
  ScreenShareState,
  ChatMessage,
} from "./machines/peerMachine.types";

// Device utilities
export {
  getDevices,
  getMicrophones,
  getCameras,
  getSpeakers,
  MediaDeviceKind,
} from "./device";
export type {
  Microphone,
  Camera,
  Speaker,
  MicrophoneId,
  CameraId,
  SpeakerId,
} from "./device";
