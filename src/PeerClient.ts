import type { Peer, PeerError } from "peerjs";
import { createActor, type Actor } from "xstate";
import {
  peerMachine,
  mediaDeviceMachine,
  type PeerEmittedEvent,
  type PeerCommand,
  type MediaDeviceEmittedEvent,
  type MediaDeviceCommand,
  type MediaMode,
  type PermissionStatus,
} from "./machines";
import {
  getCameras,
  getMicrophones,
  getSpeakers,
} from "./device";

// ── Unified event map ─────────────────────────────────────────────────────────

type AllEmittedEvents = PeerEmittedEvent | MediaDeviceEmittedEvent;

type PeerClientEvents = {
  [K in AllEmittedEvents["type"]]: (
    payload: Extract<AllEmittedEvents, { type: K }>,
  ) => void;
};

// ── Reactive state snapshot ───────────────────────────────────────────────────

/**
 * Flat projection of both the peer and media machine snapshots.
 * Subscribers receive a new object on every state change from either machine.
 */
export type PeerClientState = {
  // Peer
  peerId: string | null;
  peerState: 'initializing' | 'ready' | 'disconnected' | 'error' | 'destroyed';
  peerError: PeerError<string> | null;
  // Media
  mediaState: string;
  localStream: MediaStream | null;
  devices: MediaDeviceInfo[];
  mediaMode: MediaMode;
  mediaError: Error | null;
  permissions: PermissionStatus;
};

export type Subscription = { unsubscribe: () => void };

type PeerSnapshot = ReturnType<Actor<typeof peerMachine>['getSnapshot']>;
type MediaSnapshot = ReturnType<Actor<typeof mediaDeviceMachine>['getSnapshot']>;

/**
 * Maps the hierarchical peer machine state value to a flat string.
 * XState state values are `{ alive: 'ready' }` for compound states and
 * `'error'` / `'destroyed'` for top-level final states.
 */
function derivePeerState(
  value: PeerSnapshot['value'],
): PeerClientState['peerState'] {
  if (typeof value === 'string') {
    return value as 'error' | 'destroyed';
  }
  return (value as { alive: string }).alive as 'initializing' | 'ready' | 'disconnected';
}

function deriveState(
  peerSnap: PeerSnapshot,
  mediaSnap: MediaSnapshot,
): PeerClientState {
  return {
    peerId: peerSnap.context.peerId,
    peerState: derivePeerState(peerSnap.value),
    peerError: peerSnap.context.lastError,
    mediaState: mediaSnap.value as string,
    localStream: mediaSnap.context.stream,
    devices: mediaSnap.context.devices,
    mediaMode: mediaSnap.context.mode,
    mediaError: mediaSnap.context.lastError,
    permissions: mediaSnap.context.permissions,
  };
}

// ── PeerClient ────────────────────────────────────────────────────────────────

/**
 * High-level, event-driven wrapper around PeerJS for video calls, data
 * channels, and local media management.
 *
 * Internally coordinates two independent XState machines:
 *
 *   - **peerMachine** — signaling, data connections, and media calls.
 *   - **mediaDeviceMachine** — local stream acquisition, track health,
 *     device switching, and recovery.
 *
 * End users interact through simple imperative methods and a single
 * `on()` subscription that covers both peer and media events.
 *
 * @example
 * ```typescript
 * const client = new PeerClient(peer);
 *
 * // Subscribe to events (peer + media, unified)
 * client.on('peer.ready', ({ peerId }) => console.log('Ready:', peerId));
 * client.on('media.stream.ready', ({ stream }) => { video.srcObject = stream; });
 * client.on('media.permission.denied', () => showPermissionsHelp());
 *
 * // Acquire local media
 * client.requestMedia({ audio: true, video: true });
 *
 * // Make a call (uses the active media stream automatically)
 * client.call('remote-peer-id');
 *
 * // Switch camera mid-call
 * client.switchDevice('video', newCameraDeviceId);
 * ```
 */
export class PeerClient {
  private peer: Peer;
  private peerActor: Actor<typeof peerMachine>;
  private mediaActor: Actor<typeof mediaDeviceMachine>;

  constructor(peer: Peer) {
    this.peer = peer;

    this.peerActor = createActor(peerMachine, {
      input: { peer: this.peer },
    });

    this.mediaActor = createActor(mediaDeviceMachine, {
      input: {},
    });

    this.peerActor.start();
    this.mediaActor.start();
  }

  // ── Event subscription ──────────────────────────────────────────────────────

  /**
   * Subscribe to any event emitted by either the peer machine or the media
   * device machine. Events are routed automatically — `media.*` events go to
   * the media actor, everything else goes to the peer actor.
   *
   * Returns an unsubscribe function.
   *
   * @example
   * ```typescript
   * const unsub = client.on('call.active', ({ remoteStream }) => { ... });
   * // later:
   * unsub();
   * ```
   */
  public on<T extends keyof PeerClientEvents>(
    eventType: T,
    listener: PeerClientEvents[T],
  ) {
    if ((eventType as string).startsWith("media.")) {
      return this.mediaActor.on(
        eventType as MediaDeviceEmittedEvent["type"],
        listener as any,
      );
    }
    return this.peerActor.on(
      eventType as PeerEmittedEvent["type"],
      listener as any,
    );
  }

  /**
   * Subscribe to a unified reactive state snapshot that combines both the peer
   * and media machine states into a single flat object.
   *
   * The listener fires synchronously whenever **either** machine transitions.
   * Use this for derived/display state. For one-shot side-effects (toasts,
   * modals), prefer the event-based `on()` API instead.
   *
   * Returns a `{ unsubscribe }` handle.
   *
   * @example
   * ```typescript
   * const sub = client.subscribe((state) => {
   *   console.log(state.peerState, state.mediaState, state.localStream);
   * });
   * // later:
   * sub.unsubscribe();
   * ```
   */
  public subscribe(listener: (state: PeerClientState) => void): Subscription {
    // Emit immediately so the subscriber doesn't have to wait for a transition
    listener(deriveState(
      this.peerActor.getSnapshot(),
      this.mediaActor.getSnapshot(),
    ));

    const peerSub = this.peerActor.subscribe(() => {
      listener(deriveState(
        this.peerActor.getSnapshot(),
        this.mediaActor.getSnapshot(),
      ));
    });

    const mediaSub = this.mediaActor.subscribe(() => {
      listener(deriveState(
        this.peerActor.getSnapshot(),
        this.mediaActor.getSnapshot(),
      ));
    });

    return {
      unsubscribe: () => {
        peerSub.unsubscribe();
        mediaSub.unsubscribe();
      },
    };
  }

  // ── Peer state ──────────────────────────────────────────────────────────────

  /** The local peer ID assigned by the signaling server. */
  public get peerId(): string | null {
    return this.peerActor.getSnapshot().context.peerId;
  }

  /** Current peer machine state (e.g. `{ alive: 'ready' }`). */
  public get state() {
    return this.peerActor.getSnapshot().value;
  }

  // ── Media state ─────────────────────────────────────────────────────────────

  /**
   * Current media machine state.
   * One of: `'idle'`, `'requesting'`, `'active'`, `'switching'`, `'recovering'`, `'denied'`.
   */
  public get mediaState() {
    return this.mediaActor.getSnapshot().value;
  }

  /** The active local MediaStream, or `null` if no stream is acquired. */
  public get localStream(): MediaStream | null {
    return this.mediaActor.getSnapshot().context.stream;
  }

  /** Available media devices. Populated after stream acquisition and updated on device changes. */
  public get devices(): MediaDeviceInfo[] {
    return this.mediaActor.getSnapshot().context.devices;
  }

  /** Current media mode: `'user'` (camera/mic) or `'screen'` (display capture). */
  public get mediaMode(): MediaMode {
    return this.mediaActor.getSnapshot().context.mode;
  }

  /** The last media-related error, or `null`. */
  public get mediaError(): Error | null {
    return this.mediaActor.getSnapshot().context.lastError;
  }

  /**
   * Current permission status for camera and microphone.
   * Initially `{ camera: 'unknown', microphone: 'unknown' }` until
   * `checkPermissions()` is called or a permission change is detected.
   */
  public get permissions(): PermissionStatus {
    return this.mediaActor.getSnapshot().context.permissions;
  }

  // ── Media commands ──────────────────────────────────────────────────────────

  /**
   * Acquire a camera/microphone stream. Emits `media.stream.ready` on success,
   * `media.permission.denied` or `media.stream.error` on failure.
   *
   * @param constraints - getUserMedia constraints. Defaults to `{ audio: true, video: true }`.
   */
  public requestMedia(
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    this.mediaActor.send({ type: "REQUEST", constraints });
  }

  /**
   * Acquire a screen/window/tab capture stream. Emits `media.stream.ready` on
   * success. When the user stops sharing via the browser toolbar, the machine
   * returns to idle and emits `media.stream.stopped`.
   *
   * @param constraints - getDisplayMedia constraints.
   */
  public requestScreen(constraints?: DisplayMediaStreamOptions) {
    this.mediaActor.send({ type: "REQUEST_SCREEN", constraints });
  }

  /**
   * Replace a track in the active stream with one from a different device.
   * Only valid when the media machine is in `'active'` state and mode is `'user'`.
   *
   * Emits `media.device.switched` on success or `media.device.switch.failed` on error.
   * The stream reference does not change — tracks are swapped in place.
   *
   * @param kind - `'audio'` or `'video'`
   * @param deviceId - The target device ID
   */
  public switchDevice(kind: "audio" | "video", deviceId: string) {
    this.mediaActor.send({ type: "SWITCH_DEVICE", kind, deviceId });
  }

  /**
   * Stop all tracks on the current stream and return the media machine to idle.
   * Safe to call in any state. Emits `media.stream.stopped`.
   */
  public stopMedia() {
    this.mediaActor.send({ type: "STOP" });
  }

  // ── Peer commands (private send helper) ─────────────────────────────────────

  private send(event: PeerCommand) {
    this.peerActor.send(event);
  }

  // ── Data connections ────────────────────────────────────────────────────────

  /** Initiate a data connection to a remote peer. */
  public connect(remotePeerId: string) {
    this.send({ type: "CONNECT_TO", remotePeerId });
  }

  /** Send data over an existing data connection. */
  public sendData(connectionId: string, data: unknown) {
    this.send({ type: "SEND", connectionId, data });
  }

  /** Close a data connection. */
  public closeConnection(connectionId: string) {
    this.send({ type: "CLOSE_CONNECTION", connectionId });
  }

  // ── Media calls ─────────────────────────────────────────────────────────────

  /**
   * Initiate an outbound call. If the media machine already has an active
   * stream, it is used immediately. Otherwise, media is auto-requested with
   * the given constraints, and the call is placed once the stream is ready.
   *
   * Listen for `call.active` to know when the remote stream arrives.
   *
   * @param remotePeerId - The peer to call
   * @param constraints - getUserMedia constraints (used only if no stream is active).
   *                      Defaults to `{ audio: true, video: true }`.
   */
  public call(
    remotePeerId: string,
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    const snapshot = this.mediaActor.getSnapshot();

    if (snapshot.matches("active") && snapshot.context.stream) {
      this.send({
        type: "CALL",
        remotePeerId,
        localStream: snapshot.context.stream,
      });
    } else {
      // Auto-acquire media, then place the call
      this.requestMedia(constraints);

      const cleanup = () => {
        readySub.unsubscribe();
        deniedSub.unsubscribe();
        errorSub.unsubscribe();
      };

      const readySub = this.mediaActor.on("media.stream.ready", ({ stream }) => {
        cleanup();
        this.send({ type: "CALL", remotePeerId, localStream: stream });
      });
      const deniedSub = this.mediaActor.on("media.permission.denied", () => {
        cleanup();
      });
      const errorSub = this.mediaActor.on("media.stream.error", () => {
        cleanup();
      });
    }
  }

  /**
   * Answer an incoming call. If the media machine already has an active
   * stream, it is used immediately. Otherwise, media is auto-requested with
   * the given constraints, and the call is answered once the stream is ready.
   *
   * @param callId - The call to answer (from `call.incoming` event)
   * @param constraints - getUserMedia constraints (used only if no stream is active).
   *                      Defaults to `{ audio: true, video: true }`.
   */
  public answerCall(
    callId: string,
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    const snapshot = this.mediaActor.getSnapshot();

    if (snapshot.matches("active") && snapshot.context.stream) {
      this.send({
        type: "ANSWER_CALL",
        callId,
        localStream: snapshot.context.stream,
      });
    } else {
      // Auto-acquire media, then answer
      this.requestMedia(constraints);

      const cleanup = () => {
        readySub.unsubscribe();
        deniedSub.unsubscribe();
        errorSub.unsubscribe();
      };

      const readySub = this.mediaActor.on("media.stream.ready", ({ stream }) => {
        cleanup();
        this.send({ type: "ANSWER_CALL", callId, localStream: stream });
      });
      const deniedSub = this.mediaActor.on("media.permission.denied", () => {
        cleanup();
        // Auto-reject the call since we can't acquire media
        this.send({ type: "REJECT_CALL", callId });
      });
      const errorSub = this.mediaActor.on("media.stream.error", () => {
        cleanup();
        this.send({ type: "REJECT_CALL", callId });
      });
    }
  }

  /** Reject an incoming call without answering. */
  public rejectCall(callId: string) {
    this.send({ type: "REJECT_CALL", callId });
  }

  /** Hang up an active or connecting call. */
  public hangUp(callId: string) {
    this.send({ type: "HANG_UP", callId });
  }

  /**
   * Retry media acquisition after permission was denied.
   * Transitions the media machine from 'denied' back to 'idle' so that
   * a subsequent `requestMedia()` or `requestScreen()` can be attempted.
   */
  public retryMedia() {
    this.mediaActor.send({ type: "RETRY" });
  }

  /**
   * Query the browser's Permissions API for camera and microphone status
   * without acquiring a stream. Emits `media.permission.status` with the
   * result and updates `client.permissions`.
   *
   * Permission changes are also monitored reactively — if the user grants
   * or revokes permission in browser settings, `media.permission.status`
   * will fire automatically.
   *
   * @example
   * ```typescript
   * client.on('media.permission.status', ({ permissions }) => {
   *   if (permissions.camera === 'granted') showCallUI();
   *   else showPermissionSetup();
   * });
   * client.checkPermissions();
   * ```
   */
  public checkPermissions() {
    this.mediaActor.send({ type: "CHECK_PERMISSIONS" });
  }

  // ── Audio output ───────────────────────────────────────────────────────────

  /**
   * Route audio playback to a different output device (speaker/headphones).
   * Requires browser support for `HTMLMediaElement.setSinkId()`.
   *
   * @param deviceId - The target audio output device ID
   * @param audioElement - The HTMLAudioElement playing remote audio
   * @throws If the browser doesn't support setSinkId or the device switch fails
   */
  public async switchSpeaker(
    deviceId: string,
    audioElement: HTMLAudioElement,
  ): Promise<void> {
    if (typeof audioElement.setSinkId !== "function") {
      throw new Error("setSinkId is not supported in this browser");
    }
    await audioElement.setSinkId(deviceId);
  }

  // ── Peer lifecycle ──────────────────────────────────────────────────────────

  /** Reconnect to the signaling server after a disconnection. */
  public reconnect() {
    this.send({ type: "RECONNECT" });
  }

  /**
   * Destroy the peer instance and stop all media. After this call,
   * the PeerClient instance is no longer usable.
   */
  public destroy() {
    this.send({ type: "DESTROY" });
    this.mediaActor.send({ type: "STOP" });
    this.mediaActor.stop();
  }

  // ── Static device utilities ─────────────────────────────────────────────────

  public static getMicrophones = getMicrophones;
  public static getCameras = getCameras;
  public static getSpeakers = getSpeakers;
}
