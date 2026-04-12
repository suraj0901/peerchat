import type { Peer } from 'peerjs';
import { AbstractMachine } from '../core';
import { createLogger } from '../core/logger';
import { PeerInitializingState, PeerReadyState, type PeerContext, type PeerState } from './state';
import type { PeerEmittedEvent } from './types';
import type { CallInfo, CallEmittedEvent } from '../call/types';
import type { CallState } from '../call/state';
import type { ConnectionInfo } from '../connection/types';
import type { CallMachine } from '../call/CallMachine';
import type { ConnectionMachine } from '../connection/ConnectionMachine';
import type { MediaMachine } from '../media/MediaManager';

// ── Call/Media options ────────────────────────────────────────────────────────

export interface CallOptions {
  stream?: MediaStream;
  audio?: boolean;
  video?: boolean;
}

export interface AnswerOptions {
  stream?: MediaStream;
}

// ── PeerManager ──────────────────────────────────────────────────────────────

export class PeerManager extends AbstractMachine<PeerState, PeerEmittedEvent> {
  protected readonly log = createLogger('PeerManager');
  private attachedMedia: MediaMachine | null = null;
  private pendingLocalStream: MediaStream | null = null;
  private mediaSubscriptions: Array<{ unsubscribe: () => void }> = [];

  constructor(input: { peer: Peer; maxRetries?: number; baseRetryDelay?: number }) {
    super();

    const maxRetries = input.maxRetries ?? 5;
    const baseRetryDelay = input.baseRetryDelay ?? 1000;

    this.log.info('🔧 PeerManager created', { maxRetries, baseRetryDelay, peerId: input.peer.id });

    const ctx = this.createContext<PeerContext>({
      emit: (event) => this.emit(event),
      notifyChange: () => this.notifySubscribers(),
      bumpVersion: () => this.bumpVersion(),
    });

    this.currentState = new PeerInitializingState(input.peer, maxRetries, baseRetryDelay, ctx);
  }

  // ── Media Attachment ────────────────────────────────────────────────────────

  /**
   * Attach a MediaMachine to this PeerManager for automatic stream handling.
   * When attached, `call()` and `answer()` will use the attached media's stream.
   * Calling this again with a new MediaMachine will detach the previous one first.
   */
  attachMedia(media: MediaMachine): void {
    this.log.info('📎 attachMedia() called');

    // Clean up previous subscriptions if re-attaching
    this.cleanupMediaSubscriptions();

    this.attachedMedia = media;

    // If media is already active, store the stream
    const mediaState = media.getState();
    if (mediaState._tag === 'active') {
      this.pendingLocalStream = mediaState.stream;
    }

    // Listen for stream ready/stopped events and track subscriptions
    this.mediaSubscriptions.push(
      media.on('media.stream.ready', ({ stream }) => {
        this.pendingLocalStream = stream;
      }),
      media.on('media.stream.stopped', () => {
        this.pendingLocalStream = null;
      }),
    );
  }

  /**
   * Detach previously attached media and clean up event subscriptions.
   */
  detachMedia(): void {
    this.log.info('🔌 detachMedia() called');
    this.cleanupMediaSubscriptions();
    this.attachedMedia = null;
    this.pendingLocalStream = null;
  }

  private cleanupMediaSubscriptions(): void {
    for (const sub of this.mediaSubscriptions) {
      sub.unsubscribe();
    }
    this.mediaSubscriptions = [];
  }

  // ── State Guards ──────────────────────────────────────────────────────────────

  /**
   * Require the peer to be in the 'ready' state.
   * Returns the PeerReadyState or null (with a warning log).
   */
  private requireReady(caller: string): PeerReadyState | null {
    const state = this.getState();
    if (state._tag !== 'ready') {
      this.log.warn(`${caller}() failed — peer state is "${state._tag}", not "ready"`);
      return null;
    }
    return state;
  }

  /**
   * Require a call to exist and be in a specific state.
   * Returns the narrowed call state or null (with a warning log).
   */
  private requireCall<T extends CallState['_tag']>(
    caller: string,
    callId: string,
    ...expectedTags: T[]
  ): Extract<CallState, { _tag: T }> | null {
    const state = this.requireReady(caller);
    if (!state) return null;

    const coordinator = state.calls.get(callId);
    if (!coordinator) {
      this.log.warn(`${caller}() failed — call "${callId}" not found`);
      return null;
    }

    const callState = coordinator.callMachine.getState();
    if (!expectedTags.includes(callState._tag as T)) {
      const expected = expectedTags.length === 1 ? `"${expectedTags[0]}"` : `one of [${expectedTags.join(', ')}]`;
      this.log.warn(`${caller}() failed — call "${callId}" state is "${callState._tag}", expected ${expected}`);
      return null;
    }

    return callState as Extract<CallState, { _tag: T }>;
  }

  // ── Convenience Methods ─────────────────────────────────────────────────────

  /**
   * Connect to a remote peer by ID. Idempotent — skips if already connected.
   */
  connect(remotePeerId: string): void {
    const state = this.requireReady('connect');
    if (state) state.connect(remotePeerId);
  }

  /**
   * Send data to a remote peer. Auto-connects if no open connection exists.
   * Returns true if the data was sent, false if no connection is available.
   */
  send(remotePeerId: string, data: unknown): boolean {
    const state = this.requireReady('send');
    if (!state) return false;

    // Find an open connection
    for (const machine of state.connections.values()) {
      const connState = machine.getState();
      if (connState._tag === 'open' && connState.remotePeerId === remotePeerId) {
        connState.send(data);
        return true;
      }
    }

    // No open connection — try to create one
    this.log.debug(`send() — no open connection to "${remotePeerId}", connecting...`);
    state.connect(remotePeerId);
    // Note: connection is async, so we can't send immediately.
    // The caller should listen for 'connection.opened' and then send.
    return false;
  }

  /**
   * Make a call to a remote peer.
   * Uses attached media stream if available, or requires one in options.
   * Blocked if there is already a live call — hold or hang up first.
   */
  call(remotePeerId: string, options?: CallOptions): boolean {
    const state = this.requireReady('call');
    if (!state) return false;

    // Block outbound call if a live call already exists
    if (this.hasLiveCall()) {
      this.log.warn('call() blocked — a live call already exists. Hold or hang up first.');
      return false;
    }

    let stream = options?.stream ?? this.pendingLocalStream;

    if (!stream) {
      this.log.warn(`call() failed — no local stream available. Attach media or provide a stream.`);
      return false;
    }

    state.call(remotePeerId, stream);
    return true;
  }

  /**
   * Answer an incoming call.
   * Uses attached media stream if available, or requires one in options.
   * Automatically holds any currently live call before answering.
   * Returns true if the call was answered, false if not found or already handled.
   */
  answer(callId: string, options?: AnswerOptions): boolean {
    const callState = this.requireCall('answer', callId, 'ringing');
    if (!callState) return false;

    let stream = options?.stream ?? this.pendingLocalStream;
    if (!stream) {
      this.log.warn(`answer() failed — no local stream available`);
      return false;
    }

    // Auto-hold any currently live call before answering
    this.holdAllLiveCalls();

    callState.answer(stream);
    return true;
  }

  /**
   * Reject an incoming call.
   * Returns true if the call was rejected, false if not found.
   */
  reject(callId: string): boolean {
    const callState = this.requireCall('reject', callId, 'ringing');
    if (!callState) return false;

    callState.reject();
    return true;
  }

  /**
   * Hang up an active call.
   * Returns true if the call was hung up, false if not found.
   */
  hangUp(callId: string): boolean {
    const callState = this.requireCall('hangUp', callId, 'live', 'connecting', 'held', 'remoteHeld');
    if (!callState) return false;

    callState.hangUp();
    return true;
  }

  // ── Hold / Resume ──────────────────────────────────────────────────────────

  /**
   * Put a live call on hold.
   * Returns true if the call was held, false if not found or not in live state.
   */
  hold(callId: string): boolean {
    const callState = this.requireCall('hold', callId, 'live');
    if (!callState) return false;

    callState.hold();
    return true;
  }

  /**
   * Resume a held call.
   * Automatically holds any currently live call before resuming.
   * Returns true if the call was resumed, false if not found or not in held state.
   */
  resume(callId: string): boolean {
    const callState = this.requireCall('resume', callId, 'held');
    if (!callState) return false;

    // Hold any currently live call first
    this.holdAllLiveCalls();

    callState.resume();
    return true;
  }

  /**
   * Check if there is any call currently in the live state.
   */
  private hasLiveCall(): boolean {
    const state = this.getState();
    if (state._tag !== 'ready') return false;
    for (const coordinator of state.calls.values()) {
      if (coordinator.callMachine.getState()._tag === 'live') return true;
    }
    return false;
  }

  /**
   * Hold all currently live calls. Used before answering a new call or resuming a held call.
   */
  private holdAllLiveCalls(): void {
    const state = this.getState();
    if (state._tag !== 'ready') return;

    for (const coordinator of state.calls.values()) {
      const callState = coordinator.callMachine.getState();
      if (callState._tag === 'live') {
        this.log.info(`  auto-holding live call "${callState.callId}"`);
        callState.hold();
      }
    }
  }

  // ── Query Methods (Immutable Snapshots) ─────────────────────────────────────

  /**
   * Returns true when there are held calls but no live call.
   * The UI should show a call picker when this is true.
   */
  get needsCallSelection(): boolean {
    const state = this.getState();
    if (state._tag !== 'ready') return false;

    let hasLive = false;
    let hasHeld = false;

    for (const coordinator of state.calls.values()) {
      const tag = coordinator.callMachine.getState()._tag;
      if (tag === 'live') hasLive = true;
      if (tag === 'held') hasHeld = true;
    }

    return !hasLive && hasHeld;
  }

  /**
   * Get only the held calls. Useful for rendering a call picker.
   */
  getHeldCalls(): readonly CallInfo[] {
    return this.getActiveCalls().filter(c => c.state === 'held');
  }

  /**
   * Get an immutable snapshot of all active calls.
   */
  getActiveCalls(): readonly CallInfo[] {
    const state = this.getState();
    if (state._tag !== 'ready') {
      return [];
    }

    const calls: CallInfo[] = [];
    for (const [callId, coordinator] of state.calls) {
      const callState = coordinator.callMachine.getState();
      let direction: 'inbound' | 'outbound' = 'outbound';
      if (callState._tag === 'ringing') {
        direction = 'inbound';
      } else if ('direction' in callState) {
        direction = (callState as any).direction;
      }
      calls.push({
        callId,
        remotePeerId: callState.remotePeerId,
        state: callState._tag,
        direction,
      });
    }
    return calls;
  }

  /**
   * Get an immutable snapshot of all active connections.
   */
  getActiveConnections(): readonly ConnectionInfo[] {
    const state = this.getState();
    if (state._tag !== 'ready') {
      return [];
    }

    const connections: ConnectionInfo[] = [];
    for (const machine of state.connections.values()) {
      const connState = machine.getState();
      connections.push({
        connectionId: connState.connectionId,
        remotePeerId: connState.remotePeerId,
        state: connState._tag,
      });
    }
    return connections;
  }

  /**
   * Get the CallMachine for a specific call, or null if not found.
   * Use this for advanced access to the call's state machine.
   */
  getCallMachine(callId: string): CallMachine | null {
    const state = this.getState();
    if (state._tag !== 'ready') {
      return null;
    }
    const coordinator = state.calls.get(callId);
    return coordinator?.callMachine ?? null;
  }

  /**
   * Get the ConnectionMachine for a specific connection, or null if not found.
   * Use this for advanced access to the connection's state machine.
   */
  getConnectionMachine(connectionId: string): ConnectionMachine | null {
    const state = this.getState();
    if (state._tag !== 'ready') {
      return null;
    }
    return state.connections.get(connectionId) ?? null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  override destroy(): void {
    this.cleanupMediaSubscriptions();
    this.attachedMedia = null;
    this.pendingLocalStream = null;
    super.destroy();
  }
}
