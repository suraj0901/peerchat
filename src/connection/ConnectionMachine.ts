import type { DataConnection } from 'peerjs';
import { AbstractMachine } from '../core';
import { ConnectionConnectingState, type ConnectionContext, type ConnectionState } from './state';

export type DataListener = (connectionId: string, data: unknown) => void;

export class ConnectionMachine extends AbstractMachine<ConnectionState> {
  constructor(
    connection: DataConnection,
    connectionId: string,
    remotePeerId: string,
    onData: DataListener,
  ) {
    super();

    const ctx = this.createContext<ConnectionContext>({
      emitData: onData,
    });

    this.currentState = new ConnectionConnectingState(connection, connectionId, remotePeerId, ctx);
  }
}
