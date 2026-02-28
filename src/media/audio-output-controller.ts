import { ResultAsync, errAsync } from "neverthrow";
import { MediaDeviceError, NotSupportSinkIdError } from "../errors";

export class AudioOutputController {

  changeAudioOutput(deviceId: string, audioElement: HTMLAudioElement) {
    if (typeof audioElement.setSinkId !== "function") {
      return errAsync(new NotSupportSinkIdError());
    }
    return ResultAsync.fromPromise(
      audioElement.setSinkId(deviceId),
      (error) => new MediaDeviceError(error),
    );
  }
}
