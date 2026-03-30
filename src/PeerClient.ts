import type { Peer, PeerError } from 'peerjs';
import type { Unsubscribe } from './core';
import { createPeerManager, type PeerMachine } from './peer/PeerManager';
import type { PeerEmittedEvent, PeerCommand } from './peer/types';
import { createMediaManager, type MediaMachine } from './media/MediaManager';
import type { MediaEmittedEvent, MediaCommand, MediaState, MediaMode, PermissionStatus } from './media/types';
import type { PeerState } from './peer/types';

// ── Unified event map ─────────────────────────────────────────────────────────

type AllEmittedEvents = PeerEmittedEvent | MediaEmittedEvent;

type PeerClientEvents = {
  [K in AllEmittedEvents['type']]: (
    payload: Extract<AllEmittedEvents, { type: K }>,
  ) => void;
};

// ── Reactive state snapshot ───────────────────────────────────────────────────

/**
 * Flat projection of both the peer and media machine states.
 * Subscribers receive a new object on every state change from either machine.
 *
 * Now backed by discriminated unions internally — state-specific data is
 * only available when the state tag matches.
 */
export type PeerClientState = {
  // Peer (discriminated by peerState)
  peerId: string | null;
  peerState: PeerState['_tag'];
  peerError: PeerError<string> | null;
  // Media (discriminated by mediaState)
  mediaState: MediaState['_tag'];
  localStream: MediaStream | null;
  devices: MediaDeviceInfo[];
  mediaMode: MediaMode;
  mediaError: null; // No longer tracked in context — emitted as events
  permissions: PermissionStatus;
};

export type Subscription = { unsubscribe: () => void };

function deriveState(peerState: PeerState, mediaState: MediaState): PeerClientState {
  return {
    peerId: peerState._tag === 'ready' || peerState._tag === 'disconnected'
      ? peerState.peerId
      : null,
    peerState: peerState._tag,
    peerError: peerState._tag === 'error' ? peerState.lastError : null,
    mediaState: mediaState._tag,
    localStream: mediaState._tag === 'active' || mediaState._tag === 'switching' || mediaState._tag === 'recovering'
      ? (mediaState._tag === 'recovering' ? mediaState.oldStream : mediaState.stream)
      : null,
    devices: mediaState._tag === 'active' || mediaState._tag === 'switching'
      ? mediaState.devices
      : [],
    mediaMode: mediaState._tag === 'active' || mediaState._tag === 'switching' || mediaState._tag === 'recovering' || mediaState._tag === 'requesting'
      ? mediaState.mode
      : 'user',
    mediaError: null,
    permissions: mediaState.permissions,
  };
}

// ── PeerClient ────────────────────────────────────────────────────────────────

/**
 * High-level, event-driven wrapper around PeerJS for video calls, data
 * channels, and local media management.
 *
 * Internally coordinates two independent state machines:
 *
 *   - **PeerManager** — signaling, data connections, and media calls.
 *   - **MediaManager** — local stream acquisition, track health,
 *     device switching, and recovery.
 *
 * Both use discriminated union states — each state variant carries exactly
 * the data that exists in that state. No nullable context fields.
 *
 * @example
 * ```typescript
 * const client = new PeerClient(peer);
 *
 * client.on('peer.ready', ({ peerId }) => console.log('Ready:', peerId));
 * client.on('media.stream.ready', ({ stream }) => { video.srcObject = stream; });
 *
 * client.requestMedia({ audio: true, video: true });
 * client.call('remote-peer-id');
 * ```
 */
export class PeerClient {
  private peer: Peer;
  private peerMachine: PeerMachine;
  private mediaMachine: MediaMachine;

  constructor(peer: Peer) {
    this.peer = peer;
    this.peerMachine = createPeerManager({ peer });
    this.mediaMachine = createMediaManager();
  }

  // ── Event subscription ──────────────────────────────────────────────────────

  public on<T extends keyof PeerClientEvents>(
    eventType: T,
    listener: PeerClientEvents[T],
  ) {
    if ((eventType as string).startsWith('media.')) {
      return this.mediaMachine.on(
        eventType as MediaEmittedEvent['type'],
        listener as any,
      );
    }
    return this.peerMachine.on(
      eventType as PeerEmittedEvent['type'],
      listener as any,
    );
  }

  public subscribe(listener: (state: PeerClientState) => void): Subscription {
    // Emit immediately
    listener(deriveState(
      this.peerMachine.getState(),
      this.mediaMachine.getState(),
    ));

    const peerSub = this.peerMachine.subscribe(() => {
      listener(deriveState(
        this.peerMachine.getState(),
        this.mediaMachine.getState(),
      ));
    });

    const mediaSub = this.mediaMachine.subscribe(() => {
      listener(deriveState(
        this.peerMachine.getState(),
        this.mediaMachine.getState(),
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

  public get peerId(): string | null {
    const state = this.peerMachine.getState();
    return state._tag === 'ready' || state._tag === 'disconnected' ? state.peerId : null;
  }

  public get state() {
    return this.peerMachine.getState();
  }

  // ── Media state ─────────────────────────────────────────────────────────────

  public get mediaState() {
    return this.mediaMachine.getState();
  }

  public get localStream(): MediaStream | null {
    const state = this.mediaMachine.getState();
    if (state._tag === 'active' || state._tag === 'switching') return state.stream;
    if (state._tag === 'recovering') return state.oldStream;
    return null;
  }

  public get devices(): MediaDeviceInfo[] {
    const state = this.mediaMachine.getState();
    if (state._tag === 'active' || state._tag === 'switching') return state.devices;
    return [];
  }

  public get mediaMode(): MediaMode {
    const state = this.mediaMachine.getState();
    if (state._tag === 'active' || state._tag === 'switching' || state._tag === 'recovering' || state._tag === 'requesting') {
      return state.mode;
    }
    return 'user';
  }

  public get permissions(): PermissionStatus {
    return this.mediaMachine.getState().permissions;
  }

  // ── Media commands ──────────────────────────────────────────────────────────

  public requestMedia(
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    this.mediaMachine.send({ type: 'REQUEST', constraints });
  }

  public requestScreen(constraints?: DisplayMediaStreamOptions) {
    this.mediaMachine.send({ type: 'REQUEST_SCREEN', constraints });
  }

  public switchDevice(kind: 'audio' | 'video', deviceId: string) {
    this.mediaMachine.send({ type: 'SWITCH_DEVICE', kind, deviceId });
  }

  public stopMedia() {
    this.mediaMachine.send({ type: 'STOP' });
  }

  // ── Peer commands ───────────────────────────────────────────────────────────

  private send(event: PeerCommand) {
    this.peerMachine.send(event);
  }

  /**
   * Ensures a local MediaStream is available before executing a callback.
   */
  private withMedia(
    constraints: MediaStreamConstraints,
    onStream: (stream: MediaStream) => void,
    onError?: () => void,
  ) {
    const state = this.mediaMachine.getState();

    if (state._tag === 'active') {
      onStream(state.stream);
      return;
    }

    this.requestMedia(constraints);

    const cleanup = () => {
      readySub.unsubscribe();
      deniedSub.unsubscribe();
      errorSub.unsubscribe();
    };

    const readySub = this.mediaMachine.on('media.stream.ready', ({ stream }) => {
      cleanup();
      onStream(stream);
    });
    const deniedSub = this.mediaMachine.on('media.permission.denied', () => {
      cleanup();
      onError?.();
    });
    const errorSub = this.mediaMachine.on('media.stream.error', () => {
      cleanup();
      onError?.();
    });
  }

  // ── Data connections ────────────────────────────────────────────────────────

  public connect(remotePeerId: string) {
    this.send({ type: 'CONNECT_TO', remotePeerId });
  }

  public sendData(connectionId: string, data: unknown) {
    this.send({ type: 'SEND', connectionId, data });
  }

  public closeConnection(connectionId: string) {
    this.send({ type: 'CLOSE_CONNECTION', connectionId });
  }

  // ── Media calls ─────────────────────────────────────────────────────────────

  public call(
    remotePeerId: string,
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    this.withMedia(constraints, (stream) => {
      this.send({ type: 'CALL', remotePeerId, localStream: stream });
    });
  }

  public answerCall(
    callId: string,
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    this.withMedia(
      constraints,
      (stream) => {
        this.send({ type: 'ANSWER_CALL', callId, localStream: stream });
      },
      () => {
        this.send({ type: 'REJECT_CALL', callId });
      },
    );
  }

  public rejectCall(callId: string) {
    this.send({ type: 'REJECT_CALL', callId });
  }

  public hangUp(callId: string) {
    this.send({ type: 'HANG_UP', callId });
  }

  public retryMedia() {
    this.mediaMachine.send({ type: 'RETRY' });
  }

  public checkPermissions() {
    this.mediaMachine.send({ type: 'CHECK_PERMISSIONS' });
  }

  // ── Audio output ───────────────────────────────────────────────────────────

  public async switchSpeaker(
    deviceId: string,
    audioElement: HTMLAudioElement,
  ): Promise<void> {
    if (typeof audioElement.setSinkId !== 'function') {
      throw new Error('setSinkId is not supported in this browser');
    }
    await audioElement.setSinkId(deviceId);
  }

  // ── Peer lifecycle ──────────────────────────────────────────────────────────

  public reconnect() {
    this.send({ type: 'RECONNECT' });
  }

  public destroy() {
    this.send({ type: 'DESTROY' });
    this.mediaMachine.send({ type: 'STOP' });
    this.mediaMachine.destroy();
  }
}
