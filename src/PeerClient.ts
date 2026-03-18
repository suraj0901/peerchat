import { createActor } from "xstate";
import {
  createPeerMachine,
} from "./machines/peerMachine";
import type {
  PeerContext,
  PeerRootState,
  ConnState,
  MediaState,
  AudioState,
  VideoState,
  ScreenShareState,
} from "./machines/peerMachine.types";
import { PeerActor } from "./machines/PeerActor";

export type MediaDeviceSnapshot = {
  audio: AudioState;
  video: VideoState;
  screenShare: ScreenShareState;
  screenShareContext: { error?: string };
};

export type ClientSnapshot = {
  peer: { state: PeerRootState; context: PeerContext };
  conn: { state: ConnState };
  media: { state: MediaState };
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
  private actor: ReturnType<typeof createActor<ReturnType<typeof createPeerMachine>>>;
  private peerActor: PeerActor;

  private listeners: Set<Listener> = new Set();
  private currentSnapshot: ClientSnapshot;

  constructor(id?: string, options?: any) {
    this.peerActor = new PeerActor((event) => {
      this.actor.send(event);
    });

    const machine = createPeerMachine(this.peerActor);
    this.actor = createActor(machine);

    this.currentSnapshot = this.computeSnapshot();

    this.actor.start();
    this.actor.subscribe(() => this.notify());

    this.actor.send({ type: "CONNECT" });
  }

  public getSnapshot = (): ClientSnapshot => this.currentSnapshot;

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    listener(this.currentSnapshot);
    return () => this.listeners.delete(listener);
  };

  public connect = () => this.actor.send({ type: "CONNECT" });
  public retryPeer = () => {
    if (this.actor.getSnapshot().matches("error")) {
      this.actor.send({ type: "CONNECT" });
    }
  };
  public destroyPeer = () => this.actor.send({ type: "DESTROY" });

  public connectPeer = (remotePeerId: string) =>
    this.actor.send({ type: "CONNECT_PEER", remotePeerId });
  public sendMessage = (text: string) =>
    this.actor.send({ type: "SEND_MESSAGE", text });
  public disconnect = () => this.actor.send({ type: "DISCONNECT" });

  public startCall = (remotePeerId: string) =>
    this.actor.send({ type: "START_CALL", remotePeerId });
  public acceptCall = () => this.actor.send({ type: "ACCEPT_CALL" });
  public declineCall = () => this.actor.send({ type: "DECLINE_CALL" });
  public hangUp = () => this.actor.send({ type: "HANG_UP" });

  public toggleAudio = () => this.actor.send({ type: "TOGGLE_AUDIO" });
  public toggleVideo = () => this.actor.send({ type: "TOGGLE_VIDEO" });
  public toggleScreenShare = () => this.actor.send({ type: "TOGGLE_SCREEN_SHARE" });

  public cleanup = () => {
    this.peerActor.cleanup();
    this.actor.stop();
  };

  private notify = () => {
    this.currentSnapshot = this.computeSnapshot();
    this.listeners.forEach((l) => l(this.currentSnapshot));
  };

  private computeSnapshot = (): ClientSnapshot => {
    const snap = this.actor.getSnapshot();
    const ctx = snap.context;

    const peerState: PeerRootState = snap.matches("ready")
      ? "ready"
      : snap.matches("error")
      ? "error"
      : "initializing";

    const connState: ConnState = snap.matches({ ready: { connection: "connected" } })
      ? "connected"
      : snap.matches({ ready: { connection: "connecting" } })
      ? "connecting"
      : "disconnected";

    const mediaState: MediaState = snap.matches({ ready: { media: "in_call" } })
      ? "in_call"
      : snap.matches({ ready: { media: "incoming_call" } })
      ? "incoming_call"
      : snap.matches({ ready: { media: "placing_call" } })
      ? "placing_call"
      : snap.matches({ ready: { media: "acquiring_media" } })
      ? "acquiring_media"
      : "idle";

    const audioState: AudioState = snap.matches({ ready: { media: { in_call: { audio: "muted" } } } })
      ? "muted"
      : "unmuted";

    const videoState: VideoState = snap.matches({ ready: { media: { in_call: { video: "off" } } } })
      ? "off"
      : "on";

    let screenShareState: ScreenShareState = "idle";
    if (snap.matches({ ready: { media: { in_call: { screenShare: "active" } } } })) {
      screenShareState = "active";
    } else if (snap.matches({ ready: { media: { in_call: { screenShare: "requesting" } } } })) {
      screenShareState = "requesting";
    }

    const actorSnapshot = this.peerActor.getSnapshot();

    const mediaDevice: MediaDeviceSnapshot = {
      audio: audioState,
      video: videoState,
      screenShare: screenShareState,
      screenShareContext: { error: ctx.screenShareError },
    };

    return {
      peer: { state: peerState, context: ctx },
      conn: { state: connState },
      media: { state: mediaState },
      localStream: actorSnapshot.mediaManager?.getStream() || null,
      remoteStream: actorSnapshot.remoteStream,
      screenStream: actorSnapshot.screenStream,
      mediaDevice,
      isAudioMuted: audioState === "muted",
      isVideoEnabled: videoState === "on",
      isScreenSharing: screenShareState !== "idle",
    };
  };
}
