import type { DataConnection, PeerError } from 'peerjs';
import { AbstractMachine } from '../core';
import { ConnectionConnectingState, type ConnectionContext, type ConnectionState } from './state';

export interface ConnectionParentEmitter {
  emitConnectionOpened: (connectionId: string, remotePeerId: string) => void;
  emitConnectionClosed: (connectionId: string) => void;
  emitConnectionError: (connectionId: string, error: Error | PeerError<string>) => void;
  emitConnectionData: (connectionId: string, data: unknown) => void;
}

export class ConnectionMachine extends AbstractMachine<ConnectionState> {
  constructor(
    connection: DataConnection,
    connectionId: string,
    remotePeerId: string,
    parentEmit: ConnectionParentEmitter
  ) {
    super();
    
    const ctx = this.createContext<ConnectionContext>({
      emitConnectionOpened: parentEmit.emitConnectionOpened,
      emitConnectionClosed: parentEmit.emitConnectionClosed,
      emitConnectionError: parentEmit.emitConnectionError,
      emitConnectionData: parentEmit.emitConnectionData,
    });
    
    this.currentState = new ConnectionConnectingState(connection, connectionId, remotePeerId, ctx);
  }
}
