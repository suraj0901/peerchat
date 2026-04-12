import type { DataConnection, PeerError } from 'peerjs';
import { isState, type MachineContext } from '../core';
import { createLogger } from '../core/logger';

const log = createLogger('connection');

export interface ConnectionContext extends MachineContext<ConnectionState> {
  emitData: (connectionId: string, data: unknown) => void;
}

export type ConnectionStateTag = 'connecting' | 'open' | 'closed' | 'error';

export interface BaseConnectionState {
  readonly _tag: ConnectionStateTag;
  readonly connectionId: string;
  readonly remotePeerId: string;
  destroy(): void;
  is<T extends ConnectionStateTag>(tag: T): this is Extract<ConnectionState, { _tag: T }>;
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

  private onError = (error: Error | PeerError<string>) => {
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

  public is<T extends ConnectionStateTag>(tag: T): this is Extract<ConnectionState, { _tag: T }> {
    return isState(this, tag);
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

  private onError = (error: Error | PeerError<string>) => {
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

  public is<T extends ConnectionStateTag>(tag: T): this is Extract<ConnectionState, { _tag: T }> {
    return isState(this, tag);
  }
}

export abstract class BaseTerminalConnectionState implements BaseConnectionState {
  public abstract readonly _tag: ConnectionStateTag;

  constructor(
    public readonly connectionId: string,
    public readonly remotePeerId: string,
  ) {}

  public destroy() {}

  public is<T extends ConnectionStateTag>(tag: T): this is Extract<ConnectionState, { _tag: T }> {
    return isState(this as unknown as ConnectionState, tag);
  }
}

export class ConnectionClosedState extends BaseTerminalConnectionState {
  public readonly _tag = 'closed';
  constructor(
    connectionId: string,
    remotePeerId: string,
  ) {
    super(connectionId, remotePeerId);
    log.info(`🔒 ConnectionClosedState[${connectionId}]`);
  }
}

export class ConnectionErrorState extends BaseTerminalConnectionState {
  public readonly _tag = 'error';
  constructor(
    connectionId: string,
    remotePeerId: string,
    public readonly error: Error | PeerError<string>,
  ) {
    super(connectionId, remotePeerId);
    log.error(`💀 ConnectionErrorState[${connectionId}]`, error);
  }
}

export type ConnectionState =
  | ConnectionConnectingState
  | ConnectionOpenState
  | ConnectionClosedState
  | ConnectionErrorState;
