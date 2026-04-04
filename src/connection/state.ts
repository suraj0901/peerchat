import type { DataConnection, PeerError } from 'peerjs';
import type { MachineContext } from '../core';
import { createLogger } from '../core/logger';

const log = createLogger('connection');

export interface ConnectionContext extends MachineContext<ConnectionState> {
  emitData: (connectionId: string, data: unknown) => void;
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
    log.info(`🔗 ConnectionConnectingState[${connectionId}] → "${remotePeerId}" — waiting for "open" event`);
    log.debug(`  connection.open =`, connection.open, '| connection.type =', connection.type);
    this.timer = setTimeout(this.onTimeout, CONNECTION_TIMEOUT_MS);
    this.connection.on('open', this.onOpen);
    this.connection.on('close', this.onClose);
    this.connection.on('error', this.onError);
  }

  private onOpen = () => {
    log.info(`✅ connection[${this.connectionId}] "open" fired — connected to "${this.remotePeerId}"`);
    this.destroy();
    const next = new ConnectionOpenState(this.connection, this.connectionId, this.remotePeerId, this.ctx);
    this.ctx.transition(next);
  };

  private onClose = () => {
    log.warn(`⚠️ connection[${this.connectionId}] "close" fired while connecting`);
    this.destroy();
    const next = new ConnectionClosedState(this.connectionId, this.remotePeerId);
    this.ctx.transition(next);
  };

  private onError = (error: any) => {
    log.error(`❌ connection[${this.connectionId}] "error" while connecting`, error);
    this.handleFatalError(error);
  };

  private onTimeout = () => {
    log.error(`⏱ connection[${this.connectionId}] timed out after ${CONNECTION_TIMEOUT_MS}ms`);
    this.handleFatalError(new Error('Connection timed out'));
  };

  private handleFatalError(error: Error | PeerError<string>) {
    this.destroy();
    this.connection.close();
    const next = new ConnectionErrorState(this.connectionId, this.remotePeerId, error);
    this.ctx.transition(next);
  }

  public destroy() {
    log.debug(`  ConnectionConnectingState[${this.connectionId}].destroy()`);
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
    log.info(`✅ ConnectionOpenState[${connectionId}] — data channel open with "${remotePeerId}"`);
    this.connection.on('data', this.onData);
    this.connection.on('close', this.onClose);
    this.connection.on('error', this.onError);
  }

  public send(data: unknown) {
    log.debug(`  connection[${this.connectionId}].send()`, typeof data);
    this.connection.send(data);
  }

  public close(): ConnectionClosedState {
    log.info(`  connection[${this.connectionId}].close() called`);
    this.destroy();
    this.connection.close();
    const next = new ConnectionClosedState(this.connectionId, this.remotePeerId);
    this.ctx.transition(next);
    return next;
  }

  private onData = (data: unknown) => {
    log.debug(`  connection[${this.connectionId}] received data`, typeof data);
    this.ctx.emitData(this.connectionId, data);
  };

  private onClose = () => {
    log.warn(`⚠️ connection[${this.connectionId}] "close" fired — remote closed`);
    this.destroy();
    const next = new ConnectionClosedState(this.connectionId, this.remotePeerId);
    this.ctx.transition(next);
  };

  private onError = (error: any) => {
    log.error(`❌ connection[${this.connectionId}] "error" while open`, error);
    this.destroy();
    const next = new ConnectionErrorState(this.connectionId, this.remotePeerId, error);
    this.ctx.transition(next);
  };

  public destroy() {
    log.debug(`  ConnectionOpenState[${this.connectionId}].destroy()`);
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
  ) {
    log.info(`🔒 ConnectionClosedState[${connectionId}]`);
  }
  public destroy() {}
}

export class ConnectionErrorState implements BaseConnectionState {
  public readonly _tag = 'error';
  constructor(
    public readonly connectionId: string,
    public readonly remotePeerId: string,
    public readonly error: Error | PeerError<string>,
  ) {
    log.error(`💀 ConnectionErrorState[${connectionId}]`, error);
  }
  public destroy() {}
}

export type ConnectionState =
  | ConnectionConnectingState
  | ConnectionOpenState
  | ConnectionClosedState
  | ConnectionErrorState;
