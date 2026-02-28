export type PeerState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export type PeerEvent = "OPEN" | "DISCONNECTED" | "ERROR" | "CLOSE" | "RECONNECT";
