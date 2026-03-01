import { MediaAcquirer } from "./media";
import {
  DataConnectionStateMachine,
  MediaConnectionStateMachine,
  type PeerStateMachine,
} from "./state-machine";
import { Option } from "./util";

export class CallManager {
  private currentCall: Option<MediaConnectionStateMachine>;
  private readonly peerStateMachine: PeerStateMachine;

  constructor(peerStateMachine: PeerStateMachine) {
    this.peerStateMachine = peerStateMachine;
    this.currentCall = Option.none;
  }

  call(
    remotePeerId: string,
    mediaConstraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    if (Option.isSome(this.currentCall)) {
      throw new Error(
        "Already in a call. End the current call before starting a new one.",
      );
    }
    return MediaAcquirer.getUserMedia(mediaConstraints).map((stream) => {
      const mediaConn = this.peerStateMachine.call(remotePeerId, stream);
      this.currentCall = Option.some(mediaConn);
      return mediaConn;
    });
  }

  onIncomingCall(handler: (call: MediaConnectionStateMachine) => void) {
    this.peerStateMachine.onIncomingCall((call) => {
      if (Option.isSome(this.currentCall)) {
        console.warn(
          "Received an incoming call while already in a call. Automatically rejecting the new call.",
        );
        call.reject();
        return;
      }

      return MediaAcquirer.getDisplayMedia({
        audio: true,
        video: true,
      }).map((stream) => {
        call.answer(stream);
        this.currentCall = Option.some(call);
        handler(call);
      });
    });
  }

  connect(remotePeerId: string) {
    return this.peerStateMachine.connect(remotePeerId);
  }

  onIncomingConnection(handler: (conn: DataConnectionStateMachine) => void) {
    this.peerStateMachine.onIncomingConnection(handler);
  }
}
