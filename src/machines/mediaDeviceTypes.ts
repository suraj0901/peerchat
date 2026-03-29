/**
 * Whether the stream was acquired from a camera/microphone (user) or
 * from screen/window/tab capture (screen).
 * Drives initial sub-state and recovery behaviour: screen captures are never
 * recovered automatically — the user stopping the share is intentional.
 */
export type MediaMode = 'user' | 'screen';

/**
 * Represents the current state of a browser permission.
 *   granted  — permission has been explicitly granted.
 *   denied   — permission has been explicitly denied.
 *   prompt   — permission will trigger a user prompt.
 *   unknown  — permissions have not been checked yet (initial state).
 */
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export type PermissionStatus = {
  camera: PermissionState;
  microphone: PermissionState;
};

export type MediaDeviceContext = {
  stream: MediaStream | null;
  /** Constraints used for the most recent getUserMedia call. Reused during recovery. */
  constraints: MediaStreamConstraints;
  /** Constraints used for the most recent getDisplayMedia call. */
  screenConstraints: DisplayMediaStreamOptions;
  mode: MediaMode;
  /** Available input/output devices. Populated after stream acquisition and on devicechange. */
  devices: MediaDeviceInfo[];
  lastError: Error | null;
  /**
   * Stored when entering 'switching' so the onError handler can name the kind
   * that failed. Null at all other times.
   */
  pendingSwitchKind: 'audio' | 'video' | null;
  pendingSwitchDeviceId: string | null;
  /** Current permission status for camera and microphone. */
  permissions: PermissionStatus;
};

export type MediaDeviceInput = Record<string, never>;

/**
 * Internal events sourced from the browser — sent via sendBack in fromCallback actors.
 * Never sent directly by external callers.
 */
export type MediaDeviceCallbackEvent =
  | { type: 'TRACK_ENDED_INTERNAL'; kind: 'audio' | 'video' }
  | { type: 'DEVICES_ENUMERATED_INTERNAL'; devices: MediaDeviceInfo[] }
  | { type: 'PERMISSION_CHANGED_INTERNAL'; permissions: PermissionStatus };

/**
 * Commands sent into the machine by external callers.
 *
 *   REQUEST        — acquire camera/mic stream with given constraints.
 *   REQUEST_SCREEN — acquire display capture stream.
 *   STOP           — stop all tracks and return to idle. Safe to call in any state.
 *   SWITCH_DEVICE  — replace a single track in the active stream with one from a
 *                    different device. Only valid in user mode.
 */
export type MediaDeviceCommand =
  | { type: 'REQUEST'; constraints: MediaStreamConstraints }
  | { type: 'REQUEST_SCREEN'; constraints?: DisplayMediaStreamOptions }
  | { type: 'STOP' }
  | { type: 'SWITCH_DEVICE'; kind: 'audio' | 'video'; deviceId: string }
  | { type: 'RETRY' }
  | { type: 'CHECK_PERMISSIONS' };

export type MediaDeviceEvent = MediaDeviceCallbackEvent | MediaDeviceCommand;

/**
 * Observable events emitted by the machine.
 * Subscribe via: actor.on('media.stream.ready', handler)
 *
 *   media.stream.ready     — a new stream is available (also fires after recovery).
 *   media.stream.stopped   — stream was stopped cleanly (STOP command or screen share ended).
 *   media.stream.error     — acquisition failed for a non-permission reason.
 *   media.permission.denied — browser denied permission; final state, user must intervene.
 *   media.track.ended      — a track ended unexpectedly (user mode only). The machine
 *                            will attempt recovery and re-emit media.stream.ready.
 *   media.recovering       — recovery acquisition has started.
 *   media.device.switched  — track replaced in the stream; same stream reference returned.
 *   media.device.switch.failed — device switch failed; existing track is still active.
 *   media.devices.updated  — available device list has changed.
 */
export type MediaDeviceEmittedEvent =
  | { type: 'media.stream.ready'; stream: MediaStream; mode: MediaMode }
  | { type: 'media.stream.stopped' }
  | { type: 'media.stream.error'; error: Error }
  | { type: 'media.permission.denied' }
  | { type: 'media.track.ended'; kind: 'audio' | 'video' }
  | { type: 'media.recovering' }
  | { type: 'media.device.switched'; kind: 'audio' | 'video'; stream: MediaStream }
  | { type: 'media.device.switch.failed'; kind: 'audio' | 'video'; error: Error }
  | { type: 'media.devices.updated'; devices: MediaDeviceInfo[] }
  | { type: 'media.permission.status'; permissions: PermissionStatus };