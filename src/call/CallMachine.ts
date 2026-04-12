import type { MediaConnection } from 'peerjs';
import { AbstractMachine } from '../core';
import { createLogger } from '../core/logger';
import { CallRingingState, CallConnectingState, type CallContext, type CallState } from './state';
import type { CallDirection } from './state';

export type OnCallEndedCallback = (reason: 'rejected' | 'declined', callId: string) => void;

export class CallMachine extends AbstractMachine<CallState> {
  protected readonly log = createLogger('CallMachine');

  constructor(
    call: MediaConnection,
    callId: string,
    remotePeerId: string,
    direction: CallDirection,
    onCallEnded: OnCallEndedCallback = () => {},
  ) {
    super();

    this.log.info(`🔧 CallMachine created — ${direction} call "${callId}" with "${remotePeerId}"`);

    const ctx = this.createContext<CallContext>({
      onCallEnded,
    });

    if (direction === 'inbound') {
      this.currentState = new CallRingingState(call, callId, remotePeerId, ctx);
    } else {
      this.currentState = new CallConnectingState(call, callId, remotePeerId, direction, ctx);
    }
  }
}
