import Peer, { type DataConnection, type MediaConnection } from "peerjs";
import { type Service, createService } from "nano-statechart";
import {
  peerMachine,
  type PeerState,
  type PeerEvent,
  type PeerContext,
} from "./machines/peerMachine";
import {
  connectionMachine,
  type ConnState,
  type ConnEvent,
  type ConnContext,
} from "./machines/connectionMachine";
import {
  mediaMachine,
  type MediaState,
  type MediaEvent,
  type MediaContext,
} from "./machines/mediaMachine";
import { MediaAcquirer, MediaManager } from "./media";
import { MediaDeviceService, type MediaDeviceSnapshot } from "./machines/mediaDeviceMachine";


export type ClientSnapshot = {
  peer: { state: PeerState; context: PeerContext };
  conn: { state: ConnState; context: ConnContext };
  media: { state: MediaState; context: MediaContext };
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  screenStream: MediaStream | null;
  mediaDevice: MediaDeviceSnapshot;
  isAudioMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
};

export type Listener = (snapshot: ClientSnapshot) => void;

export class PeerClient {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private mediaConn: MediaConnection | null = null;

  private mediaManager: MediaManager | null = null;
  private remoteStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  private peerService: Service<PeerState, PeerEvent, any, PeerContext>;
  private connService: Service<ConnState, ConnEvent, any, ConnContext>;
  private mediaService: Service<MediaState, MediaEvent, any, MediaContext>;
  private mediaDeviceService: MediaDeviceService;


  private listeners: Set<Listener> = new Set();
  private currentSnapshot: ClientSnapshot;

  constructor(id?: string, options?: any) {
    this.peerService = createService(peerMachine, (effect) =>
      this.handlePeerEffect(effect, id, options),
    );
    this.connService = createService(connectionMachine, this.handleConnEffect);
    this.mediaService = createService(mediaMachine, this.handleMediaEffect);
    this.mediaDeviceService = new MediaDeviceService(this.handleMediaDeviceEffect);

    this.currentSnapshot = this.computeSnapshot();

    this.peerService.subscribe(() => this.notify());
    this.connService.subscribe(() => this.notify());
    this.mediaService.subscribe(() => this.notify());
    this.mediaDeviceService.subscribe(() => this.notify());
  }


  public getSnapshot = (): ClientSnapshot => {
    return this.currentSnapshot;
  };

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify = () => {
    this.currentSnapshot = this.computeSnapshot();
    this.listeners.forEach((l) => l(this.currentSnapshot));
  };

  private computeSnapshot = (): ClientSnapshot => {
    return {
      peer: {
        state: this.peerService.getState() as PeerState,
        context: this.peerService.getContext(),
      },
      conn: {
        state: this.connService.getState() as ConnState,
        context: this.connService.getContext(),
      },
      media: {
        state: this.mediaService.getState() as MediaState,
        context: this.mediaService.getContext(),
      },
      localStream: this.mediaManager?.getStream() || null,
      remoteStream: this.remoteStream,
      screenStream: this.screenStream,
      mediaDevice: this.mediaDeviceService.getSnapshot(),
      isAudioMuted: this.mediaDeviceService.getSnapshot().audio === "muted",
      isVideoEnabled: this.mediaDeviceService.getSnapshot().video === "on",
      isScreenSharing: this.mediaDeviceService.getSnapshot().screenShare !== "idle",
    };

  };

  // ── Setup Connection Listeners ────────────────────────────────────────

  private setupConnectionListeners = (conn: DataConnection) => {
    this.conn = conn;

    conn.on("open", () => {
      this.connService.send({ type: "CONNECTION_OPEN" });
    });

    conn.on("data", (data) => {
      const msg = data as { text: string; sender: string };
      this.connService.send({
        type: "RECEIVE_MESSAGE",
        text: msg.text,
        sender: "remote",
      });
    });

    conn.on("error", (err) => {
      this.connService.send({
        type: "CONNECTION_ERROR",
        error: err.message || "Connection error",
      });
    });

    conn.on("close", () => {
      this.connService.send({ type: "CONNECTION_CLOSED" });
    });
  };

  // ── Setup Media Listeners ─────────────────────────────────────────────

  private setupMediaListeners = (call: MediaConnection) => {
    this.mediaConn = call;

    call.on("stream", (remoteStream) => {
      this.remoteStream = remoteStream;
      this.notify(); // Stream references changed
      this.mediaService.send({ type: "CALL_ANSWERED", remoteStream });
    });

    call.on("close", () => {
      this.mediaService.send({ type: "CALL_CLOSED" });
      this.remoteStream = null;
      this.notify();
    });

    call.on("error", (err) => {
      this.mediaService.send({
        type: "CALL_ERROR",
        error: err.message || "Media call error",
      });
    });
  };

  // ── Effect Handlers ───────────────────────────────────────────────────

  private handlePeerEffect = (effect: any, id?: string, options?: any) => {
    switch (effect.type) {
      case "CREATE_PEER": {
        const peer = id ? new Peer(id, options) : options ? new Peer(options) : new Peer();
        this.peer = peer;

        peer.on("open", (peerId) => {
          this.peerService.send({ type: "PEER_OPEN", peerId });
        });

        peer.on("error", (err) => {
          this.peerService.send({
            type: "PEER_ERROR",
            error: err.message || "Peer error",
          });
        });

        peer.on("connection", (incomingConn) => {
          this.connService.send({
            type: "INCOMING_CONNECTION",
            remotePeerId: incomingConn.peer,
          });
          this.setupConnectionListeners(incomingConn);
        });

        peer.on("call", (incomingCall) => {
          this.mediaService.send({
            type: "INCOMING_CALL",
            remotePeerId: incomingCall.peer,
          });
          this.setupMediaListeners(incomingCall);
        });
        break;
      }
      case "DESTROY_PEER": {
        if (this.peer) {
          this.peer.destroy();
          this.peer = null;
        }
        break;
      }
    }
  };

  private handleConnEffect = (effect: any) => {
    switch (effect.type) {
      case "CONNECT_TO_PEER": {
        const peer = this.peer;
        if (!peer) return;

        const remotePeerId = this.connService.getContext().remotePeerId;
        if (!remotePeerId) return;

        const conn = peer.connect(remotePeerId);
        this.setupConnectionListeners(conn);
        break;
      }
      case "SEND_DATA": {
        const conn = this.conn;
        if (!conn) return;

        const messages = this.connService.getContext().messages;
        const lastMsg = messages[messages.length - 1];
        if (lastMsg) {
          conn.send({ text: lastMsg.text, sender: lastMsg.sender });
        }
        break;
      }
      case "CLOSE_CONNECTION": {
        if (this.conn) {
          this.conn.close();
          this.conn = null;
        }
        break;
      }
    }
  };

  private handleMediaEffect = async (effect: any) => {
    switch (effect.type) {
      case "ACQUIRE_MEDIA": {
        const result = await MediaAcquirer.getUserMedia({
          video: true,
          audio: true,
        });

        if (result.isOk()) {
          const stream = result.value;
          this.mediaManager = new MediaManager(
            stream,
            () => (this.mediaConn as any)?.peerConnection?.getSenders()?.find((s: RTCRtpSender) => s.track?.kind === "video"),
            () => (this.mediaConn as any)?.peerConnection?.getSenders()?.find((s: RTCRtpSender) => s.track?.kind === "audio")
          );
          // Sync state machine if necessary (already initializes to defaults)
          this.mediaDeviceService.send({ type: "RESET_MEDIA" });
          this.mediaService.send({ type: "MEDIA_ACQUIRED", stream });
        } else {

          this.mediaService.send({
            type: "MEDIA_ERROR",
            error: (result.error.error as Error)?.message || "Could not access camera/mic",
          });
        }
        break;
      }
      case "PLACE_CALL": {
        // If we already have an incoming mediaConn, answer it instead of placing a new call
        if (this.mediaConn) {
          const stream = this.mediaManager?.getStream();
          if (stream) {
            this.mediaConn.answer(stream);
          }
          break;
        }
        const peer = this.peer;
        const stream = this.mediaManager?.getStream();
        if (!peer || !stream) return;

        const remotePeerId = this.mediaService.getContext().remotePeerId;
        if (!remotePeerId) return;

        const call = peer.call(remotePeerId, stream);
        this.setupMediaListeners(call);
        break;
      }
      case "ANSWER_CALL": {
        const call = this.mediaConn;
        const stream = this.mediaManager?.getStream();
        if (!call || !stream) return;

        call.answer(stream);
        break;
      }
      case "STOP_MEDIA": {
        if (this.mediaManager) {
          this.mediaManager.stop();
          this.mediaManager = null;
          this.mediaDeviceService.send({ type: "RESET_MEDIA" });
        }
        this.remoteStream = null;
        break;
      }
      case "CLOSE_CALL": {
        if (this.mediaConn) {
          this.mediaConn.close();
          this.mediaConn = null;
        }
        break;
      }
    }
  };

  // ── Actions ───────────────────────────────────────────────────────────

  public connect = () => {
    this.peerService.send({ type: "CONNECT" });
  };

  public connectPeer = (remotePeerId: string) => {
    this.connService.send({ type: "CONNECT_PEER", remotePeerId });
  };

  public sendMessage = (text: string) => {
    this.connService.send({ type: "SEND_MESSAGE", text });
  };

  public disconnect = () => {
    this.connService.send({ type: "DISCONNECT" });
  };

  public startCall = (remotePeerId: string) => {
    this.mediaService.send({ type: "START_CALL", remotePeerId });
  };

  public acceptCall = () => {
    this.mediaService.send({ type: "ACCEPT_CALL" });
  };

  public declineCall = () => {
    this.mediaService.send({ type: "DECLINE_CALL" });
  };

  public hangUp = () => {
    this.mediaService.send({ type: "HANG_UP" });
  };

  private handleMediaDeviceEffect = async (effect: any) => {
    if (!this.mediaManager) return;
    switch (effect.type) {
      case "FX_MUTE_AUDIO":
        this.mediaManager.mute();
        break;
      case "FX_UNMUTE_AUDIO":
        this.mediaManager.unmute();
        break;
      case "FX_TURN_VIDEO_OFF":
        this.mediaManager.cameraOff();
        break;
      case "FX_TURN_VIDEO_ON":
        this.mediaManager.cameraOn();
        break;
      case "FX_REQUEST_SCREEN_SHARE": {
        const result = await this.mediaManager.startScreenShare();
        if (result.isOk()) {
          this.mediaDeviceService.send({ type: "SCREEN_SHARE_STARTED" });
          const screenTrack = this.mediaManager.getStream().getVideoTracks()[0];
          if (screenTrack) {
            screenTrack.addEventListener("ended", () => {
              this.mediaDeviceService.send({ type: "STOP_SCREEN_SHARE" });
            });
          }
        } else {
          this.mediaDeviceService.send({
            type: "SCREEN_SHARE_ERROR",
            error: (result.error as Error)?.message || "Screen share failed",
          });
        }
        break;
      }
      case "FX_STOP_SCREEN_SHARE":
        this.mediaManager.stopScreenShare();
        break;
    }
  };

  public toggleAudio = () => {
    this.mediaDeviceService.send({ type: "TOGGLE_AUDIO" });
  };

  public toggleVideo = () => {
    this.mediaDeviceService.send({ type: "TOGGLE_VIDEO" });
  };

  public toggleScreenShare = async () => {
    this.mediaDeviceService.send({ type: "TOGGLE_SCREEN_SHARE" });
  };

  public retryPeer = () => {
    // There's no distinct RETRY event in the machine, we just use CONNECT
    if (this.peerService.getState() === "error") {
      this.peerService.send({ type: "CONNECT" });
    }
  };

  public destroyPeer = () => {
    this.peerService.send({ type: "DESTROY" });
  };

  public cleanup = () => {
    if (this.conn) this.conn.close();
    if (this.mediaConn) this.mediaConn.close();
    if (this.peer) this.peer.destroy();
    if (this.mediaManager) {
      this.mediaManager.stop();
      this.mediaManager = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
    }
  };
}
