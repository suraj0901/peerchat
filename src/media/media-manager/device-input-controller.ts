// device-input-controller.ts
import { errAsync, ResultAsync } from "neverthrow";
import {
  NoVideoSenderError,
  NoVideoTrackError,
  ReplaceTrackError,
} from "../../errors";
import { LocalMedia } from "./local-media";
import { MediaAcquirer } from "../media-acquirer";

export class DeviceInputController {
  constructor(
    private localMedia: LocalMedia,
    private getVideoSender: () => RTCRtpSender | undefined,
    private getAudioSender: () => RTCRtpSender | undefined,
  ) {}

  changeVideoInput(deviceId: string) {
    return MediaAcquirer.getUserMedia({
      video: { deviceId: { exact: deviceId } },
    }).andThen((newStream) => {
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) {
        return errAsync(new NoVideoTrackError());
      }

      const videoSender = this.getVideoSender();
      if (!videoSender) {
        return errAsync(new NoVideoSenderError());
      }

      // Replace track on the sender first
      return ResultAsync.fromPromise(
        videoSender.replaceTrack(newTrack),
        (error) => new ReplaceTrackError(error),
      ).map(() => {
        this.localMedia.replaceVideoTrack(newTrack);
      });
    });
  }

  changeAudioInput(deviceId: string) {
    return MediaAcquirer.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    }).andThen((newStream) => {
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) {
        return errAsync(new NoVideoTrackError());
      }

      const audioSender = this.getAudioSender();
      if (!audioSender) {
        return errAsync(new NoVideoSenderError());
      }

      return ResultAsync.fromPromise(
        audioSender.replaceTrack(newTrack),
        (error) => new ReplaceTrackError(error),
      ).map(() => {
        this.localMedia.replaceAudioTrack(newTrack);
      });
    });
  }
  
}
