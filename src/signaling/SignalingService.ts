import { createLogger } from '../core/logger';
import type { SignalingHandler, SignalingMessage, SignalingServiceConfig } from './types';

const log = createLogger('signaling');

export class SignalingService {
  private handlers: Map<string, SignalingHandler> = new Map();

  constructor(private config: SignalingServiceConfig) {}

  sendRemoteClose(callId: string, remotePeerId: string): void {
    log.debug(`Sending remote_close for call ${callId} to ${remotePeerId}`);
    const connection = this.config.getConnection(remotePeerId);
    if (connection) {
      log.debug(`  → found connection ${connection.connectionId}, sending remote_close`);
      connection.send({ type: 'remote_close', callId });
    } else {
      log.debug(`  → no open connection found for ${remotePeerId}`);
    }
  }

  sendCallRejected(callId: string, remotePeerId: string): void {
    log.debug(`Sending call_rejected for call ${callId} to ${remotePeerId}`);
    const connection = this.config.getConnection(remotePeerId);
    if (connection) {
      log.debug(`  → found connection ${connection.connectionId}, sending call_rejected`);
      connection.send({ type: 'call_rejected', callId });
    } else {
      log.debug(`  → no open connection found for ${remotePeerId}`);
    }
  }

  sendCallDeclined(callId: string, remotePeerId: string): void {
    log.debug(`Sending call_declined for call ${callId} to ${remotePeerId}`);
    const connection = this.config.getConnection(remotePeerId);
    if (connection) {
      log.debug(`  → found connection ${connection.connectionId}, sending call_declined`);
      connection.send({ type: 'call_declined', callId });
    } else {
      log.debug(`  → no open connection found for ${remotePeerId}`);
    }
  }

  handleMessage(connectionId: string, message: SignalingMessage): void {
    log.debug(`Received signaling message: ${message.type} on connection ${connectionId}`);
    
    if (message.type === 'remote_close') {
      log.info(`  → remote_close for callId ${message.callId}`);
      const handler = this.handlers.get(message.callId);
      if (handler) {
        handler(message, connectionId);
      } else {
        log.warn(`  → no handler registered for callId ${message.callId}`);
      }
      return;
    }

    if (message.type === 'call_rejected') {
      log.info(`  → call_rejected for callId ${message.callId}`);
      const handler = this.handlers.get(message.callId);
      if (handler) {
        handler(message, connectionId);
      } else {
        log.warn(`  → no handler registered for callId ${message.callId}`);
      }
      return;
    }

    if (message.type === 'call_declined') {
      log.info(`  → call_declined for callId ${message.callId}`);
      const handler = this.handlers.get(message.callId);
      if (handler) {
        handler(message, connectionId);
      } else {
        log.warn(`  → no handler registered for callId ${message.callId}`);
      }
      return;
    }
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