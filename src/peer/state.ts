import type { Peer, PeerError, MediaConnection, DataConnection } from 'peerjs';
import type { MachineContext } from '../core';
import { CallMachine } from '../call/CallMachine';
import { ConnectionMachine } from '../connection/ConnectionMachine';
import type { CallState } from '../call/state';
import type { ConnectionState } from '../connection/state';
import { isFatalError, type PeerEmittedEvent } from './types';

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
    this.peer.on('open', this.onOpen);
    this.peer.on('error', this.onError);
    this.peer.on('close', this.onClose);
    this.peer.on('disconnected', this.onDisconnected);
  }

  private onOpen = (id: string) => {
    this.destroy();
    const next = new PeerReadyState(
      this.peer, id, new Map(), new Map(),
      this.maxRetries, this.baseRetryDelay, this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: 'peer.ready', peerId: id });
  };

  private onError = (error: PeerError<string>) => {
    if (isFatalError(error)) {
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: 'peer.error', error });
  };

  private onClose = () => {
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  private onDisconnected = () => {
    this.destroy();
    const next = new PeerDisconnectedState(
      this.peer, '', new Map(), new Map(), 0,
      this.maxRetries, this.baseRetryDelay, this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: 'peer.disconnected' });
  };

  public destroy() {
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
    this.peer.on('connection', this.onConnection);
    this.peer.on('call', this.onIncomingCall);
    this.peer.on('disconnected', this.onDisconnected);
    this.peer.on('error', this.onError);
    this.peer.on('close', this.onClose);
  }

  public connect(remotePeerId: string) {
    // Prevent duplicate
    for (const childMachine of this.connections.values()) {
      const child = childMachine.getState();
      if ((child._tag === 'connecting' || child._tag === 'open') && child.remotePeerId === remotePeerId) {
        return;
      }
    }

    const connection = this.peer.connect(remotePeerId);
    const child = this.spawnConnectionChild(connection, connection.connectionId, remotePeerId);
    this.connections.set(connection.connectionId, child);
    this.ctx.notifyChange();
  }

  public call(remotePeerId: string, localStream: MediaStream) {
    // Prevent duplicate
    for (const childMachine of this.calls.values()) {
      const child = childMachine.getState();
      if ((child._tag === 'ringing' || child._tag === 'connecting' || child._tag === 'live') && child.remotePeerId === remotePeerId) {
        return;
      }
    }

    const call = this.peer.call(remotePeerId, localStream);
    const child = this.spawnCallChild(call, call.connectionId, remotePeerId, 'outbound');
    this.calls.set(call.connectionId, child);
    this.ctx.notifyChange();
  }

  // ── PeerJS callbacks ─────────────────────────────────────────────────────

  private onConnection = (connection: DataConnection) => {
    const child = this.spawnConnectionChild(connection, connection.connectionId, connection.peer);
    this.connections.set(connection.connectionId, child);
    this.ctx.notifyChange();
  };

  private onIncomingCall = (call: MediaConnection) => {
    const child = this.spawnCallChild(call, call.connectionId, call.peer, 'inbound');
    this.calls.set(call.connectionId, child);
    this.ctx.notifyChange();
    this.ctx.emit({ type: 'call.incoming', callId: call.connectionId, remotePeerId: call.peer });
  };

  private onDisconnected = () => {
    this.destroy();
    const next = new PeerDisconnectedState(
      this.peer, this.peerId, this.connections, this.calls, 0,
      this.maxRetries, this.baseRetryDelay, this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: 'peer.disconnected' });
  };

  private onError = (error: PeerError<string>) => {
    if (isFatalError(error)) {
      this.cleanupChildren();
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: 'peer.error', error });
  };

  private onClose = () => {
    this.cleanupChildren();
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  // ── Child helpers ────────────────────────────────────────────────────────

  private spawnConnectionChild(connection: DataConnection, connectionId: string, remotePeerId: string): ConnectionMachine {
    const machine = new ConnectionMachine(
      connection, connectionId, remotePeerId,
      (id, data) => this.ctx.emit({ type: 'connection.data', connectionId: id, data }),
    );

    machine.onTransition((next, prev) => {
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
    const child = this.connections.get(connectionId);
    if (child) child.destroy();
    this.connections.delete(connectionId);
    this.ctx.notifyChange();
    if (event) this.ctx.emit(event);
  }

  private spawnCallChild(call: MediaConnection, callId: string, remotePeerId: string, direction: 'inbound' | 'outbound'): CallMachine {
    const machine = new CallMachine(call, callId, remotePeerId, direction);

    machine.onTransition((next, prev) => {
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
    const child = this.calls.get(callId);
    if (child) child.destroy();
    this.calls.delete(callId);
    this.ctx.notifyChange();
    if (event) this.ctx.emit(event);
  }

  private cleanupChildren() {
    for (const conn of this.connections.values()) {
      try { conn.destroy(); } catch { /* ignore */ }
    }
    for (const call of this.calls.values()) {
      try { call.destroy(); } catch { /* ignore */ }
    }
  }

  public destroy() {
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

    this.peer.on('error', this.onError);
    this.peer.on('close', this.onClose);

    // Auto-reconnect
    if (this.retryCount < this.maxRetries) {
      const delay = Math.min(this.baseRetryDelay * 2 ** this.retryCount, 30_000);
      this.retryCount++;
      this.reconnectTimer = setTimeout(() => {
        this.reconnect();
      }, delay);
    }
  }

  public reconnect() {
    this.cleanupChildren();
    this.destroy();
    const next = new PeerInitializingState(this.peer, this.maxRetries, this.baseRetryDelay, this.ctx);
    this.ctx.transition(next);
    this.peer.reconnect();
  }

  private onError = (error: PeerError<string>) => {
    if (isFatalError(error)) {
      this.cleanupChildren();
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: 'peer.error', error });
  };

  private onClose = () => {
    this.cleanupChildren();
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  private cleanupChildren() {
    for (const conn of this.connections.values()) {
      try { conn.destroy(); } catch { /* ignore */ }
    }
    for (const call of this.calls.values()) {
      try { call.destroy(); } catch { /* ignore */ }
    }
  }

  public destroy() {
    clearTimeout(this.reconnectTimer);
    this.peer.off('error', this.onError);
    this.peer.off('close', this.onClose);
  }
}

// ── Terminal States ──────────────────────────────────────────────────────────

export class PeerErrorState implements BasePeerState {
  public readonly _tag = 'error';
  constructor(public readonly lastError: PeerError<string>) { }
  public destroy() { }
}

export class PeerDestroyedState implements BasePeerState {
  public readonly _tag = 'destroyed';
  public destroy() { }
}

// ── Union ────────────────────────────────────────────────────────────────────

export type PeerState =
  | PeerInitializingState
  | PeerReadyState
  | PeerDisconnectedState
  | PeerErrorState
  | PeerDestroyedState;
