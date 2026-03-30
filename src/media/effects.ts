import type { MediaEffect, MediaEmittedEvent, MediaPermissions } from './types';

// ── Emit / Track Helpers ──────────────────────────────────────────────────────

/** Shorthand to create an emit effect. */
export const emit = (event: MediaEmittedEvent): MediaEffect =>
  ({ type: 'emit', event });

/** Shorthand to stop tracks on a stream. */
export const stopTracks = (stream: MediaStream): MediaEffect =>
  ({ type: 'fireAndForget', execute: () => stream.getTracks().forEach(t => t.stop()) });

// ── Stream Acquisition ────────────────────────────────────────────────────────

/** Effect: acquire a media stream (getUserMedia or getDisplayMedia). */
export function acquireStreamEffect(
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

// ── Device Switching ──────────────────────────────────────────────────────────

/** Effect: switch a track in the active stream. */
export function switchDeviceEffect(
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

// ── Stream Monitor ────────────────────────────────────────────────────────────

/** Effect: start monitoring track ends + device changes on an active stream. */
export function startStreamMonitor(stream: MediaStream): MediaEffect {
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
export const stopStreamMonitor: MediaEffect = {
  type: 'stopSubscription',
  id: 'streamMonitor',
};

// ── Permissions ───────────────────────────────────────────────────────────────

/** Effect: check permissions via the Permissions API. */
export const checkPermissionsEffect: MediaEffect = {
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
    } satisfies MediaPermissions;
  },
  onDone: (output) => ({ type: 'PERMISSIONS_CHECKED', permissions: output as MediaPermissions }),
  onError: () => ({ type: 'PERMISSIONS_CHECK_ERROR' }),
};

/** Effect: start a long-lived permission monitor. */
export const startPermissionMonitor: MediaEffect = {
  type: 'startSubscription',
  id: 'permissionMonitor',
  subscribe: (send) => {
    if (!navigator.permissions?.query) return () => {};

    let camStatus: globalThis.PermissionStatus | null = null;
    let micStatus: globalThis.PermissionStatus | null = null;

    const requery = () => {
      send({
        type: 'PERMISSION_CHANGED',
        permissions: {
          camera: camStatus?.state ?? 'unknown',
          microphone: micStatus?.state ?? 'unknown',
        },
      });
    };

    void (async () => {
      [camStatus, micStatus] = await Promise.all([
        navigator.permissions.query({ name: 'camera' as PermissionName }).catch(() => null),
        navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null),
      ]);

      if (camStatus) camStatus.onchange = requery;
      if (micStatus) micStatus.onchange = requery;
    })();

    return () => {
      if (camStatus) camStatus.onchange = null;
      if (micStatus) micStatus.onchange = null;
    };
  },
};
