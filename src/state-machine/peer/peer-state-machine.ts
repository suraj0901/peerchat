import Peer, { PeerOptions } from "peerjs";
import {
    PeerClosed,
    PeerConnected,
    PeerConnecting,
    PeerDisconnected,
    PeerFailed,
    type PeerStateValue,
} from "./peer-states";
import { StateMachine } from "./base-state-machine";

export type PeerState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export type PeerEvent =
  | "OPEN"
  | "DISCONNECTED"
  | "ERROR"
  | "CLOSE"
  | "RECONNECT";

const peerTransitions: Record<
  PeerState,
  Partial<Record<PeerEvent, PeerState>>
> = {
  connecting: { OPEN: "connected", ERROR: "failed" },
  connected: { DISCONNECTED: "disconnected", ERROR: "failed", CLOSE: "closed" },
  disconnected: { RECONNECT: "connecting", ERROR: "failed", CLOSE: "closed" },
  failed: { CLOSE: "closed" },
  closed: {}, // no transitions
};

/**
 * Wraps a PeerJS Peer instance and manages its state.
 */
export class PeerStateMachine {
  public state: PeerStateValue;
  private readonly stateMachine: StateMachine<PeerState, PeerEvent>;
  private readonly peer: Peer; // Replace with actual Peer type from 'peerjs'
  private readonly eventListeners: Array<() => void> = [];

  constructor(option: PeerOptions) {
    this.peer = new Peer(option);
    this.setUpStateValue();
    this.stateMachine = new StateMachine<PeerState, PeerEvent>(
      "connecting",
      peerTransitions,
    );

    // Listen to PeerJS events
    const openHandler = () => this.stateMachine.transition("OPEN");

    const disconnectedHandler = () =>
      this.stateMachine.transition("DISCONNECTED");

    const errorHandler = (err: any) => {
      console.error("Peer error:", err);
      this.stateMachine.transition("ERROR");
    };
    const closeHandler = () => {
      this.cleanup();
      this.stateMachine.transition("CLOSE");
    };

    this.peer.on("open", openHandler);
    this.peer.on("disconnected", disconnectedHandler);
    this.peer.on("error", errorHandler);
    this.peer.on("close", closeHandler);

    // Store cleanup functions
    this.eventListeners.push(
      () => this.peer.off("open", openHandler),
      () => this.peer.off("disconnected", disconnectedHandler),
      () => this.peer.off("error", errorHandler),
      () => this.peer.off("close", closeHandler),
    );
  }

  private setUpStateValue() {
    this.stateMachine.onStateChange((newState) => {
      switch (newState) {
        case "connecting":
          this.state = new PeerConnecting();
          break;
        case "connected":
          this.state = new PeerConnected(this.peer);
          break;
        case "disconnected":
          this.state = new PeerDisconnected(this.peer, this.stateMachine);
          break;
        case "failed":
          this.state = new PeerFailed();
          break;
        case "closed":
          this.state = new PeerClosed();
          break;
      }
    });
  }

  /** Clean up event listeners (internal). */
  private cleanup(): void {
    this.eventListeners.forEach((unsub) => unsub());
    this.eventListeners.length = 0;
  }
}
