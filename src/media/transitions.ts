import type {
  MediaState,
  MediaEvent,
  MediaEffect,
  MediaEmittedEvent,
} from './types';
import { isPermissionDenied, toError } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Shorthand to create an emit effect. */
const emit = (event: MediaEmittedEvent): MediaEffect =>
  ({ type: 'emit', event });

/** Shorthand to stop tracks on a stream. */
const stopTracks = (stream: MediaStream): MediaEffect =>
  ({ type: 'fireAndForget', execute: () => stream.getTracks().forEach(t => t.stop()) });

/** Effect: acquire a media stream (getUserMedia or getDisplayMedia). */
function acquireStreamEffect(
  mode: 'user' | 'screen',
  constraints: MediaStreamConstraints,
  screenConstraints: DisplayMediaStreamOptions,
): MediaEffect {
  return {
    type: 'runAsync',
    id: 'acquireStream',
    execute: async (signal) => {
      const stream =
        mode === 'screen'
          ? await navigator.mediaDevices.getDisplayMedia(screenConstraints)
          : await navigator.mediaDevices.getUserMedia(constraints);

      if (signal.aborted) {
        stream.getTracks().forEach(t => t.stop());
        throw new DOMException('Acquisition aborted', 'AbortError');
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      return { stream, devices };
    },
    onDone: (output) => {
      const { stream, devices } = output as { stream: MediaStream; devices: MediaDeviceInfo[] };
      return { type: 'ACQUIRE_DONE', stream, devices };
    },
    onError: (error) => ({ type: 'ACQUIRE_ERROR', error }),
  };
}

/** Effect: switch a track in the active stream. */
function switchDeviceEffect(
  stream: MediaStream,
  kind: 'audio' | 'video',
  deviceId: string,
): MediaEffect {
  return {
    type: 'runAsync',
    id: 'switchDevice',
    execute: async (signal) => {
      const constraints: MediaStreamConstraints =
        kind === 'audio'
          ? { audio: { deviceId: { exact: deviceId } } }
          : { video: { deviceId: { exact: deviceId } } };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack =
        kind === 'audio' ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];

      if (!newTrack) throw new Error(`No ${kind} track returned for deviceId "${deviceId}"`);

      if (signal.aborted) {
        newTrack.stop();
        throw new DOMException('Switch aborted', 'AbortError');
      }

      const oldTracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
      oldTracks.forEach(t => {
        stream.removeTrack(t);
        t.stop();
      });
      stream.addTrack(newTrack);

      return { stream, kind };
    },
    onDone: (output) => {
      const { stream, kind } = output as { stream: MediaStream; kind: 'audio' | 'video' };
      return { type: 'SWITCH_DONE', stream, kind };
    },
    onError: (error) => ({ type: 'SWITCH_ERROR', error }),
  };
}

/** Effect: start monitoring track ends + device changes on an active stream. */
function startStreamMonitor(stream: MediaStream): MediaEffect {
  return {
    type: 'startSubscription',
    id: 'streamMonitor',
    subscribe: (send) => {
      const handlers: Array<{ track: MediaStreamTrack; handler: () => void }> = [];

      const watchTrack = (track: MediaStreamTrack, kind: 'audio' | 'video') => {
        const handler = () => send({ type: 'TRACK_ENDED', kind });
        track.addEventListener('ended', handler);
        handlers.push({ track, handler });
      };

      stream.getAudioTracks().forEach(t => watchTrack(t, 'audio'));
      stream.getVideoTracks().forEach(t => watchTrack(t, 'video'));

      const handleDeviceChange = () => {
        void navigator.mediaDevices.enumerateDevices().then(devices =>
          send({ type: 'DEVICES_CHANGED', devices })
        );
      };
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

      return () => {
        handlers.forEach(({ track, handler }) => track.removeEventListener('ended', handler));
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      };
    },
  };
}

/** Effect: stop the stream monitor. */
const stopStreamMonitor: MediaEffect = { type: 'stopSubscription', id: 'streamMonitor' };

/** Effect: check permissions via the Permissions API. */
const checkPermissionsEffect: MediaEffect = {
  type: 'runAsync',
  id: 'checkPermissions',
  execute: async () => {
    if (!navigator.permissions?.query) {
      return { camera: 'unknown', microphone: 'unknown' };
    }
    const [cam, mic] = await Promise.all([
      navigator.permissions.query({ name: 'camera' as PermissionName }).catch(() => null),
      navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null),
    ]);
    return {
      camera: cam?.state ?? 'unknown',
      microphone: mic?.state ?? 'unknown',
    };
  },
  onDone: (output) => ({ type: 'PERMISSIONS_CHECKED', permissions: output as any }),
  onError: () => ({ type: 'PERMISSIONS_CHECK_ERROR' }),
};

/** Effect: start a long-lived permission monitor. */
const startPermissionMonitor: MediaEffect = {
  type: 'startSubscription',
  id: 'permissionMonitor',
  subscribe: (send) => {
    if (!navigator.permissions?.query) return () => {};

    let camStatus: PermissionStatus | null = null;
    let micStatus: PermissionStatus | null = null;

    const requery = () => {
      send({
        type: 'PERMISSION_CHANGED',
        permissions: {
          camera: (camStatus as any)?.state ?? 'unknown',
          microphone: (micStatus as any)?.state ?? 'unknown',
        },
      });
    };

    void (async () => {
      [camStatus, micStatus] = await Promise.all([
        navigator.permissions.query({ name: 'camera' as PermissionName }).catch(() => null),
        navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null),
      ]) as any;

      if (camStatus) (camStatus as any).onchange = requery;
      if (micStatus) (micStatus as any).onchange = requery;
    })();

    return () => {
      if (camStatus) (camStatus as any).onchange = null;
      if (micStatus) (micStatus as any).onchange = null;
    };
  },
};

// ── Transition Function ───────────────────────────────────────────────────────

/**
 * Pure transition function for the media device state machine.
 *
 * Given the current state and an event, returns the next state and a list of
 * effects to execute. No side effects — fully deterministic.
 */
export function transition(state: MediaState, event: MediaEvent): [MediaState, MediaEffect[]] {
  // ── Global events (handled in any state) ──────────────────────────────

  if (event.type === 'PERMISSION_CHANGED') {
    // Update permissions in whichever state we're in
    return [
      { ...state, permissions: event.permissions },
      [emit({ type: 'media.permission.status', permissions: event.permissions })],
    ];
  }

  // ── Per-state transitions ─────────────────────────────────────────────

  switch (state._tag) {
    case 'idle': {
      switch (event.type) {
        case 'REQUEST':
          return [
            { _tag: 'requesting', mode: 'user', constraints: event.constraints, screenConstraints: {}, permissions: state.permissions },
            [acquireStreamEffect('user', event.constraints, {})],
          ];

        case 'REQUEST_SCREEN':
          return [
            { _tag: 'requesting', mode: 'screen', constraints: { audio: true, video: true }, screenConstraints: event.constraints ?? {}, permissions: state.permissions },
            [acquireStreamEffect('screen', { audio: true, video: true }, event.constraints ?? {})],
          ];

        case 'CHECK_PERMISSIONS':
          return [
            { _tag: 'checkingPermissions', permissions: state.permissions },
            [checkPermissionsEffect],
          ];

        default:
          return [state, []];
      }
    }

    case 'checkingPermissions': {
      switch (event.type) {
        case 'PERMISSIONS_CHECKED':
          return [
            { _tag: 'idle', permissions: event.permissions },
            [emit({ type: 'media.permission.status', permissions: event.permissions })],
          ];

        case 'PERMISSIONS_CHECK_ERROR':
          return [{ _tag: 'idle', permissions: state.permissions }, []];

        default:
          return [state, []];
      }
    }

    case 'requesting': {
      switch (event.type) {
        case 'ACQUIRE_DONE':
          return [
            { _tag: 'active', stream: event.stream, devices: event.devices, mode: state.mode, constraints: state.constraints, permissions: state.permissions },
            [
              startStreamMonitor(event.stream),
              emit({ type: 'media.stream.ready', stream: event.stream, mode: state.mode }),
            ],
          ];

        case 'ACQUIRE_ERROR':
          if (isPermissionDenied(event.error)) {
            return [
              { _tag: 'denied', permissions: state.permissions },
              [emit({ type: 'media.permission.denied' })],
            ];
          }
          return [
            { _tag: 'idle', permissions: state.permissions },
            [emit({ type: 'media.stream.error', error: toError(event.error) })],
          ];

        case 'STOP':
          // The runAsync effect's abort signal handles cleanup of in-flight getUserMedia
          return [{ _tag: 'idle', permissions: state.permissions }, []];

        default:
          return [state, []];
      }
    }

    case 'active': {
      switch (event.type) {
        case 'TRACK_ENDED':
          if (state.mode === 'user') {
            // User mode — unexpected track end, attempt recovery
            return [
              { _tag: 'recovering', oldStream: state.stream, mode: state.mode, constraints: state.constraints, permissions: state.permissions },
              [
                stopStreamMonitor,
                emit({ type: 'media.track.ended', kind: event.kind }),
                emit({ type: 'media.recovering' }),
                acquireStreamEffect(state.mode, state.constraints, {}),
              ],
            ];
          }
          // Screen mode — user intentionally stopped sharing
          return [
            { _tag: 'idle', permissions: state.permissions },
            [
              stopStreamMonitor,
              stopTracks(state.stream),
              emit({ type: 'media.stream.stopped' }),
            ],
          ];

        case 'DEVICES_CHANGED':
          return [
            { ...state, devices: event.devices },
            [emit({ type: 'media.devices.updated', devices: event.devices })],
          ];

        case 'SWITCH_DEVICE':
          if (state.mode !== 'user') return [state, []];
          return [
            { _tag: 'switching', stream: state.stream, devices: state.devices, mode: state.mode, constraints: state.constraints, kind: event.kind, deviceId: event.deviceId, permissions: state.permissions },
            [
              stopStreamMonitor,
              switchDeviceEffect(state.stream, event.kind, event.deviceId),
            ],
          ];

        case 'STOP':
          return [
            { _tag: 'idle', permissions: state.permissions },
            [
              stopStreamMonitor,
              stopTracks(state.stream),
              emit({ type: 'media.stream.stopped' }),
            ],
          ];

        default:
          return [state, []];
      }
    }

    case 'switching': {
      switch (event.type) {
        case 'SWITCH_DONE':
          return [
            { _tag: 'active', stream: event.stream, devices: state.devices, mode: state.mode, constraints: state.constraints, permissions: state.permissions },
            [
              startStreamMonitor(event.stream),
              emit({ type: 'media.device.switched', kind: event.kind, stream: event.stream }),
            ],
          ];

        case 'SWITCH_ERROR':
          // Failed — return to active with existing track still running
          return [
            { _tag: 'active', stream: state.stream, devices: state.devices, mode: state.mode, constraints: state.constraints, permissions: state.permissions },
            [
              startStreamMonitor(state.stream),
              emit({ type: 'media.device.switch.failed', kind: state.kind, error: toError(event.error) }),
            ],
          ];

        case 'STOP':
          return [
            { _tag: 'idle', permissions: state.permissions },
            [
              stopTracks(state.stream),
              emit({ type: 'media.stream.stopped' }),
            ],
          ];

        default:
          return [state, []];
      }
    }

    case 'recovering': {
      switch (event.type) {
        case 'ACQUIRE_DONE':
          return [
            { _tag: 'active', stream: event.stream, devices: event.devices, mode: state.mode, constraints: state.constraints, permissions: state.permissions },
            [
              stopTracks(state.oldStream),
              startStreamMonitor(event.stream),
              emit({ type: 'media.stream.ready', stream: event.stream, mode: state.mode }),
            ],
          ];

        case 'ACQUIRE_ERROR':
          if (isPermissionDenied(event.error)) {
            return [
              { _tag: 'denied', permissions: state.permissions },
              [
                stopTracks(state.oldStream),
                emit({ type: 'media.permission.denied' }),
              ],
            ];
          }
          return [
            { _tag: 'idle', permissions: state.permissions },
            [
              stopTracks(state.oldStream),
              emit({ type: 'media.stream.error', error: toError(event.error) }),
            ],
          ];

        case 'STOP':
          return [
            { _tag: 'idle', permissions: state.permissions },
            [
              stopTracks(state.oldStream),
              emit({ type: 'media.stream.stopped' }),
            ],
          ];

        default:
          return [state, []];
      }
    }

    case 'denied': {
      if (event.type === 'RETRY') {
        return [{ _tag: 'idle', permissions: state.permissions }, []];
      }
      return [state, []];
    }
  }
}

/**
 * Returns the list of effects to execute on machine startup
 * (the permission monitor subscription).
 */
export function initialEffects(): MediaEffect[] {
  return [startPermissionMonitor];
}
