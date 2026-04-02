import type { MediaConnection, PeerError } from 'peerjs';
import { AbstractMachine } from '../core';
import { CallRingingState, CallConnectingState, type CallContext, type CallState } from './state';
import type { CallDirection } from './state';

export interface CallParentEmitter {
  emitCallActive: (callId: string, remotePeerId: string, stream: MediaStream) => void;
  emitCallEnded: (callId: string) => void;
  emitCallError: (callId: string, error: Error | PeerError<string>) => void;
}

export class CallMachine extends AbstractMachine<CallState> {
  constructor(
    call: MediaConnection,
    callId: string,
    remotePeerId: string,
    direction: CallDirection,
    parentEmit: CallParentEmitter
  ) {
    super();
    
    const ctx = this.createContext<CallContext>({
      emitCallActive: parentEmit.emitCallActive,
      emitCallEnded: parentEmit.emitCallEnded,
      emitCallError: parentEmit.emitCallError,
    });
    
    if (direction === 'inbound') {
      this.currentState = new CallRingingState(call, callId, remotePeerId, ctx);
    } else {
      this.currentState = new CallConnectingState(call, callId, remotePeerId, direction, ctx);
    }
  }
}
