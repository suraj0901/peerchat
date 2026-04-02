import type { DataConnection, PeerError } from 'peerjs';
import type { MachineContext } from '../core';

export interface ConnectionContext extends MachineContext<ConnectionState> {
  emitConnectionOpened: (connectionId: string, remotePeerId: string) => void;
  emitConnectionClosed: (connectionId: string) => void;
  emitConnectionError: (connectionId: string, error: Error | PeerError<string>) => void;
  emitConnectionData: (connectionId: string, data: unknown) => void;
}

export interface BaseConnectionState {
  readonly _tag: 'connecting' | 'open' | 'closed' | 'error';
  readonly connectionId: string;
  readonly remotePeerId: string;
  destroy(): void;
}

const CONNECTION_TIMEOUT_MS = 15_000;

export class ConnectionConnectingState implements BaseConnectionState {
  public readonly _tag = 'connecting';
  private timer: ReturnType<typeof setTimeout>;

  constructor(
    public readonly connection: DataConnection,
    public readonly connectionId: string,
    public readonly remotePeerId: string,
    private ctx: ConnectionContext
  ) {
    this.timer = setTimeout(this.onTimeout, CONNECTION_TIMEOUT_MS);
    this.connection.on('open', this.onOpen);
    this.connection.on('close', this.onClose);
    this.connection.on('error', this.onError);
  }

  private onOpen = () => {
    this.destroy();
    const next = new ConnectionOpenState(this.connection, this.connectionId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'CONNECTION_OPEN');
    this.ctx.emitConnectionOpened(this.connectionId, this.remotePeerId);
  };

  private onClose = () => {
    this.destroy();
    const next = new ConnectionClosedState(this.connectionId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'CONNECTION_CLOSE');
    this.ctx.emitConnectionClosed(this.connectionId);
  };

  private onError = (error: any) => {
    this.handleFatalError(error);
  };

  private onTimeout = () => {
    this.handleFatalError(new Error('Connection timed out'));
  };

  private handleFatalError(error: Error | PeerError<string>) {
    this.destroy();
    this.connection.close();
    const next = new ConnectionErrorState(this.connectionId, this.remotePeerId, error, this.ctx);
    this.ctx.transition(next, this, 'CONNECTION_ERROR');
    this.ctx.emitConnectionError(this.connectionId, error);
  }

  public destroy() {
    clearTimeout(this.timer);
    this.connection.off('open', this.onOpen);
    this.connection.off('close', this.onClose);
    this.connection.off('error', this.onError);
  }
}

export class ConnectionOpenState implements BaseConnectionState {
  public readonly _tag = 'open';

  constructor(
    public readonly connection: DataConnection,
    public readonly connectionId: string,
    public readonly remotePeerId: string,
    private ctx: ConnectionContext
  ) {
    this.connection.on('data', this.onData);
    this.connection.on('close', this.onClose);
    this.connection.on('error', this.onError);
  }

  public send(data: unknown) {
    this.connection.send(data);
  }

  public close(): ConnectionClosedState {
    this.destroy();
    this.connection.close();
    const next = new ConnectionClosedState(this.connectionId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'CLOSE');
    this.ctx.emitConnectionClosed(this.connectionId);
    return next;
  }

  private onData = (data: unknown) => {
    this.ctx.emitConnectionData(this.connectionId, data);
  };

  private onClose = () => {
    this.destroy();
    const next = new ConnectionClosedState(this.connectionId, this.remotePeerId, this.ctx);
    this.ctx.transition(next, this, 'CONNECTION_CLOSE');
    this.ctx.emitConnectionClosed(this.connectionId);
  };

  private onError = (error: any) => {
    this.destroy();
    const next = new ConnectionErrorState(this.connectionId, this.remotePeerId, error, this.ctx);
    this.ctx.transition(next, this, 'CONNECTION_ERROR');
    this.ctx.emitConnectionError(this.connectionId, error);
  };

  public destroy() {
    this.connection.off('data', this.onData);
    this.connection.off('close', this.onClose);
    this.connection.off('error', this.onError);
  }
}

export class ConnectionClosedState implements BaseConnectionState {
  public readonly _tag = 'closed';
  constructor(
    public readonly connectionId: string,
    public readonly remotePeerId: string,
    private ctx: ConnectionContext
  ) {}
  public destroy() {}
}

export class ConnectionErrorState implements BaseConnectionState {
  public readonly _tag = 'error';
  constructor(
    public readonly connectionId: string,
    public readonly remotePeerId: string,
    public readonly error: Error | PeerError<string>,
    private ctx: ConnectionContext
  ) {}
  public destroy() {}
}

export type ConnectionState =
  | ConnectionConnectingState
  | ConnectionOpenState
  | ConnectionClosedState
  | ConnectionErrorState;
