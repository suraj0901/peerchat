import { errAsync, ResultAsync } from "neverthrow";
import { MediaAcquirer } from "./media-acquirer";
import { GetDisplayMediaError, GetUserMediaError } from "../errors";
import type { LocalMedia } from "./local-media";

export class ScreenShareController {
  private originalVideoTrack: MediaStreamTrack | null = null;
  constructor(
    private localMedia: LocalMedia,
    private getVideoSender: () => RTCRtpSender | undefined,
  ) {}

  startScreenShare(
    displayConstraints: DisplayMediaStreamOptions = { video: true },
  ) {
    const videoSender = this.getVideoSender();
    if (!videoSender) {
      return errAsync(new Error("No video sender found"));
    }

    // Store current camera track
    const currentTrack = videoSender.track;
    if (currentTrack?.kind === "video") {
      this.originalVideoTrack = currentTrack;
    }

    return MediaAcquirer.getDisplayMedia(displayConstraints).andThen(
      (screenStream) => {
        const screenTrack = screenStream.getVideoTracks()[0];
        if (!screenTrack) {
          return errAsync(new Error("No video track in screen stream"));
        }

        // Set up auto-revert when screen sharing stops
        screenTrack.onended = () => {
          this.stopScreenShare();
        };

        return ResultAsync.fromPromise(
          videoSender.replaceTrack(screenTrack),
          (error) => new GetDisplayMediaError(error),
        ).map(() => {
          this.localMedia.replaceVideoTrack(screenTrack);
        });
      },
    );
  }

  stopScreenShare() {
    if (!this.originalVideoTrack) {
      return errAsync(new Error("No original camera track to revert to"));
    }

    const videoSender = this.getVideoSender();
    if (!videoSender) {
      return errAsync(new Error("No video sender found"));
    }

    // Revert to the original camera track
    return ResultAsync.fromPromise(
      videoSender.replaceTrack(this.originalVideoTrack),
      (error) => new GetUserMediaError(error),
    ).map(() => {
      // Update local stream back to camera
      this.localMedia.replaceVideoTrack(this.originalVideoTrack!);
      this.originalVideoTrack = null; // clear stored track
    });
  }
}
