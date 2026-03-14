// Public API
export { PeerClient } from "./PeerClient";
export type { ClientSnapshot, Listener } from "./PeerClient";

// Export machine typings for full typescript support downstream
export type { PeerState, PeerEvent, PeerContext } from "./machines/peerMachine";
export type { ConnState, ConnEvent, ConnContext, ChatMessage } from "./machines/connectionMachine";
export type { MediaState, MediaEvent, MediaContext } from "./machines/mediaMachine";

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
