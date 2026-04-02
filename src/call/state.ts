import type { MediaConnection, PeerError } from 'peerjs';

import type { MachineContext } from '../core';

export type CallDirection = 'inbound' | 'outbound';

export interface CallContext extends MachineContext<CallState> {
  emitCallActive: (callId: string, remotePeerId: string, stream: MediaStream) => void;
  emitCallEnded: (callId: string) => void;
  emitCallError: (callId: string, error: Error | PeerError<string>) => void;
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
    this.timer = setTimeout(this.onTimeout, RINGING_TIMEOUT_MS);
    this.call.on('close', this.onClose);
    this.call.on('error', this.onError);
  }

  public answer(localStream: MediaStream): CallConnectingState {
    this.destroy();
    this.call.answer(localStream);
    const next = new CallConnectingState(this.call, this.callId, this.remotePeerId, 'inbound', this.ctx);
    this.ctx.transition(next, this, 'ANSWER');
    return next;
  }

  public reject(): CallEndedState {
    this.destroy();
    this.call.close();
    const next = new CallEndedState(this.callId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'REJECT');
    this.ctx.emitCallEnded(this.callId);
    return next;
  }

  private onClose = () => {
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'CALL_CLOSE');
    this.ctx.emitCallEnded(this.callId);
  };

  private onError = (error: any) => {
    this.handleFatalError(error);
  };

  private onTimeout = () => {
    this.handleFatalError(new Error('Call ringing timed out'));
  };

  private handleFatalError(error: Error | PeerError<string>) {
    this.destroy();
    this.call.close();
    const next = new CallErrorState(this.callId, this.remotePeerId, error, this.ctx);
    this.ctx.transition(next, this, 'CALL_ERROR');
    this.ctx.emitCallError(this.callId, error);
  }

  public destroy() {
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
    this.timer = setTimeout(this.onTimeout, CONNECTING_TIMEOUT_MS);
    this.call.on('stream', this.onStream);
    this.call.on('close', this.onClose);
    this.call.on('error', this.onError);
  }

  public hangUp(): CallEndedState {
    this.destroy();
    this.call.close();
    const next = new CallEndedState(this.callId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'HANG_UP');
    this.ctx.emitCallEnded(this.callId);
    return next;
  }

  private onStream = (stream: MediaStream) => {
    this.destroy();
    const next = new CallLiveState(this.call, this.callId, this.remotePeerId, this.direction, stream, this.ctx);
    this.ctx.transition(next, this, 'CALL_STREAM');
    this.ctx.emitCallActive(this.callId, this.remotePeerId, stream);
  };

  private onClose = () => {
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'CALL_CLOSE');
    this.ctx.emitCallEnded(this.callId);
  };

  private onError = (error: any) => {
    this.handleFatalError(error);
  };

  private onTimeout = () => {
    this.handleFatalError(new Error('Call connecting timed out'));
  };

  private handleFatalError(error: Error | PeerError<string>) {
    this.destroy();
    this.call.close();
    const next = new CallErrorState(this.callId, this.remotePeerId, error, this.ctx);
    this.ctx.transition(next, this, 'CALL_ERROR');
    this.ctx.emitCallError(this.callId, error);
  }

  public destroy() {
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
    this.call.on('close', this.onClose);
    this.call.on('error', this.onError);
  }

  public hangUp(): CallEndedState {
    this.destroy();
    this.call.close();
    const next = new CallEndedState(this.callId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'HANG_UP');
    this.ctx.emitCallEnded(this.callId);
    return next;
  }

  private onClose = () => {
    this.destroy();
    const next = new CallEndedState(this.callId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'CALL_CLOSE');
    this.ctx.emitCallEnded(this.callId);
  };

  private onError = (error: any) => {
    this.destroy();
    const next = new CallErrorState(this.callId, this.remotePeerId, error, this.ctx);
    this.ctx.transition(next, this, 'CALL_ERROR');
    this.ctx.emitCallError(this.callId, error);
  };

  public destroy() {
    this.call.off('close', this.onClose);
    this.call.off('error', this.onError);
  }
}

export class CallEndedState implements BaseCallState {
  public readonly _tag = 'ended';
  constructor(
    public readonly callId: string,
    public readonly remotePeerId: string,
    private ctx: CallContext
  ) { }
  public destroy() { }
}

export class CallErrorState implements BaseCallState {
  public readonly _tag = 'error';
  constructor(
    public readonly callId: string,
    public readonly remotePeerId: string,
    public readonly error: Error | PeerError<string>,
    private ctx: CallContext
  ) { }
  public destroy() { }
}

export type CallState = CallRingingState | CallConnectingState | CallLiveState | CallEndedState | CallErrorState;
