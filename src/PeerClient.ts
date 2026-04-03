import type { Peer, PeerError } from 'peerjs';
import type { Unsubscribe } from './core';
import { PeerManager } from './peer/PeerManager';
import type { PeerEmittedEvent } from './peer/types';
import type { PeerState } from './peer/state';
import { MediaMachine } from './media/MediaManager';
import type { MediaEmittedEvent } from './media/types';
import type { MediaState, MediaMode, MediaPermissions } from './media/state';

// ── Unified event map ─────────────────────────────────────────────────────────

type AllEmittedEvents = PeerEmittedEvent | MediaEmittedEvent;

type PeerClientEvents = {
  [K in AllEmittedEvents['type']]: (
    payload: Extract<AllEmittedEvents, { type: K }>,
  ) => void;
};

// ── Reactive state snapshot ───────────────────────────────────────────────────

export type PeerClientState = {
  peerId: string | null;
  peerState: PeerState['_tag'];
  peerError: PeerError<string> | null;
  mediaState: MediaState['_tag'];
  localStream: MediaStream | null;
  devices: MediaDeviceInfo[];
  mediaMode: MediaMode;
  mediaError: null;
  permissions: MediaPermissions;
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
    localStream: mediaState._tag === 'active' || mediaState._tag === 'switching'
      ? mediaState.stream
      : mediaState._tag === 'recovering'
        ? mediaState.oldStream
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

export class PeerClient {
  private peer: Peer;
  private peerMachine: PeerManager;
  private mediaMachine: MediaMachine;

  constructor(peer: Peer) {
    this.peer = peer;
    this.peerMachine = new PeerManager({ peer });
    this.mediaMachine = new MediaMachine();
  }

  // ── Event subscription ──────────────────────────────────────────────────────

  public on<T extends keyof PeerClientEvents>(
    eventType: T,
    listener: PeerClientEvents[T],
  ): Unsubscribe {
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

  // ── Accessors ──────────────────────────────────────────────────────────────

  public get connections(): Map<string, import('./connection/state').ConnectionState> {
    const state = this.peerMachine.getState();
    const result = new Map<string, import('./connection/state').ConnectionState>();
    if (state._tag === 'ready' || state._tag === 'disconnected') {
      state.connections.forEach((machine, id) => {
        result.set(id, machine.getState());
      });
    }
    return result;
  }

  public get calls(): Map<string, import('./call/state').CallState> {
    const state = this.peerMachine.getState();
    const result = new Map<string, import('./call/state').CallState>();
    if (state._tag === 'ready' || state._tag === 'disconnected') {
      state.calls.forEach((machine, id) => {
        result.set(id, machine.getState());
      });
    }
    return result;
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

  public get permissions(): MediaPermissions {
    return this.mediaMachine.getState().permissions;
  }

  // ── Media commands ──────────────────────────────────────────────────────────

  public requestMedia(
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    const state = this.mediaMachine.getState();
    if (state._tag === 'idle') state.request(constraints);
  }

  public requestScreen(constraints?: DisplayMediaStreamOptions) {
    const state = this.mediaMachine.getState();
    if (state._tag === 'idle') state.requestScreen(constraints);
  }

  public switchDevice(kind: 'audio' | 'video', deviceId: string) {
    const state = this.mediaMachine.getState();
    if (state._tag === 'active') state.switchDevice(kind, deviceId);
  }

  public stopMedia() {
    const state = this.mediaMachine.getState();
    if (state._tag === 'active') state.stop();
    else if (state._tag === 'switching') state.stop();
    else if (state._tag === 'recovering') state.stop();
    else if (state._tag === 'requesting') state.stop();
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
    this.peerMachine.connect(remotePeerId);
  }

  /**
   * @deprecated Use `client.connections.get(id)?.send(data)` instead.
   */
  public sendData(connectionId: string, data: unknown) {
    const conn = this.connections.get(connectionId);
    if (conn && conn._tag === 'open') conn.send(data);
  }

  /**
   * @deprecated Use `client.connections.get(id)?.close()` instead.
   */
  public closeConnection(connectionId: string) {
    const conn = this.connections.get(connectionId);
    if (conn && conn._tag === 'open') conn.close();
    else if (conn) conn.destroy();
  }

  // ── Media calls ─────────────────────────────────────────────────────────────

  public call(
    remotePeerId: string,
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    this.withMedia(constraints, (stream) => {
      this.peerMachine.call(remotePeerId, stream);
    });
  }

  /**
   * @deprecated Use `client.calls.get(id)?.answer(stream)` instead.
   */
  public answerCall(
    callId: string,
    constraints: MediaStreamConstraints = { audio: true, video: true },
  ) {
    this.withMedia(
      constraints,
      (stream) => {
        const call = this.calls.get(callId);
        if (call && call._tag === 'ringing') call.answer(stream);
      },
      () => {
        const call = this.calls.get(callId);
        if (call && call._tag === 'ringing') call.reject();
      },
    );
  }

  /**
   * @deprecated Use `client.calls.get(id)?.reject()` instead.
   */
  public rejectCall(callId: string) {
    const call = this.calls.get(callId);
    if (call && call._tag === 'ringing') call.reject();
  }

  /**
   * @deprecated Use `client.calls.get(id)?.hangUp()` instead.
   */
  public hangUp(callId: string) {
    const call = this.calls.get(callId);
    if (call && (call._tag === 'live' || call._tag === 'connecting')) {
       call.hangUp();
    }
  }

  public retryMedia() {
    const state = this.mediaMachine.getState();
    if (state._tag === 'denied') state.retry();
  }

  public checkPermissions() {
    const state = this.mediaMachine.getState();
    if (state._tag === 'idle') state.checkPermissions();
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
    this.peerMachine.reconnect();
  }

  public destroy() {
    this.peerMachine.destroy();
    this.mediaMachine.destroy();
  }
}
