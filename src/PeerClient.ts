import type { Peer, DataConnection, MediaConnection, PeerError } from "peerjs";
import { createActor, type Actor } from "xstate";
import {
  peerMachine,
  type PeerEmittedEvent,
  type PeerCommand,
} from "./machines";
import { MediaManager } from "./media";
import {
  getCameras,
  getMicrophones,
  getSpeakers,
  type Camera,
  type Microphone,
  type Speaker,
} from "./device";
import { GetUserMediaError } from "./errors";
import { ResultAsync } from "neverthrow";

type PeerClientEvents = {
  [K in PeerEmittedEvent["type"]]: (
    payload: Extract<PeerEmittedEvent, { type: K }>,
  ) => void;
};

export class PeerClient {
  private peer: Peer;
  private actor: Actor<typeof peerMachine>;
  public mediaManager: MediaManager | undefined;
  public localStream: MediaStream | undefined;

  constructor(peer: Peer) {
    this.peer = peer;
    this.actor = createActor(peerMachine, {
      input: {
        peer: this.peer,
      },
    });
    this.actor.start();
  }

  public on<T extends keyof PeerClientEvents>(
    eventType: T,
    listener: PeerClientEvents[T],
  ) {
    this.actor.on(eventType, listener);
  }

  private send(event: PeerCommand) {
    this.actor.send(event);
  }

  private setMediaManager(localStream: MediaStream) {
    const mediaConnection = this.actor.getSnapshot().context.calls;
    this.mediaManager = new MediaManager(
      localStream,
      () => this.getVideoSender(mediaConnection.peerConnection),
      () => this.getAudioSender(mediaConnection.peerConnection),
    );
  }

  public get peerId() {
    return this.peer.id;
  }

  public get state() {
    return this.actor.getSnapshot().value;
  }

  // TODO: Add media manager
  // constructor(peer: Peer, localStream: MediaStream) {
  //   ...
  //   this.mediaManager = new MediaManager(localStream, () => this.getVideoSender(), () => this.getAudioSender());
  // }

  private getVideoSender(peerConnection: RTCPeerConnection): RTCRtpSender | undefined {
    return peerConnection.getSenders()?.find(
      (s: RTCRtpSender) => s.track?.kind === "video"
    );
  }

  private getAudioSender(peerConnection: RTCPeerConnection): RTCRtpSender | undefined {
    return peerConnection.getSenders()?.find(
      (s: RTCRtpSender) => s.track?.kind === "audio"
    );
  }

  public connect(remotePeerId: string) {
    this.send({ type: "CONNECT_TO", remotePeerId });
  }

  public sendData(connectionId: string, data: unknown) {
    this.send({ type: "SEND", connectionId, data });
  }

  public closeConnection(connectionId: string) {
    this.send({ type: "CLOSE_CONNECTION", connectionId });
  }

  public call(
    remotePeerId: string,
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    return PeerClient.getLocalStream(constraints).map((localStream) => {
      this.localStream = localStream;
      this.send({ type: "CALL", remotePeerId, localStream });
    });
  }

  public answerCall(callId: string, constraints: MediaStreamConstraints = { audio: true, video: true }) {
    return PeerClient.getLocalStream(constraints).map((localStream) => {
      this.localStream = localStream;
      this.send({ type: "ANSWER_CALL", callId, localStream });
    });
  }

  public rejectCall(callId: string) {
    this.send({ type: "REJECT_CALL", callId });
  }

  public hangUp(callId: string) {
    this.send({ type: "HANG_UP", callId });
  }

  public reconnect() {
    this.send({ type: "RECONNECT" });
  }

  public destroy() {
    this.send({ type: "DESTROY" });
  }

  public static getMicrophones = getMicrophones;
  public static getCameras = getCameras;
  public static getSpeakers = getSpeakers;

  public static getLocalStream(constraints: MediaStreamConstraints) {
    return ResultAsync.fromPromise(
      navigator.mediaDevices.getUserMedia(constraints),
      (error) => new GetUserMediaError(error),
    );
  }
}
