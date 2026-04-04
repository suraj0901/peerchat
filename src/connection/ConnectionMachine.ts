import type { DataConnection } from 'peerjs';
import { AbstractMachine } from '../core';
import { createLogger } from '../core/logger';
import { ConnectionConnectingState, type ConnectionContext, type ConnectionState } from './state';

export type DataListener = (connectionId: string, data: unknown) => void;

export class ConnectionMachine extends AbstractMachine<ConnectionState> {
  protected readonly log = createLogger('ConnectionMachine');

  constructor(
    connection: DataConnection,
    connectionId: string,
    remotePeerId: string,
    onData: DataListener,
  ) {
    super();

    this.log.info(`🔧 ConnectionMachine created for "${remotePeerId}" (id: ${connectionId})`);

    const ctx = this.createContext<ConnectionContext>({
      emitData: onData,
    });

    this.currentState = new ConnectionConnectingState(connection, connectionId, remotePeerId, ctx);
  }
}
