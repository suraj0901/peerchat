// Public API

export { PeerClient } from './PeerClient';
export type { PeerClientState, Subscription } from './PeerClient';
export * from './errors';

// Export machine factory for full typescript support downstream
export * from "./machines"

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
