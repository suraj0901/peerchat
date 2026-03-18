import { createActor, createMachine, interpret } from "xstate";
import Peer, { type DataConnection, type MediaConnection } from "peerjs";
import { MediaAcquirer, MediaManager } from "../media";
import type { ChatMessage } from "./peerMachine.types";
import { peerActorMachine, peerMachine } from "./peerMachine";

interface PeerActorContext {
  peer: Peer | null;
  conn: DataConnection | null;
  mediaConn: MediaConnection | null;
  mediaManager: MediaManager | null;
  remoteStream: MediaStream | null;
  screenStream: MediaStream | null;
}


export class PeerActor {
  private actor: ReturnType<typeof createActor<typeof peerActorMachine>>;
  private _snapshot: PeerActorContext;
  private listeners: Set<(context: PeerActorContext) => void> = new Set();

  constructor(private sendToParent: (event: any) => void) {
    this.actor = createActor(peerActorMachine).start();
    this._snapshot = this.actor.getSnapshot().context;

    this.actor.subscribe(() => {
      this._snapshot = this.actor.getSnapshot().context as PeerActorContext;
      this.notify();
    });
  }

  private notify() {
    this.listeners.forEach((l) => l(this._snapshot));
  }

  public subscribe(listener: (context: PeerActorContext) => void): () => void {
    this.listeners.add(listener);
    listener(this._snapshot);
    return () => this.listeners.delete(listener);
  }

  public send(event: PeerActorEvent) {
    this.actor.send(event);
    this.handleEffect(event);
  }

  private handleEffect(event: PeerActorEvent) {
    switch (event.type) {
      case "CREATE_PEER": {
        const peer = event.id
          ? new Peer(event.id, event.options)
          : event.options
          ? new Peer(event.options)
          : new Peer();

        peer.on("open", (peerId) => this.sendToParent({ type: "PEER_OPEN", peerId }));
        peer.on("error", (err) =>
          this.sendToParent({ type: "PEER_ERROR", error: err.message || "Peer error" })
        );
        peer.on("connection", (incomingConn) => {
          this.sendToParent({ type: "INCOMING_CONNECTION", remotePeerId: incomingConn.peer });
          this.setupConnectionListeners(incomingConn);
        });
        peer.on("call", (incomingCall) => {
          this.sendToParent({ type: "INCOMING_CALL", remotePeerId: incomingCall.peer });
          this.setupMediaListeners(incomingCall);
        });

        this.send({ type: "peer", peer });
        break;
      }

      case "DESTROY_PEER": {
        const peer = this._snapshot.peer;
        if (peer) {
          peer.destroy();
          this.send({ type: "peer", peer: null });
        }
        break;
      }

      case "CONNECT_TO_PEER": {
        const peer = this._snapshot.peer;
        if (!peer) return;
        const conn = peer.connect(event.remotePeerId);
        this.setupConnectionListeners(conn);
        break;
      }

      case "SEND_DATA": {
        const conn = this._snapshot.conn;
        if (!conn) return;
        conn.send({ text: event.message.text, sender: event.message.sender });
        break;
      }

      case "CLOSE_CONNECTION": {
        const conn = this._snapshot.conn;
        if (conn) {
          conn.close();
          this.send({ type: "conn_closed", conn: null });
        }
        break;
      }

      case "ACQUIRE_MEDIA": {
        MediaAcquirer.getUserMedia({ video: true, audio: true }).then((result) => {
          if (result.isOk()) {
            const stream = result.value;
            const mediaManager = new MediaManager(
              stream,
              () =>
                this._snapshot.mediaConn?.peerConnection?.getSenders()?.find(
                  (s: RTCRtpSender) => s.track?.kind === "video"
                ),
              () =>
                this._snapshot.mediaConn?.peerConnection?.getSenders()?.find(
                  (s: RTCRtpSender) => s.track?.kind === "audio"
                )
            );
            this.send({ type: "media", mediaManager, stream });
            this.sendToParent({ type: "MEDIA_ACQUIRED", stream });
          } else {
            this.sendToParent({
              type: "MEDIA_ERROR",
              error: (result.error.error as Error)?.message || "Could not access camera/mic",
            });
          }
        });
        break;
      }

      case "PLACE_CALL": {
        const peer = this._snapshot.peer;
        const mediaManager = this._snapshot.mediaManager;
        if (!peer || !mediaManager) return;
        const stream = mediaManager.getStream();
        const call = peer.call(event.remotePeerId, stream);
        this.setupMediaListeners(call);
        break;
      }

      case "ANSWER_CALL": {
        const mediaConn = this._snapshot.mediaConn;
        if (mediaConn) {
          mediaConn.answer(event.stream);
        }
        break;
      }

      case "STOP_MEDIA": {
        const mediaManager = this._snapshot.mediaManager;
        if (mediaManager) {
          mediaManager.stop();
          this.send({ type: "media", mediaManager: null, stream: null as any });
        }
        this.send({ type: "remoteStream:cleared", remoteStream: null });
        break;
      }

      case "CLOSE_CALL": {
        const mediaConn = this._snapshot.mediaConn;
        if (mediaConn) {
          mediaConn.close();
          this.send({ type: "mediaConn", mediaConn: null });
        }
        break;
      }

      case "FX_MUTE_AUDIO": {
        this._snapshot.mediaManager?.mute();
        break;
      }

      case "FX_UNMUTE_AUDIO": {
        this._snapshot.mediaManager?.unmute();
        break;
      }

      case "FX_TURN_VIDEO_OFF": {
        this._snapshot.mediaManager?.cameraOff();
        break;
      }

      case "FX_TURN_VIDEO_ON": {
        this._snapshot.mediaManager?.cameraOn();
        break;
      }

      case "FX_REQUEST_SCREEN_SHARE": {
        const mediaManager = this._snapshot.mediaManager;
        if (!mediaManager) return;
        mediaManager.startScreenShare().then((result) => {
          if (result.isOk()) {
            this.sendToParent({ type: "SCREEN_SHARE_STARTED" });
            const screenTrack = mediaManager.getStream().getVideoTracks()[0];
            if (screenTrack) {
              screenTrack.addEventListener("ended", () =>
                this.sendToParent({ type: "STOP_SCREEN_SHARE" })
              );
            }
          } else {
            this.sendToParent({
              type: "SCREEN_SHARE_ERROR",
              error: (result.error as Error)?.message || "Screen share failed",
            });
          }
        });
        break;
      }

      case "FX_STOP_SCREEN_SHARE": {
        this._snapshot.mediaManager?.stopScreenShare();
        break;
      }
    }
  }

  private setupConnectionListeners(conn: DataConnection) {
    this.send({ type: "conn", conn });

    conn.on("open", () => this.sendToParent({ type: "CONNECTION_OPEN" }));

    conn.on("data", (data) => {
      const msg = data as { text: string; sender: string };
      this.sendToParent({ type: "RECEIVE_MESSAGE", text: msg.text, sender: "remote" });
    });

    conn.on("error", (err) =>
      this.sendToParent({ type: "CONNECTION_ERROR", error: err.message || "Connection error" })
    );

    conn.on("close", () => {
      this.send({ type: "conn_closed", conn: null });
      this.sendToParent({ type: "CONNECTION_CLOSED" });
    });
  }

  private setupMediaListeners(call: MediaConnection) {
    this.send({ type: "mediaConn", mediaConn: call });

    call.on("stream", (remoteStream) => {
      this.send({ type: "remoteStream:set", remoteStream });
      this.sendToParent({ type: "CALL_ANSWERED", remoteStream });
    });

    call.on("close", () => {
      this.send({ type: "mediaConn", mediaConn: null });
      this.send({ type: "remoteStream:cleared", remoteStream: null });
      this.sendToParent({ type: "CALL_CLOSED" });
    });

    call.on("error", (err) =>
      this.sendToParent({ type: "CALL_ERROR", error: err.message || "Media call error" })
    );
  }

  public getSnapshot() {
    return this._snapshot;
  }

  public cleanup() {
    const peer = this._snapshot.peer;
    if (peer) peer.destroy();

    const mediaManager = this._snapshot.mediaManager;
    if (mediaManager) mediaManager.stop();

    const screenStream = this._snapshot.screenStream;
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
    }
  }
}
