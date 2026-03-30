import { assertNever } from '../core';
import type {
  MediaState,
  MediaEvent,
  MediaEffect,
} from './types';
import { isPermissionDenied, toError } from './types';
import {
  emit,
  stopTracks,
  acquireStreamEffect,
  switchDeviceEffect,
  startStreamMonitor,
  stopStreamMonitor,
  checkPermissionsEffect,
} from './effects';

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

    default:
      return assertNever(state);
  }
}

/**
 * Returns the list of effects to execute on machine startup
 * (the permission monitor subscription).
 */
import { startPermissionMonitor } from './effects';

export function initialEffects(): MediaEffect[] {
  return [startPermissionMonitor];
}
