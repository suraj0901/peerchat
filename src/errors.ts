
export class GetUserMediaError {
  constructor(public error: unknown) {}
}

export class GetDisplayMediaError {
  constructor(public error: unknown) {}
}

export class NotSupportSinkIdError {}
export class NoVideoTrackError {}
export class NoAudioTrackError {}
export class NoVideoSenderError {}
export class NoAudioSenderError {}

export class ReplaceTrackError {
  constructor(public error: unknown) {}
}
export class MediaDeviceError {
  constructor(public error: unknown) {}
}