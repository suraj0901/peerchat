import type { MediaConnection, PeerError } from 'peerjs';

import { isState, type MachineContext } from '../core';
import { createLogger } from '../core/logger';

const log = createLogger('call');

export type CallDirection = 'inbound' | 'outbound';

export type CallStateTag = 'ringing' | 'connecting' | 'live' | 'held' | 'remoteHeld' | 'ended' | 'error';

export interface CallContext extends MachineContext<CallState> {
  onCallEnded: (reason: 'rejected' | 'declined', callId: string) => void;
}

export interface BaseCallState {
  readonly _tag: CallStateTag;
  readonly callId: string;
  readonly remotePeerId: string;
  destroy(): void;
  is<T extends CallStateTag>(tag: T): this is Extract<CallState, { _tag: T }>;
}

const RINGING_TIMEOUT_MS = 30_000;
const CONNECTING_TIMEOUT_MS = 30_000;

// ── TrackController ──────────────────────────────────────────────────────────

/**
 * Encapsulates the fragile PeerJS internal access for track enable/disable.
 * All `(call as any).peerConnection` access is isolated here, making it
 * easy to find and fix if PeerJS changes its internal structure.
 */
class TrackController {
  constructor(
    private readonly call: MediaConnection,
    private readonly remoteStream?: MediaStream,
  ) {}

  /**
   * Access the underlying RTCPeerConnection from PeerJS.
   * Returns null if the internal structure has changed.
   */
  private getPeerConnection(): RTCPeerConnection | null {
    // PeerJS stores the peer connection on the MediaConnection instance.
    // This is an undocumented internal — if PeerJS changes, update here.
    const pc = (this.call as any).peerConnection as RTCPeerConnection | undefined;
    if (!pc) {
      log.warn('TrackController: peerConnection not found — PeerJS internals may have changed');
    }
    return pc ?? null;
  }

  /** Disable all outgoing local tracks. */
  disableLocal(): void {
    const pc = this.getPeerConnection();
    if (pc) {
      for (const sender of pc.getSenders()) {
        if (sender.track) sender.track.enabled = false;
      }
    }
  }

  /** Re-enable all outgoing local tracks. */
  enableLocal(): void {
    const pc = this.getPeerConnection();
    if (pc) {
      for (const sender of pc.getSenders()) {
        if (sender.track) sender.track.enabled = true;
      }
    }
  }

  /** Disable all remote incoming tracks. */
  disableRemote(): void {
    this.remoteStream?.getTracks().forEach(t => (t.enabled = false));
  }

  /** Re-enable all remote incoming tracks. */
  enableRemote(): void {
    this.remoteStream?.getTracks().forEach(t => (t.enabled = true));
  }

  /** Disable both local outgoing and remote incoming tracks (for hold). */
  holdAll(): void {
    this.disableLocal();
    this.disableRemote();
  }

  /** Re-enable both local outgoing and remote incoming tracks (for resume). */
  resumeAll(): void {
    this.enableLocal();
    this.enableRemote();
  }
}

// ── CallRingingState ─────────────────────────────────────────────────────────

export class CallRingingState implements BaseCallState {
  public readonly _tag = 'ringing';
  public readonly direction = 'inbound';
  private timer: ReturnType<typeof setTimeout>;

  constructor(
    public readonly call: MediaConnection,
    public readonly callId: string,
    public readonly remotePeerId: string,
    private ctx: CallContext
  ) {
    log.info(`🔔 CallRingingState[${callId}] — inbound call from "${remotePeerId}"`);
    this.timer = setTimeout(this.onTimeout, RINGING_TIMEOUT_MS);
    this.call.on('close', this.onClose);
    this.call.on('error', this.onError);
  }

  public answer(localStream: MediaStream): void {
    log.info(`  call[${this.callId}].answer() — answering with local stream (${localStream.getTracks().length} tracks)`);
    this.destroy();
    this.call.answer(localStream);
    const next = new CallConnectingState(this.call, this.callId, this.remotePeerId, 'inbound', this.ctx);
    this.ctx.transition(next);
  }

  public reject(): void {
    log.info(`  call[${this.callId}].reject()`);
    this.ctx.onCallEnded('rejected', this.callId);
    this.destroy();
    this.call.close();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
  }

  private onClose = () => {
    log.warn(`⚠️ call[${this.callId}] "close" while ringing — caller hung up`);
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
  };

  private onError = (error: Error | PeerError<string>) => {
    log.error(`❌ call[${this.callId}] "error" while ringing`, error);
    this.handleFatalError(error);
  };

  private onTimeout = () => {
    log.error(`⏱ call[${this.callId}] ringing timed out after ${RINGING_TIMEOUT_MS}ms`);
    this.handleFatalError(new Error('Call ringing timed out'));
  };

  private handleFatalError(error: Error | PeerError<string>) {
    this.destroy();
    this.call.close();
    const next = new CallErrorState(this.callId, this.remotePeerId, error);
    this.ctx.transition(next);
  }

  public destroy() {
    log.debug(`  CallRingingState[${this.callId}].destroy()`);
    clearTimeout(this.timer);
    this.call.off('close', this.onClose);
    this.call.off('error', this.onError);
  }

  public is<T extends CallStateTag>(tag: T): this is Extract<CallState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── CallConnectingState ──────────────────────────────────────────────────────

export class CallConnectingState implements BaseCallState {
  public readonly _tag = 'connecting';
  private timer: ReturnType<typeof setTimeout>;

  constructor(
    public readonly call: MediaConnection,
    public readonly callId: string,
    public readonly remotePeerId: string,
    public readonly direction: CallDirection,
    private ctx: CallContext
  ) {
    log.info(`🔗 CallConnectingState[${callId}] — ${direction} call to "${remotePeerId}", waiting for "stream" event`);
    this.timer = setTimeout(this.onTimeout, CONNECTING_TIMEOUT_MS);
    this.call.on('stream', this.onStream);
    this.call.on('close', this.onClose);
    this.call.on('error', this.onError);
  }

  public hangUp() {
    log.info(`  call[${this.callId}].hangUp() while connecting`);
    if (this.direction === 'outbound') {
      this.ctx.onCallEnded('declined', this.callId);
    }
    this.destroy();
    this.call.close();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
  }

  private onStream = (stream: MediaStream) => {
    log.info(`✅ call[${this.callId}] "stream" received — ${stream.getTracks().length} track(s): ${stream.getTracks().map(t => `${t.kind}:${t.readyState}`).join(', ')}`);
    this.destroy();
    const next = new CallLiveState(this.call, this.callId, this.remotePeerId, this.direction, stream, this.ctx);
    this.ctx.transition(next);
  };

  private onClose = () => {
    log.warn(`⚠️ call[${this.callId}] "close" while connecting`);
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
  };

  private onError = (error: Error | PeerError<string>) => {
    log.error(`❌ call[${this.callId}] "error" while connecting`, error);
    this.handleFatalError(error);
  };

  private onTimeout = () => {
    log.error(`⏱ call[${this.callId}] connecting timed out after ${CONNECTING_TIMEOUT_MS}ms`);
    this.handleFatalError(new Error('Call connecting timed out'));
  };

  private handleFatalError(error: Error | PeerError<string>) {
    this.destroy();
    this.call.close();
    const next = new CallErrorState(this.callId, this.remotePeerId, error);
    this.ctx.transition(next);
  }

  public destroy() {
    log.debug(`  CallConnectingState[${this.callId}].destroy()`);
    clearTimeout(this.timer);
    this.call.off('stream', this.onStream);
    this.call.off('close', this.onClose);
    this.call.off('error', this.onError);
  }

  public is<T extends CallStateTag>(tag: T): this is Extract<CallState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── CallLiveState ────────────────────────────────────────────────────────────

export class CallLiveState implements BaseCallState {
  public readonly _tag = 'live';

  constructor(
    public readonly call: MediaConnection,
    public readonly callId: string,
    public readonly remotePeerId: string,
    public readonly direction: CallDirection,
    public readonly remoteStream: MediaStream,
    private ctx: CallContext
  ) {
    log.info(`🟢 CallLiveState[${callId}] — call is live with "${remotePeerId}"`);
    this.call.on('close', this.onClose);
    this.call.on('error', this.onError);
  }

  public hangUp(): CallEndedState {
    log.info(`  call[${this.callId}].hangUp() — ending live call`);
    this.destroy();
    this.call.close();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
    return next;
  }

  /**
   * Put this call on hold (local action).
   * Disables local outgoing and remote incoming tracks.
   */
  public hold(): CallHeldState {
    log.info(`  call[${this.callId}].hold() — putting call on hold`);
    this.destroy();
    const next = new CallHeldState(
      this.call, this.callId, this.remotePeerId,
      this.direction, this.remoteStream, this.ctx
    );
    this.ctx.transition(next);
    return next;
  }

  /**
   * Transition to remote-held state (triggered by incoming signaling message).
   */
  public remoteHeld(): CallRemoteHeldState {
    log.info(`  call[${this.callId}].remoteHeld() — remote peer held the call`);
    this.destroy();
    const next = new CallRemoteHeldState(
      this.call, this.callId, this.remotePeerId,
      this.direction, this.remoteStream, this.ctx
    );
    this.ctx.transition(next);
    return next;
  }

  private onClose = () => {
    log.warn(`⚠️ call[${this.callId}] "close" while live — remote hung up`);
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
  };

  private onError = (error: Error | PeerError<string>) => {
    log.error(`❌ call[${this.callId}] "error" while live`, error);
    this.destroy();
    const next = new CallErrorState(this.callId, this.remotePeerId, error);
    this.ctx.transition(next);
  };

  public destroy() {
    log.debug(`  CallLiveState[${this.callId}].destroy()`);
    this.call.off('close', this.onClose);
    this.call.off('error', this.onError);
  }

  public is<T extends CallStateTag>(tag: T): this is Extract<CallState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── CallHeldState ────────────────────────────────────────────────────────────

/**
 * The local user has put this call on hold.
 * Local outgoing tracks are disabled via RTCPeerConnection senders.
 * Remote incoming tracks are disabled.
 * The WebRTC connection remains alive.
 */
export class CallHeldState implements BaseCallState {
  public readonly _tag = 'held';

  constructor(
    public readonly call: MediaConnection,
    public readonly callId: string,
    public readonly remotePeerId: string,
    public readonly direction: CallDirection,
    public readonly remoteStream: MediaStream,
    private ctx: CallContext
  ) {
    log.info(`⏸ CallHeldState[${callId}] — call held with "${remotePeerId}"`);

    // Disable all tracks (local outgoing + remote incoming)
    new TrackController(call, remoteStream).holdAll();

    this.call.on('close', this.onClose);
    this.call.on('error', this.onError);
  }

  /**
   * Resume this held call — transitions back to CallLiveState.
   * Re-enables local outgoing and remote incoming tracks.
   */
  public resume(): void {
    log.info(`  call[${this.callId}].resume() — resuming held call`);

    // Re-enable all tracks
    new TrackController(this.call, this.remoteStream).resumeAll();

    this.destroy();
    const next = new CallLiveState(
      this.call, this.callId, this.remotePeerId,
      this.direction, this.remoteStream, this.ctx
    );
    this.ctx.transition(next);
  }

  /** Hang up while held — ends the call entirely */
  public hangUp(): CallEndedState {
    log.info(`  call[${this.callId}].hangUp() — ending held call`);
    this.destroy();
    this.call.close();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
    return next;
  }

  private onClose = () => {
    log.warn(`⚠️ call[${this.callId}] "close" while held — remote hung up`);
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
  };

  private onError = (error: Error | PeerError<string>) => {
    log.error(`❌ call[${this.callId}] "error" while held`, error);
    this.destroy();
    const next = new CallErrorState(this.callId, this.remotePeerId, error);
    this.ctx.transition(next);
  };

  public destroy() {
    log.debug(`  CallHeldState[${this.callId}].destroy()`);
    this.call.off('close', this.onClose);
    this.call.off('error', this.onError);
  }

  public is<T extends CallStateTag>(tag: T): this is Extract<CallState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── CallRemoteHeldState ──────────────────────────────────────────────────────

/**
 * The remote peer has put us on hold.
 * Remote tracks are disabled (remote stopped sending).
 * Local outgoing tracks are also disabled (no point sending when held).
 * The WebRTC connection remains alive.
 * Only the remote peer can resume — triggered by a `call_resumed` signaling message.
 */
export class CallRemoteHeldState implements BaseCallState {
  public readonly _tag = 'remoteHeld';

  constructor(
    public readonly call: MediaConnection,
    public readonly callId: string,
    public readonly remotePeerId: string,
    public readonly direction: CallDirection,
    public readonly remoteStream: MediaStream,
    private ctx: CallContext
  ) {
    log.info(`⏸ CallRemoteHeldState[${callId}] — remote peer held the call`);

    // Disable all tracks (local outgoing + remote incoming)
    new TrackController(call, remoteStream).holdAll();

    this.call.on('close', this.onClose);
    this.call.on('error', this.onError);
  }

  /**
   * Called when the remote peer resumes — transitions back to CallLiveState.
   * Triggered by CallCoordinator when it receives a `call_resumed` signaling message.
   */
  public remoteResumed(): void {
    log.info(`  call[${this.callId}].remoteResumed() — remote peer resumed the call`);

    // Re-enable all tracks
    new TrackController(this.call, this.remoteStream).resumeAll();

    this.destroy();
    const next = new CallLiveState(
      this.call, this.callId, this.remotePeerId,
      this.direction, this.remoteStream, this.ctx
    );
    this.ctx.transition(next);
  }

  /** Hang up while remote-held — ends the call entirely */
  public hangUp(): CallEndedState {
    log.info(`  call[${this.callId}].hangUp() — ending remote-held call`);
    this.destroy();
    this.call.close();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
    return next;
  }

  private onClose = () => {
    log.warn(`⚠️ call[${this.callId}] "close" while remote-held — remote hung up`);
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
  };

  private onError = (error: Error | PeerError<string>) => {
    log.error(`❌ call[${this.callId}] "error" while remote-held`, error);
    this.destroy();
    const next = new CallErrorState(this.callId, this.remotePeerId, error);
    this.ctx.transition(next);
  };

  public destroy() {
    log.debug(`  CallRemoteHeldState[${this.callId}].destroy()`);
    this.call.off('close', this.onClose);
    this.call.off('error', this.onError);
  }

  public is<T extends CallStateTag>(tag: T): this is Extract<CallState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── Terminal States ──────────────────────────────────────────────────────────

export class CallEndedState implements BaseCallState {
  public readonly _tag = 'ended';
  constructor(
    public readonly callId: string,
    public readonly remotePeerId: string,
  ) {
    log.info(`🔒 CallEndedState[${callId}]`);
  }
  public destroy() { }
  public is<T extends CallStateTag>(tag: T): this is Extract<CallState, { _tag: T }> {
    return isState(this, tag);
  }
}

export class CallErrorState implements BaseCallState {
  public readonly _tag = 'error';
  constructor(
    public readonly callId: string,
    public readonly remotePeerId: string,
    public readonly error: Error | PeerError<string>,
  ) {
    log.error(`💀 CallErrorState[${callId}]`, error);
  }
  public destroy() { }
  public is<T extends CallStateTag>(tag: T): this is Extract<CallState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── Union ────────────────────────────────────────────────────────────────────

export type CallState =
  | CallRingingState
  | CallConnectingState
  | CallLiveState
  | CallHeldState
  | CallRemoteHeldState
  | CallEndedState
  | CallErrorState;
