import type { Peer, PeerError, MediaConnection, DataConnection } from 'peerjs';
import type { MachineContext } from '../core';
import { createLogger } from '../core/logger';
import { CallMachine } from '../call/CallMachine';
import { ConnectionMachine } from '../connection/ConnectionMachine';
import type { CallState } from '../call/state';
import type { ConnectionState } from '../connection/state';
import { isFatalError, type PeerEmittedEvent } from './types';

const log = createLogger('peer');

// ── Context ───────────────────────────────────────────────────────────────────

export interface PeerContext extends MachineContext<PeerState> {
  emit: (event: PeerEmittedEvent) => void;
  notifyChange: () => void;
}

// ── Base ──────────────────────────────────────────────────────────────────────

export interface BasePeerState {
  readonly _tag: 'initializing' | 'ready' | 'disconnected' | 'error' | 'destroyed';
  destroy(): void;
}

// ── PeerInitializingState ────────────────────────────────────────────────────

export class PeerInitializingState implements BasePeerState {
  public readonly _tag = 'initializing';

  constructor(
    public readonly peer: Peer,
    public readonly maxRetries: number,
    public readonly baseRetryDelay: number,
    private ctx: PeerContext,
  ) {
    log.info('🚀 PeerInitializingState created — waiting for PeerJS "open" event');
    log.debug('  peer.id =', peer.id, '| peer.open =', peer.open, '| peer.destroyed =', peer.destroyed);
    this.peer.on('open', this.onOpen);
    this.peer.on('error', this.onError);
    this.peer.on('close', this.onClose);
    this.peer.on('disconnected', this.onDisconnected);
  }

  private onOpen = (id: string) => {
    log.info(`✅ PeerJS "open" fired — peerId: ${id}`);
    this.destroy();
    const next = new PeerReadyState(
      this.peer, id, new Map(), new Map(),
      this.maxRetries, this.baseRetryDelay, this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: 'peer.ready', peerId: id });
  };

  private onError = (error: PeerError<string>) => {
    log.error('❌ PeerJS "error" during initialization', error.type, error.message);
    if (isFatalError(error)) {
      log.warn('  → fatal error — transitioning to error state');
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: 'peer.error', error });
  };

  private onClose = () => {
    log.warn('⚠️ PeerJS "close" during initialization — destroying peer');
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  private onDisconnected = () => {
    log.warn('⚠️ PeerJS "disconnected" during initialization');
    this.destroy();
    const next = new PeerDisconnectedState(
      this.peer, '', new Map(), new Map(), 0,
      this.maxRetries, this.baseRetryDelay, this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: 'peer.disconnected' });
  };

  public destroy() {
    log.debug('  PeerInitializingState.destroy() — unregistering PeerJS listeners');
    this.peer.off('open', this.onOpen);
    this.peer.off('error', this.onError);
    this.peer.off('close', this.onClose);
    this.peer.off('disconnected', this.onDisconnected);
  }
}

// ── PeerReadyState ───────────────────────────────────────────────────────────

export class PeerReadyState implements BasePeerState {
  public readonly _tag = 'ready';

  constructor(
    public readonly peer: Peer,
    public readonly peerId: string,
    public readonly connections: Map<string, ConnectionMachine>,
    public readonly calls: Map<string, CallMachine>,
    public readonly maxRetries: number,
    public readonly baseRetryDelay: number,
    private ctx: PeerContext,
  ) {
    log.info(`✅ PeerReadyState created — peerId: ${peerId}`);
    this.peer.on('connection', this.onConnection);
    this.peer.on('call', this.onIncomingCall);
    this.peer.on('disconnected', this.onDisconnected);
    this.peer.on('error', this.onError);
    this.peer.on('close', this.onClose);
  }

  public connect(remotePeerId: string) {
    log.info(`📤 connect("${remotePeerId}") called`);

    // Prevent duplicate
    for (const childMachine of this.connections.values()) {
      const child = childMachine.getState();
      if ((child._tag === 'connecting' || child._tag === 'open') && child.remotePeerId === remotePeerId) {
        log.warn(`  → duplicate connection to "${remotePeerId}" — skipping (existing state: ${child._tag})`);
        return;
      }
    }

    const connection = this.peer.connect(remotePeerId);
    log.debug(`  → PeerJS connection created, connectionId: ${connection.connectionId}`);
    const child = this.spawnConnectionChild(connection, connection.connectionId, remotePeerId);
    this.connections.set(connection.connectionId, child);
    this.ctx.notifyChange();
  }

  public call(remotePeerId: string, localStream: MediaStream) {
    log.info(`📞 call("${remotePeerId}") called`);

    // Prevent duplicate
    for (const childMachine of this.calls.values()) {
      const child = childMachine.getState();
      if ((child._tag === 'ringing' || child._tag === 'connecting' || child._tag === 'live') && child.remotePeerId === remotePeerId) {
        log.warn(`  → duplicate call to "${remotePeerId}" — skipping (existing state: ${child._tag})`);
        return;
      }
    }

    const call = this.peer.call(remotePeerId, localStream);
    log.debug(`  → PeerJS call created, callId: ${call.connectionId}`);
    const child = this.spawnCallChild(call, call.connectionId, remotePeerId, 'outbound');
    this.calls.set(call.connectionId, child);
    this.ctx.notifyChange();
  }

  // ── PeerJS callbacks ─────────────────────────────────────────────────────

  private onConnection = (connection: DataConnection) => {
    log.info(`📥 incoming connection from "${connection.peer}", connectionId: ${connection.connectionId}`);
    const child = this.spawnConnectionChild(connection, connection.connectionId, connection.peer);
    this.connections.set(connection.connectionId, child);
    this.ctx.notifyChange();
  };

  private onIncomingCall = (call: MediaConnection) => {
    log.info(`📥 incoming call from "${call.peer}", callId: ${call.connectionId}`);
    const child = this.spawnCallChild(call, call.connectionId, call.peer, 'inbound');
    this.calls.set(call.connectionId, child);
    this.ctx.notifyChange();
    this.ctx.emit({ type: 'call.incoming', callId: call.connectionId, remotePeerId: call.peer });
  };

  private onDisconnected = () => {
    log.warn('⚠️ PeerJS "disconnected" — peer lost connection to signaling server');
    this.destroy();
    const next = new PeerDisconnectedState(
      this.peer, this.peerId, this.connections, this.calls, 0,
      this.maxRetries, this.baseRetryDelay, this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: 'peer.disconnected' });
  };

  private onError = (error: PeerError<string>) => {
    log.error('❌ PeerJS "error" in ready state', error.type, error.message);
    if (isFatalError(error)) {
      log.warn('  → fatal error — cleaning up children and transitioning to error state');
      this.cleanupChildren();
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: 'peer.error', error });
  };

  private onClose = () => {
    log.warn('⚠️ PeerJS "close" in ready state — destroying peer');
    this.cleanupChildren();
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  // ── Child helpers ────────────────────────────────────────────────────────

  private spawnConnectionChild(connection: DataConnection, connectionId: string, remotePeerId: string): ConnectionMachine {
    log.debug(`  spawning ConnectionMachine for "${remotePeerId}" (id: ${connectionId})`);
    const machine = new ConnectionMachine(
      connection, connectionId, remotePeerId,
      (id, data) => this.ctx.emit({ type: 'connection.data', connectionId: id, data }),
    );

    machine.onTransition((next, prev) => {
      log.info(`  connection[${connectionId}] child transition: ${prev._tag} → ${next._tag}`);
      if (next._tag === 'open' && prev._tag === 'connecting') {
        this.ctx.emit({ type: 'connection.opened', connectionId, remotePeerId });
      }
      if (next._tag === 'closed') {
        this.removeConnection(connectionId, { type: 'connection.closed', connectionId });
        return;
      }
      if (next._tag === 'error') {
        this.removeConnection(connectionId, { type: 'connection.error', connectionId, error: next.error });
        return;
      }
      this.ctx.notifyChange();
    });

    return machine;
  }

  private removeConnection(connectionId: string, event?: PeerEmittedEvent) {
    log.debug(`  removing connection ${connectionId}`);
    const child = this.connections.get(connectionId);
    if (child) child.destroy();
    this.connections.delete(connectionId);
    this.ctx.notifyChange();
    if (event) this.ctx.emit(event);
  }

  private spawnCallChild(call: MediaConnection, callId: string, remotePeerId: string, direction: 'inbound' | 'outbound'): CallMachine {
    log.debug(`  spawning CallMachine for "${remotePeerId}" (id: ${callId}, direction: ${direction})`);
    const machine = new CallMachine(call, callId, remotePeerId, direction);

    machine.onTransition((next, prev) => {
      log.info(`  call[${callId}] child transition: ${prev._tag} → ${next._tag}`);
      if (next._tag === 'live' && prev._tag === 'connecting') {
        this.ctx.emit({ type: 'call.active', callId, remotePeerId, remoteStream: next.remoteStream });
      }
      if (next._tag === 'ended') {
        this.removeCall(callId, { type: 'call.ended', callId });
        return;
      }
      if (next._tag === 'error') {
        this.removeCall(callId, { type: 'call.error', callId, error: next.error });
        return;
      }
      this.ctx.notifyChange();
    });

    return machine;
  }

  private removeCall(callId: string, event?: PeerEmittedEvent) {
    log.debug(`  removing call ${callId}`);
    const child = this.calls.get(callId);
    if (child) child.destroy();
    this.calls.delete(callId);
    this.ctx.notifyChange();
    if (event) this.ctx.emit(event);
  }

  private cleanupChildren() {
    log.debug(`  cleaning up ${this.connections.size} connection(s) and ${this.calls.size} call(s)`);
    for (const conn of this.connections.values()) {
      try { conn.destroy(); } catch { /* ignore */ }
    }
    for (const call of this.calls.values()) {
      try { call.destroy(); } catch { /* ignore */ }
    }
  }

  public destroy() {
    log.debug('  PeerReadyState.destroy() — unregistering PeerJS listeners');
    this.peer.off('connection', this.onConnection);
    this.peer.off('call', this.onIncomingCall);
    this.peer.off('disconnected', this.onDisconnected);
    this.peer.off('error', this.onError);
    this.peer.off('close', this.onClose);
  }
}

// ── PeerDisconnectedState ────────────────────────────────────────────────────

export class PeerDisconnectedState implements BasePeerState {
  public readonly _tag = 'disconnected';
  private retryCount: number;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    public readonly peer: Peer,
    public readonly peerId: string,
    public readonly connections: Map<string, ConnectionMachine>,
    public readonly calls: Map<string, CallMachine>,
    initialRetryCount: number,
    public readonly maxRetries: number,
    public readonly baseRetryDelay: number,
    private ctx: PeerContext,
  ) {
    this.retryCount = initialRetryCount;
    log.warn(`⚠️ PeerDisconnectedState created — retryCount: ${this.retryCount}/${this.maxRetries}`);

    this.peer.on('error', this.onError);
    this.peer.on('close', this.onClose);

    // Auto-reconnect
    if (this.retryCount < this.maxRetries) {
      const delay = Math.min(this.baseRetryDelay * 2 ** this.retryCount, 30_000);
      this.retryCount++;
      log.info(`  🔄 scheduling auto-reconnect in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnect();
      }, delay);
    } else {
      log.warn('  → max retries exhausted — no auto-reconnect');
    }
  }

  public reconnect() {
    log.info('🔄 reconnect() — cleaning up children and re-initializing');
    this.cleanupChildren();
    this.destroy();
    const next = new PeerInitializingState(this.peer, this.maxRetries, this.baseRetryDelay, this.ctx);
    this.ctx.transition(next);
    this.peer.reconnect();
  }

  private onError = (error: PeerError<string>) => {
    log.error('❌ PeerJS "error" while disconnected', error.type, error.message);
    if (isFatalError(error)) {
      log.warn('  → fatal error — transitioning to error state');
      this.cleanupChildren();
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: 'peer.error', error });
  };

  private onClose = () => {
    log.warn('⚠️ PeerJS "close" while disconnected — destroying');
    this.cleanupChildren();
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  private cleanupChildren() {
    log.debug(`  cleaning up ${this.connections.size} connection(s) and ${this.calls.size} call(s)`);
    for (const conn of this.connections.values()) {
      try { conn.destroy(); } catch { /* ignore */ }
    }
    for (const call of this.calls.values()) {
      try { call.destroy(); } catch { /* ignore */ }
    }
  }

  public destroy() {
    log.debug('  PeerDisconnectedState.destroy()');
    clearTimeout(this.reconnectTimer);
    this.peer.off('error', this.onError);
    this.peer.off('close', this.onClose);
  }
}

// ── Terminal States ──────────────────────────────────────────────────────────

export class PeerErrorState implements BasePeerState {
  public readonly _tag = 'error';
  constructor(public readonly lastError: PeerError<string>) {
    log.error('💀 PeerErrorState created', lastError.type, lastError.message);
  }
  public destroy() { }
}

export class PeerDestroyedState implements BasePeerState {
  public readonly _tag = 'destroyed';
  constructor() {
    log.info('💀 PeerDestroyedState created');
  }
  public destroy() { }
}

// ── Union ────────────────────────────────────────────────────────────────────

export type PeerState =
  | PeerInitializingState
  | PeerReadyState
  | PeerDisconnectedState
  | PeerErrorState
  | PeerDestroyedState;
