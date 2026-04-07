import type { MediaConnection, PeerError } from 'peerjs';

import type { MachineContext } from '../core';
import { createLogger } from '../core/logger';

const log = createLogger('call');

export type CallDirection = 'inbound' | 'outbound';

export interface CallContext extends MachineContext<CallState> {
  sendRemoteCallEndedMessage: (reason: 'rejected' | 'declined', callId: string) => void;
}

export interface BaseCallState {
  readonly _tag: 'ringing' | 'connecting' | 'live' | 'ended' | 'error';
  readonly callId: string;
  readonly remotePeerId: string;
  destroy(): void;
}

const RINGING_TIMEOUT_MS = 30_000;
const CONNECTING_TIMEOUT_MS = 30_000;

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
    this.ctx.sendRemoteCallEndedMessage('rejected', this.callId);
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

  private onError = (error: any) => {
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
}

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
      this.ctx.sendRemoteCallEndedMessage('declined', this.callId);
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

  private onError = (error: any) => {
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
}

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

  private onClose = () => {
    log.warn(`⚠️ call[${this.callId}] "close" while live — remote hung up`);
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId);
    this.ctx.transition(next);
  };

  private onError = (error: any) => {
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
}

export class CallEndedState implements BaseCallState {
  public readonly _tag = 'ended';
  constructor(
    public readonly callId: string,
    public readonly remotePeerId: string,
  ) {
    log.info(`🔒 CallEndedState[${callId}]`);
  }
  public destroy() { }
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
}

export type CallState = CallRingingState | CallConnectingState | CallLiveState | CallEndedState | CallErrorState;
