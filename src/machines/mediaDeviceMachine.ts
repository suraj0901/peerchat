import { setup, fromPromise, fromCallback, assign, emit } from 'xstate';
import type {
  MediaDeviceContext,
  MediaDeviceEvent,
  MediaDeviceCallbackEvent,
  MediaDeviceInput,
  MediaDeviceEmittedEvent,
  MediaDeviceCommand,
  MediaMode,
} from './mediaDeviceTypes';

// ── Actor I/O types ───────────────────────────────────────────────────────────

type AcquireStreamInput = {
  mode: MediaMode;
  constraints: MediaStreamConstraints;
  screenConstraints: DisplayMediaStreamOptions;
};

type AcquireStreamOutput = {
  stream: MediaStream;
  devices: MediaDeviceInfo[];
};

type SwitchDeviceInput = {
  stream: MediaStream;
  kind: 'audio' | 'video';
  deviceId: string;
};

type SwitchDeviceOutput = {
  stream: MediaStream;
  kind: 'audio' | 'video';
};

// ── Actors ────────────────────────────────────────────────────────────────────

/**
 * Acquires a MediaStream via getUserMedia (user mode) or getDisplayMedia (screen mode).
 * Enumerates devices after acquisition — getUserMedia causes the browser to reveal
 * device labels, so this is the earliest point where labeled results are available.
 *
 * The AbortSignal handles the STOP race condition: if the machine transitions away
 * before the promise resolves (e.g. user sends STOP mid-dialog), the signal fires
 * and we stop the orphaned tracks before throwing.
 */
const acquireStreamActor = fromPromise<AcquireStreamOutput, AcquireStreamInput>(
  async ({ input, signal }) => {
    const stream =
      input.mode === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia(input.screenConstraints)
        : await navigator.mediaDevices.getUserMedia(input.constraints);

    if (signal.aborted) {
      stream.getTracks().forEach(t => t.stop());
      throw new DOMException('Acquisition aborted', 'AbortError');
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return { stream, devices };
  }
);

/**
 * Replaces a single track (audio or video) in an existing MediaStream with one from
 * a different device. Mutates the stream in place — the same object reference is
 * returned so callers holding the stream reference see the updated tracks without
 * needing to re-bind anything.
 *
 * Call compatibility note: if this stream is currently used in an active PeerJS call,
 * the application must also call RTCRtpSender.replaceTrack() on the relevant sender
 * to propagate the track change to the remote peer. This is outside the scope of
 * this machine — it requires access to the RTCPeerConnection internals that PeerJS
 * does not expose at this abstraction level.
 */
const switchDeviceActor = fromPromise<SwitchDeviceOutput, SwitchDeviceInput>(
  async ({ input: { stream, kind, deviceId } }) => {
    const constraints: MediaStreamConstraints =
      kind === 'audio'
        ? { audio: { deviceId: { exact: deviceId } } }
        : { video: { deviceId: { exact: deviceId } } };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack =
      kind === 'audio' ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];

    if (!newTrack) throw new Error(`No ${kind} track returned for deviceId "${deviceId}"`);

    const oldTracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
    oldTracks.forEach(t => {
      stream.removeTrack(t);
      t.stop();
    });
    stream.addTrack(newTrack);

    return { stream, kind };
  }
);

/**
 * Monitors an active MediaStream for unexpected track endings, and watches for
 * system-level device changes (e.g. a USB microphone being unplugged).
 *
 * Unlike PeerJS event emitters, MediaStreamTrack and navigator.mediaDevices both
 * support addEventListener/removeEventListener, so cleanup here is complete and
 * correct — no no-op workarounds needed.
 *
 * On devicechange, re-enumerates inside the callback rather than delegating to a
 * separate actor. This keeps the machine's event handling for this case synchronous
 * (just an assign) and avoids coordinating a fire-and-forget actor.
 */
const streamMonitorSource = fromCallback<MediaDeviceCallbackEvent, MediaStream>(
  ({
    input: stream,
    sendBack,
  }: {
    input: MediaStream;
    sendBack: (e: MediaDeviceCallbackEvent) => void;
  }) => {
    const handlers: Array<{ track: MediaStreamTrack; handler: () => void }> = [];

    const watchTrack = (track: MediaStreamTrack, kind: 'audio' | 'video') => {
      const handler = () => sendBack({ type: 'TRACK_ENDED_INTERNAL', kind });
      track.addEventListener('ended', handler);
      handlers.push({ track, handler });
    };

    stream.getAudioTracks().forEach(t => watchTrack(t, 'audio'));
    stream.getVideoTracks().forEach(t => watchTrack(t, 'video'));

    const handleDeviceChange = () => {
      // Fire-and-forget: if this resolves after the actor is stopped, sendBack is a no-op
      void navigator.mediaDevices.enumerateDevices().then(devices =>
        sendBack({ type: 'DEVICES_ENUMERATED_INTERNAL', devices })
      );
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      handlers.forEach(({ track, handler }) => track.removeEventListener('ended', handler));
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

const isPermissionDenied = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const stopAllTracks = (stream: MediaStream | null): void =>
  stream?.getTracks().forEach(t => t.stop());

// ── Machine ───────────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of a local MediaStream — acquisition, track health, device
 * switching, and recovery. Intentionally independent of callMachine and peerMachine.
 *
 * States:
 *   idle          — no stream; waiting for REQUEST or REQUEST_SCREEN.
 *   requesting    — getUserMedia / getDisplayMedia in flight.
 *   active        — stream is live; tracks are monitored.
 *   switching     — replacing one track with one from a different device.
 *   recovering    — a track ended unexpectedly (user mode only); re-acquiring.
 *   denied        — final; browser denied permission. User must change browser settings.
 *
 * Key design decisions:
 *
 * - Screen mode never recovers: when a screen share track ends, the user deliberately
 *   stopped sharing via the browser's own UI. Transitioning to idle is correct.
 *
 * - Track switching mutates the stream in place (same object reference). This means
 *   the callMachine's reference to the stream remains valid after a device switch.
 *   However, RTCRtpSender.replaceTrack() must be called at the application layer
 *   to propagate the change to the remote peer.
 *
 * - Device enumeration happens automatically: after stream acquisition (labels
 *   become available post-getUserMedia) and on devicechange events. There is no
 *   manual ENUMERATE_DEVICES command; callers read devices from snapshot.context.devices.
 *
 * - STOP is accepted in every non-final state and always transitions to idle.
 *
 * Observable events (via actor.on(...)):
 *   media.stream.ready       — new stream available (also fires after recovery).
 *   media.stream.stopped     — stream stopped cleanly.
 *   media.stream.error       — acquisition failed (non-permission).
 *   media.permission.denied  — browser denied permission; cannot auto-recover.
 *   media.track.ended        — a track ended unexpectedly; recovery starting.
 *   media.recovering         — recovery acquisition has begun.
 *   media.device.switched    — track replaced; same stream reference.
 *   media.device.switch.failed — switch failed; existing track still active.
 *   media.devices.updated    — available device list changed.
 *
 * Usage:
 *   const actor = createActor(mediaDeviceMachine, { input: {} });
 *   actor.on('media.stream.ready', ({ stream, mode }) => { ... });
 *   actor.on('media.permission.denied', () => showPermissionsPrompt());
 *   actor.start();
 *   actor.send({ type: 'REQUEST', constraints: { audio: true, video: true } });
 */
export const mediaDeviceMachine = setup({
  types: {
    context: {} as MediaDeviceContext,
    events: {} as MediaDeviceEvent,
    input: {} as MediaDeviceInput,
    emitted: {} as MediaDeviceEmittedEvent,
  },
  actors: { acquireStreamActor, switchDeviceActor, streamMonitorSource },

  actions: {
    // ── Context ───────────────────────────────────────────────────────────────

    assignUserRequest: assign({
      mode: 'user' as MediaMode,
      constraints: ({ event }) =>
        (event as Extract<MediaDeviceCommand, { type: 'REQUEST' }>).constraints,
    }),

    assignScreenRequest: assign({
      mode: 'screen' as MediaMode,
      screenConstraints: ({ event }) =>
        (event as Extract<MediaDeviceCommand, { type: 'REQUEST_SCREEN' }>).constraints ?? {},
    }),

    assignStreamReady: assign({
      stream: ({ event }) => (event as unknown as { output: AcquireStreamOutput }).output.stream,
      devices: ({ event }) => (event as unknown as { output: AcquireStreamOutput }).output.devices,
      lastError: null,
    }),

    assignDevices: assign({
      devices: ({ event }) =>
        (event as Extract<MediaDeviceCallbackEvent, { type: 'DEVICES_ENUMERATED_INTERNAL' }>)
          .devices,
    }),

    assignLastError: assign({
      lastError: ({ event }) => toError((event as unknown as { error: unknown }).error),
    }),

    assignPendingSwitch: assign({
      pendingSwitchKind: ({ event }) =>
        (event as Extract<MediaDeviceCommand, { type: 'SWITCH_DEVICE' }>).kind,
      pendingSwitchDeviceId: ({ event }) =>
        (event as Extract<MediaDeviceCommand, { type: 'SWITCH_DEVICE' }>).deviceId,
    }),

    clearPendingSwitch: assign({
      pendingSwitchKind: null,
      pendingSwitchDeviceId: null,
    }),

    clearStream: assign({ stream: null }),

    /**
     * Stops all tracks on the current stream. Used on STOP, on screen track ended,
     * and before transitioning to denied from a live state.
     * Safe to call when context.stream is null.
     */
    stopCurrentTracks: ({ context }) => stopAllTracks(context.stream),

    /**
     * Used in recovering.onDone — context.stream is still the OLD stream at the
     * point this action fires (assign actions haven't run yet). Stopping old tracks
     * here, then assignStreamReady overwrites context.stream with the new one.
     */
    stopOldTracks: ({ context }) => stopAllTracks(context.stream),

    // ── Emitters ──────────────────────────────────────────────────────────────

    emitStreamReady: emit(({ context, event }): MediaDeviceEmittedEvent => ({
      type: 'media.stream.ready',
      stream: (event as unknown as { output: AcquireStreamOutput }).output.stream,
      mode: context.mode,
    })),

    emitStreamStopped: emit((): MediaDeviceEmittedEvent => ({
      type: 'media.stream.stopped',
    })),

    emitStreamError: emit(({ event }): MediaDeviceEmittedEvent => ({
      type: 'media.stream.error',
      error: toError((event as unknown as { error: unknown }).error),
    })),

    emitPermissionDenied: emit((): MediaDeviceEmittedEvent => ({
      type: 'media.permission.denied',
    })),

    emitTrackEnded: emit(({ event }): MediaDeviceEmittedEvent => ({
      type: 'media.track.ended',
      kind: (event as Extract<MediaDeviceCallbackEvent, { type: 'TRACK_ENDED_INTERNAL' }>).kind,
    })),

    emitRecovering: emit((): MediaDeviceEmittedEvent => ({
      type: 'media.recovering',
    })),

    emitDeviceSwitched: emit(({ event }): MediaDeviceEmittedEvent => {
      const { stream, kind } = (event as unknown as { output: SwitchDeviceOutput }).output;
      return { type: 'media.device.switched', kind, stream };
    }),

    emitDeviceSwitchFailed: emit(({ context, event }): MediaDeviceEmittedEvent => ({
      type: 'media.device.switch.failed',
      kind: context.pendingSwitchKind!,
      error: toError((event as unknown as { error: unknown }).error),
    })),

    emitDevicesUpdated: emit(({ event }): MediaDeviceEmittedEvent => ({
      type: 'media.devices.updated',
      devices: (
        event as Extract<MediaDeviceCallbackEvent, { type: 'DEVICES_ENUMERATED_INTERNAL' }>
      ).devices,
    })),
  },

  guards: {
    isPermissionDeniedError: ({ event }) =>
      isPermissionDenied((event as unknown as { error: unknown }).error),

    isUserMode: ({ context }) => context.mode === 'user',
  },
}).createMachine({
  id: 'mediaDevice',
  context: {
    stream: null,
    constraints: { audio: true, video: true },
    screenConstraints: {},
    mode: 'user',
    devices: [],
    lastError: null,
    pendingSwitchKind: null,
    pendingSwitchDeviceId: null,
  },

  initial: 'idle',
  states: {
    idle: {
      on: {
        REQUEST: {
          target: 'requesting',
          actions: 'assignUserRequest',
        },
        REQUEST_SCREEN: {
          target: 'requesting',
          actions: 'assignScreenRequest',
        },
      },
    },

    /**
     * getUserMedia / getDisplayMedia is in flight.
     * STOP transitions away immediately; the AbortSignal in acquireStreamActor
     * ensures that if the promise resolves after the transition, orphaned tracks
     * are stopped before the result is discarded.
     */
    requesting: {
      invoke: {
        id: 'acquireStream',
        src: 'acquireStreamActor',
        input: ({ context }) => ({
          mode: context.mode,
          constraints: context.constraints,
          screenConstraints: context.screenConstraints,
        }),
        onDone: {
          target: 'active',
          actions: ['assignStreamReady', 'emitStreamReady'],
        },
        onError: [
          {
            guard: 'isPermissionDeniedError',
            target: 'denied',
            actions: 'emitPermissionDenied',
          },
          {
            target: 'idle',
            actions: ['assignLastError', 'emitStreamError'],
          },
        ],
      },
      on: {
        STOP: { target: 'idle' },
      },
    },

    /**
     * Stream is live. The streamMonitorSource watches individual track 'ended'
     * events and the global devicechange event.
     *
     * TRACK_ENDED_INTERNAL behaviour differs by mode:
     *   user   — unexpected hardware event; attempt automatic recovery.
     *   screen — user deliberately stopped sharing via browser UI; go to idle.
     */
    active: {
      invoke: {
        id: 'streamMonitor',
        src: 'streamMonitorSource',
        input: ({ context }) => context.stream!,
      },
      on: {
        TRACK_ENDED_INTERNAL: [
          {
            guard: 'isUserMode',
            target: 'recovering',
            actions: 'emitTrackEnded',
          },
          {
            // Screen mode — user stopped sharing intentionally
            target: 'idle',
            actions: ['stopCurrentTracks', 'clearStream', 'emitStreamStopped'],
          },
        ],

        DEVICES_ENUMERATED_INTERNAL: {
          // Internal self-transition — no state change, just update context and notify
          actions: ['assignDevices', 'emitDevicesUpdated'],
        },

        SWITCH_DEVICE: {
          guard: 'isUserMode',
          target: 'switching',
          actions: 'assignPendingSwitch',
        },

        STOP: {
          target: 'idle',
          actions: ['stopCurrentTracks', 'clearStream', 'emitStreamStopped'],
        },
      },
    },

    /**
     * Replacing a single track in the stream with one from a different device.
     * The stream object reference does not change — tracks are swapped in place.
     *
     * On error the machine returns to active, keeping the existing (old) track.
     * context.lastError is updated and media.device.switch.failed is emitted so
     * the application can surface a message to the user.
     *
     * The streamMonitor is not running during this state, but switching is fast
     * enough that missing a track-ended event here is an acceptable trade-off.
     */
    switching: {
      invoke: {
        id: 'switchDevice',
        src: 'switchDeviceActor',
        input: ({ context }) => ({
          stream: context.stream!,
          kind: context.pendingSwitchKind!,
          deviceId: context.pendingSwitchDeviceId!,
        }),
        onDone: {
          target: 'active',
          actions: ['clearPendingSwitch', 'emitDeviceSwitched'],
        },
        onError: {
          target: 'active',
          actions: ['assignLastError', 'emitDeviceSwitchFailed', 'clearPendingSwitch'],
        },
      },
      on: {
        STOP: {
          target: 'idle',
          actions: ['stopCurrentTracks', 'clearStream', 'emitStreamStopped'],
        },
      },
    },

    /**
     * A track ended unexpectedly (user mode only). Re-acquires a fresh stream
     * using the same constraints that produced the original stream.
     *
     * On success: old tracks are stopped, context.stream is replaced, and
     * media.stream.ready is re-emitted. The application should update any
     * active call with the new stream reference.
     *
     * On permission denied: the user revoked permission while the call was live.
     * Old tracks are stopped and the machine transitions to the final denied state.
     *
     * On other error: old tracks are stopped, machine returns to idle.
     * The application can retry by sending REQUEST again.
     */
    recovering: {
      entry: 'emitRecovering',
      invoke: {
        id: 'acquireStreamForRecovery',
        src: 'acquireStreamActor',
        input: ({ context }) => ({
          mode: context.mode,
          constraints: context.constraints,
          screenConstraints: context.screenConstraints,
        }),
        onDone: {
          target: 'active',
          // stopOldTracks fires first (context.stream is still old here),
          // then assignStreamReady overwrites context.stream with the new one.
          actions: ['stopOldTracks', 'assignStreamReady', 'emitStreamReady'],
        },
        onError: [
          {
            guard: 'isPermissionDeniedError',
            target: 'denied',
            actions: ['stopCurrentTracks', 'clearStream', 'emitPermissionDenied'],
          },
          {
            target: 'idle',
            actions: ['stopCurrentTracks', 'clearStream', 'assignLastError', 'emitStreamError'],
          },
        ],
      },
      on: {
        STOP: {
          target: 'idle',
          actions: ['stopCurrentTracks', 'clearStream', 'emitStreamStopped'],
        },
      },
    },

    /**
     * The browser permanently denied media permission. The Peer instance is unaffected
     * but the stream cannot be acquired without the user changing browser settings.
     * This is a final state — send REQUEST again after the user grants permission
     * by creating a new actor instance.
     */
    denied: {
      type: 'final',
    },
  },
});