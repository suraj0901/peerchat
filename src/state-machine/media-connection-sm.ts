import { MediaConnection } from "peerjs";
import { StateMachine } from "./base-state-machine";
import { CallMediaManager } from "../media";
import { EventBindings } from "./event-bindings";

export type MediaConnectionState =
  | "connecting" // outgoing call or after answering
  | "incoming" // incoming call, not answered yet
  | "active"
  | "closing"
  | "closed"
  | "error";

export type MediaConnectionEvent =
  | "STREAM"
  | "CLOSE"
  | "ERROR"
  | "ANSWER"
  | "REJECT"
  | "LOCAL_CLOSE";

const mediaConnectionTransitions: Record<
  MediaConnectionState,
  Partial<Record<MediaConnectionEvent, MediaConnectionState>>
> = {
  connecting: { STREAM: "active", ERROR: "error", CLOSE: "closed" },
  incoming: {
    ANSWER: "connecting",
    REJECT: "closed",
    CLOSE: "closed",
    ERROR: "error",
  },
  active: { CLOSE: "closed", ERROR: "error", LOCAL_CLOSE: "closing" },
  closing: { CLOSE: "closed", ERROR: "error" },
  closed: {},
  error: { CLOSE: "closed" },
};

/**
 * Wraps a PeerJS MediaConnection instance.
 */
export class MediaConnectionStateMachine {
  public readonly stateMachine: StateMachine<
    MediaConnectionState,
    MediaConnectionEvent
  >;
  public remoteStream?: MediaStream;
  public readonly media: CallMediaManager;

  private readonly conn: MediaConnection;
  private readonly bindings = new EventBindings();

  get remotePeerId(): string {
    return this.conn.peer;
  }

  /**
   * @param conn - The MediaConnection instance.
   * @param initialStatus - For incoming calls, start as 'incoming'; otherwise 'connecting'.
   */
  constructor(
    conn: MediaConnection,
    initialStatus: "incoming" | "connecting" = "connecting",
  ) {
    this.conn = conn;
    this.media = new CallMediaManager(conn.localStream, conn.peerConnection);

    this.stateMachine = new StateMachine<
      MediaConnectionState,
      MediaConnectionEvent
    >(initialStatus, mediaConnectionTransitions);

    this.stateMachine.onStateChange((newState, oldState) => {
      console.debug(`${oldState} -> ${newState}`);
    })

    this.bindings.bind(conn, "stream", (stream: MediaStream) => {
      this.remoteStream = stream;
      console.debug("stream received, firing STREAM event", stream.getTracks().map(track => track.kind).toString());
      // PeerJS fires "stream" once per track (audio, video). Only the first
      // one should drive the connecting → active transition.
      if (this.stateMachine.canTransition("STREAM")) {
        this.stateMachine.transition("STREAM");
      }
    });
    this.bindings.bind(conn, "close", () => {
      this.stateMachine.transition("CLOSE");
      this.bindings.cleanup();
    });
    this.bindings.bind(conn, "error", (err: any) => {
      console.error("MediaConnection error:", err);
      this.stateMachine.transition("ERROR");
    });
  }

  /** Answer an incoming call (only valid in 'incoming' state). */
  answer(): void {
    if (this.stateMachine.currentState !== "incoming") {
      throw new Error(
        `Cannot answer while in state "${this.stateMachine.currentState}"`,
      );
    }
    this.stateMachine.transition("ANSWER");
    this.conn.answer(this.media.localMedia.getStream());
  }

  /** Reject an incoming call (only valid in 'incoming' state). */
  reject(): void {
    if (this.stateMachine.currentState !== "incoming") {
      throw new Error(
        `Cannot reject while in state "${this.stateMachine.currentState}"`,
      );
    }
    this.stateMachine.transition("REJECT");
    this.conn.close(); // Assuming close() rejects the call
  }

  /** Close the connection locally. */
  close(): void {
    const state = this.stateMachine.currentState;
    if (state === "closed" || state === "closing") return;
    if (!this.stateMachine.canTransition("LOCAL_CLOSE")) {
      throw new Error(`Cannot close while in state "${state}"`);
    }
    this.stateMachine.transition("LOCAL_CLOSE");
    this.conn.close();
  }
}
