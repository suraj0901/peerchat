import { createLogger } from '../core/logger';
import type { SignalingHandler, SignalingMessage, SignalingServiceConfig } from './types';

const log = createLogger('signaling');

type SignalingMessageType = 'remote_close' | 'call_rejected' | 'call_declined' | 'call_held' | 'call_resumed';

export class SignalingService {
  private handlers: Map<string, SignalingHandler> = new Map();

  constructor(private config: SignalingServiceConfig) {}

  sendSignalingMessage(type: SignalingMessageType, callId: string, remotePeerId: string): void {
    log.debug(`Sending ${type} for call ${callId} to ${remotePeerId}`);
    const connection = this.config.getConnection(remotePeerId);
    if (connection) {
      log.debug(`  → found connection ${connection.connectionId}, sending ${type}`);
      connection.send({ type, callId });
    } else {
      log.debug(`  → no open connection found for ${remotePeerId}`);
    }
  }

  sendRemoteClose(callId: string, remotePeerId: string): void {
    this.sendSignalingMessage('remote_close', callId, remotePeerId);
  }

  sendCallRejected(callId: string, remotePeerId: string): void {
    this.sendSignalingMessage('call_rejected', callId, remotePeerId);
  }

  sendCallDeclined(callId: string, remotePeerId: string): void {
    this.sendSignalingMessage('call_declined', callId, remotePeerId);
  }

  sendCallHeld(callId: string, remotePeerId: string): void {
    this.sendSignalingMessage('call_held', callId, remotePeerId);
  }

  sendCallResumed(callId: string, remotePeerId: string): void {
    this.sendSignalingMessage('call_resumed', callId, remotePeerId);
  }

  handleMessage(connectionId: string, message: SignalingMessage): void {
    log.debug(`Received signaling message: ${message.type} on connection ${connectionId}`);

    const handler = this.handlers.get(message.callId);
    if (!handler) {
      log.warn(`  → no handler registered for callId ${message.callId}`);
      return;
    }

    handler(message, connectionId);
  }

  registerHandler(callId: string, handler: SignalingHandler): void {
    log.debug(`Registering handler for callId ${callId}`);
    this.handlers.set(callId, handler);
  }

  unregisterHandler(callId: string): void {
    log.debug(`Unregistering handler for callId ${callId}`);
    this.handlers.delete(callId);
  }
}