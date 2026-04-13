import type { Peer } from 'peerjs';
import { createLogger } from '../core/logger';
import { PeerReadyState, type PeerState } from './state';
import type { PeerEmittedEvent, PeerCallApi, PeerConnectionApi, PeerMediaApi, PeerQueryApi } from './types';
import type { CallInfo } from '../call/types';
import type { CallState } from '../call/state';
import type { ConnectionInfo } from '../connection/types';
import type { CallCoordinator } from '../call/CallCoordinator';
import type { ConnectionMachine } from '../connection/ConnectionMachine';
import type { MediaMachine } from '../media/MediaManager';
import { PeerMachine } from './PeerMachine';

// ── Call/Media options ────────────────────────────────────────────────────────

export interface CallOptions {
  stream?: MediaStream;
  audio?: boolean;
  video?: boolean;
}

export interface AnswerOptions {
  stream?: MediaStream;
}

// ── PeerManager (Facade) ─────────────────────────────────────────────────────

/**
 * The primary entry point for the peerchat library.
 *
 * Acts as a **facade** that delegates to:
 * - `PeerMachine` — peer lifecycle state machine
 * - `CallManager` — call lifecycle and coordination
 * - `ConnectionManager` — data channel management
 *
 * Consumers interact with `PeerManager` as if it were a single object. Internally,
 * the responsibilities are cleanly separated for maintainability.
 */
export class PeerManager implements PeerCallApi, PeerConnectionApi, PeerMediaApi, PeerQueryApi {
  private readonly log = createLogger('PeerManager');
  private readonly machine: PeerMachine;

  private attachedMedia: MediaMachine | null = null;
  private pendingLocalStream: MediaStream | null = null;
  private mediaSubscriptions: Array<{ unsubscribe: () => void }> = [];

  constructor(input: { peer: Peer; maxRetries?: number; baseRetryDelay?: number }) {
    const maxRetries = input.maxRetries ?? 5;
    const baseRetryDelay = input.baseRetryDelay ?? 1000;

    this.machine = new PeerMachine(input.peer, maxRetries, baseRetryDelay);
  }

  // ── Delegated Machine API ──────────────────────────────────────────────────

  /** Get the current peer state. */
  getState(): PeerState {
    return this.machine.getState();
  }

  /** Subscribe to any state changes. Returns an object with `unsubscribe()`. */
  subscribe(cb: () => void): { unsubscribe: () => void } {
    return this.machine.subscribe(cb);
  }

  /**
   * Register a typed event handler for a specific event type.
   * Returns an object with `unsubscribe()`.
   */
  on<T extends PeerEmittedEvent['type']>(
    type: T,
    handler: (event: Extract<PeerEmittedEvent, { type: T }>) => void,
  ): { unsubscribe: () => void } {
    return this.machine.on(type, handler);
  }

  /** Register a transition listener. Called whenever the state changes. */
  onTransition(listener: (next: PeerState, prev: PeerState) => void) {
    return this.machine.onTransition(listener);
  }

  /** Get a versioned snapshot for `useSyncExternalStore()` compatibility. */
  getSnapshot(): { state: PeerState; version: number } {
    return this.machine.getSnapshot();
  }

  /** Get the current version counter. Incremented on every state change. */
  getVersion(): number {
    return this.machine.getVersion();
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

    const coordinator = this.machine.callManager.getCall(callId);
    if (!coordinator) {
      this.log.warn(`${caller}() failed — call "${callId}" not found`);
      return null;
    }

    const callState = coordinator.getState();
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
    if (state) this.machine.connectionManager.connect(this.machine.peer, remotePeerId);
  }

  /**
   * Send data to a remote peer. Auto-connects if no open connection exists.
   * Returns true if the data was sent, false if no connection is available.
   */
  send(remotePeerId: string, data: unknown): boolean {
    const state = this.requireReady('send');
    if (!state) return false;

    // Find an open connection
    const connState = this.machine.connectionManager.getOpenConnection(remotePeerId);
    if (connState) {
      connState.send(data);
      return true;
    }

    // No open connection — try to create one
    this.log.debug(`send() — no open connection to "${remotePeerId}", connecting...`);
    this.machine.connectionManager.connect(this.machine.peer, remotePeerId);
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

    this.machine.callManager.call(this.machine.peer, remotePeerId, stream);
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
    return this.machine.callManager.hasLiveCall();
  }

  /**
   * Hold all currently live calls. Used before answering a new call or resuming a held call.
   */
  private holdAllLiveCalls(): void {
    const state = this.getState();
    if (state._tag !== 'ready') return;
    this.machine.callManager.holdAllLiveCalls();
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

    for (const coordinator of this.machine.callManager.getAll()) {
      const tag = coordinator.getStateTag();
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
    for (const coordinator of this.machine.callManager.getAll()) {
      calls.push(coordinator.getCallInfo());
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
    for (const machine of this.machine.connectionManager.getAll()) {
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
   * Get the CallCoordinator for a specific call, or null if not found.
   * Use this for advanced access to the call's state and subscriptions.
   */
  getCallMachine(callId: string): CallCoordinator | null {
    const state = this.getState();
    if (state._tag !== 'ready') {
      return null;
    }
    return this.machine.callManager.getCall(callId) ?? null;
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
    return this.machine.connectionManager.getConnection(connectionId) ?? null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  destroy(): void {
    this.cleanupMediaSubscriptions();
    this.attachedMedia = null;
    this.pendingLocalStream = null;
    this.machine.destroy();
  }
}
