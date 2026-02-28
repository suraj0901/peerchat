import type Peer from "peerjs";
import type { StateMachine } from "../base-state-machine";
import { MediaConnectionStateMachine } from "../media-connection-sm";
import { DataConnectionStateMachine } from "../data-connection-sm";
import type { PeerEvent, PeerState } from "./types";

export type PeerStateValue =
  | PeerConnecting
  | PeerConnected
  | PeerDisconnected
  | PeerFailed
  | PeerClosed;

export class PeerConnecting {
  public readonly state = "connecting" as const;
}

export class PeerConnected {
  public readonly state = "connected" as const;

  constructor(private peer: Peer) {}

  get id() {
    return this.peer.id;
  }

  disconnect() {
    this.peer.disconnect();
  }

  destroy() {
    this.peer.destroy();
  }

  call(remotePeerId: string, localStream: MediaStream) {
    const call = this.peer.call(remotePeerId, localStream);
    return new MediaConnectionStateMachine(call);
  }

  connect(remotePeerId: string) {
    const conn = this.peer.connect(remotePeerId);
    return new DataConnectionStateMachine(conn);
  }

  onIncomingConnection(handler: (conn: DataConnectionStateMachine) => void) {
    this.peer.on("connection", (conn: any) => {
      const dataConn = new DataConnectionStateMachine(conn);
      handler(dataConn);
    });
  }

  onIncomingCall(handler: (call: MediaConnectionStateMachine) => void) {
    this.peer.on("call", (call: any) => {
      const mediaConn = new MediaConnectionStateMachine(call, "incoming");
      handler(mediaConn);
    });
  }
}

export class PeerDisconnected {
  public readonly state = "disconnected" as const;

  constructor(
    private peer: Peer,
    private state_machine: StateMachine<PeerState, PeerEvent>,
  ) {}

  reconnect() {
    this.state_machine.transition("RECONNECT");
    this.peer.reconnect();
  }

  destroy() {
    this.peer.destroy();
  }
}

export class PeerFailed {
  public readonly state = "failed" as const;
}

export class PeerClosed {
  public readonly state = "closed" as const;
}


// declare const peer:PeerStateValue