import type { Effect } from '../core/types';

// ── Value Types ───────────────────────────────────────────────────────────────

/**
 * Whether the stream was acquired from a camera/microphone (user) or
 * from screen/window/tab capture (screen).
 */
export type MediaMode = 'user' | 'screen';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export type PermissionStatus = {
  camera: PermissionState;
  microphone: PermissionState;
};

const DEFAULT_PERMISSIONS: PermissionStatus = {
  camera: 'unknown',
  microphone: 'unknown',
};

// ── Media State (Discriminated Union) ─────────────────────────────────────────

/**
 * Each variant carries exactly the data that exists in that state.
 * No nullable `stream` in `idle`, no `pendingSwitchKind` in `recovering`.
 */
export type MediaState =
  | MediaIdle
  | MediaCheckingPermissions
  | MediaRequesting
  | MediaActive
  | MediaSwitching
  | MediaRecovering
  | MediaDenied;

export type MediaIdle = {
  readonly _tag: 'idle';
  readonly permissions: PermissionStatus;
};

export type MediaCheckingPermissions = {
  readonly _tag: 'checkingPermissions';
  readonly permissions: PermissionStatus;
};

export type MediaRequesting = {
  readonly _tag: 'requesting';
  readonly mode: MediaMode;
  readonly constraints: MediaStreamConstraints;
  readonly screenConstraints: DisplayMediaStreamOptions;
  readonly permissions: PermissionStatus;
};

export type MediaActive = {
  readonly _tag: 'active';
  readonly stream: MediaStream;
  readonly devices: MediaDeviceInfo[];
  readonly mode: MediaMode;
  readonly constraints: MediaStreamConstraints;
  readonly permissions: PermissionStatus;
};

export type MediaSwitching = {
  readonly _tag: 'switching';
  readonly stream: MediaStream;
  readonly devices: MediaDeviceInfo[];
  readonly mode: MediaMode;
  readonly constraints: MediaStreamConstraints;
  readonly kind: 'audio' | 'video';
  readonly deviceId: string;
  readonly permissions: PermissionStatus;
};

export type MediaRecovering = {
  readonly _tag: 'recovering';
  readonly oldStream: MediaStream;
  readonly mode: MediaMode;
  readonly constraints: MediaStreamConstraints;
  readonly permissions: PermissionStatus;
};

export type MediaDenied = {
  readonly _tag: 'denied';
  readonly permissions: PermissionStatus;
};

// ── Events ────────────────────────────────────────────────────────────────────

/** Commands sent by external callers. */
export type MediaCommand =
  | { type: 'REQUEST'; constraints: MediaStreamConstraints }
  | { type: 'REQUEST_SCREEN'; constraints?: DisplayMediaStreamOptions }
  | { type: 'STOP' }
  | { type: 'SWITCH_DEVICE'; kind: 'audio' | 'video'; deviceId: string }
  | { type: 'RETRY' }
  | { type: 'CHECK_PERMISSIONS' };

/** Internal events from effect callbacks. */
export type MediaInternalEvent =
  | { type: 'ACQUIRE_DONE'; stream: MediaStream; devices: MediaDeviceInfo[] }
  | { type: 'ACQUIRE_ERROR'; error: unknown }
  | { type: 'SWITCH_DONE'; stream: MediaStream; kind: 'audio' | 'video' }
  | { type: 'SWITCH_ERROR'; error: unknown }
  | { type: 'TRACK_ENDED'; kind: 'audio' | 'video' }
  | { type: 'DEVICES_CHANGED'; devices: MediaDeviceInfo[] }
  | { type: 'PERMISSIONS_CHECKED'; permissions: PermissionStatus }
  | { type: 'PERMISSIONS_CHECK_ERROR' }
  | { type: 'PERMISSION_CHANGED'; permissions: PermissionStatus };

export type MediaEvent = MediaCommand | MediaInternalEvent;

// ── Emitted Events ────────────────────────────────────────────────────────────

/**
 * Observable events emitted by the media machine.
 * Subscribe via: machine.on('media.stream.ready', handler)
 */
export type MediaEmittedEvent =
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

// ── Effects ───────────────────────────────────────────────────────────────────

export type MediaEffect = Effect<MediaEvent>;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function initialMediaState(): MediaState {
  return { _tag: 'idle', permissions: DEFAULT_PERMISSIONS };
}

export const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const isPermissionDenied = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
