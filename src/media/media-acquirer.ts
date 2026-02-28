import { ResultAsync } from 'neverthrow';
import { GetUserMediaError, GetDisplayMediaError } from '../errors'; // define your error types

export class MediaAcquirer {
  static getUserMedia(constraints: MediaStreamConstraints) {
    return ResultAsync.fromPromise(
      navigator.mediaDevices.getUserMedia(constraints),
      error => new GetUserMediaError(error)
    );
  }

  static getDisplayMedia(constraints: DisplayMediaStreamOptions) {
    return ResultAsync.fromPromise(
      navigator.mediaDevices.getDisplayMedia(constraints),
      error => new GetDisplayMediaError(error)
    );
  }
}