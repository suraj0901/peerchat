import type { Peer, PeerError, MediaConnection, DataConnection } from 'peerjs';
import { CallMachine } from '../call/CallMachine';
import { ConnectionMachine } from '../connection/ConnectionMachine';
import type { CallState } from '../call/state';
import type { ConnectionState } from '../connection/state';
import type {
  PeerState,
  PeerEmittedEvent,
  PeerInput,
} from './types';
import { isFatalError } from './types';

// ── PeerManager (Class-Based) ──────────────────────────────────────────────────

export class PeerManager {
  private peer: Peer;
  private maxRetries: number;
  private baseRetryDelay: number;
  private retryCount = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  private state: PeerState;
  private eventListeners = new Set<(event: PeerEmittedEvent) => void>();
  private stateSubscribers = new Set<() => void>();

  constructor(input: PeerInput) {
    this.peer = input.peer;
    this.maxRetries = input.maxRetries ?? 5;
    this.baseRetryDelay = input.baseRetryDelay ?? 1000;

    this.state = {
      _tag: 'initializing',
      peer: this.peer,
      maxRetries: this.maxRetries,
      baseRetryDelay: this.baseRetryDelay,
    };

    this.setupListeners();
  }

  // ── Observability ───────────────────────────────────────────────────────────

  public on<T extends PeerEmittedEvent['type']>(
    eventType: T,
    listener: (event: Extract<PeerEmittedEvent, { type: T }>) => void
  ) {
    const wrapper = (e: PeerEmittedEvent) => {
      if (e.type === eventType) listener(e as any);
    };
    this.eventListeners.add(wrapper);
    return { unsubscribe: () => { this.eventListeners.delete(wrapper); } };
  }

  public subscribe(listener: () => void) {
    this.stateSubscribers.add(listener);
    return { unsubscribe: () => this.stateSubscribers.delete(listener) };
  }

  public getState(): PeerState {
    return this.state;
  }

  private setState(newState: PeerState) {
    this.state = newState;
    this.stateSubscribers.forEach((s) => s());
  }

  private emit(event: PeerEmittedEvent) {
    this.eventListeners.forEach((l) => l(event));
  }

  // ── Public Commands ─────────────────────────────────────────────────────────

  public connect(remotePeerId: string) {
    if (this.state._tag !== 'ready') return;
    
    // Prevent duplicate
    for (const childMachine of this.state.connections.values()) {
      const child = childMachine.getState();
      if ((child._tag === 'connecting' || child._tag === 'open') && child.remotePeerId === remotePeerId) {
        return;
      }
    }

    const connection = this.peer.connect(remotePeerId);
    const child = this.spawnConnectionChild(connection, connection.connectionId, remotePeerId);
    
    const newConns = new Map(this.state.connections);
    newConns.set(connection.connectionId, child);
    
    this.setState({ ...this.state, connections: newConns });
  }

  public call(remotePeerId: string, localStream: MediaStream) {
    if (this.state._tag !== 'ready') return;

    // Prevent duplicate
    for (const childMachine of this.state.calls.values()) {
      const child = childMachine.getState();
      if ((child._tag === 'ringing' || child._tag === 'connecting' || child._tag === 'live') && child.remotePeerId === remotePeerId) {
        return;
      }
    }

    const call = this.peer.call(remotePeerId, localStream);
    const child = this.spawnCallChild(call, call.connectionId, remotePeerId, 'outbound');
    
    const newCalls = new Map(this.state.calls);
    newCalls.set(call.connectionId, child);
    
    this.setState({ ...this.state, calls: newCalls });
  }

  public reconnect() {
    if (this.state._tag !== 'disconnected') return;
    
    this.cleanupChildren();
    clearTimeout(this.reconnectTimer);
    
    this.setState({
      _tag: 'initializing',
      peer: this.peer,
      maxRetries: this.maxRetries,
      baseRetryDelay: this.baseRetryDelay,
    });
    
    this.peer.reconnect();
  }

  public destroy() {
    if (this.state._tag === 'destroyed') return;
    
    this.cleanupChildren();
    clearTimeout(this.reconnectTimer);
    
    this.setState({ _tag: 'destroyed' });
    this.peer.destroy(); // also cleans up peer listeners
  }

  // ── Internal PeerJS Callbacks ───────────────────────────────────────────────

  private setupListeners() {
    this.peer.on('open', this.onOpen);
    this.peer.on('connection', this.onConnection);
    this.peer.on('call', this.onIncomingCall);
    this.peer.on('disconnected', this.onDisconnected);
    this.peer.on('error', this.onError);
    this.peer.on('close', this.onClose);
  }

  private onOpen = (id: string) => {
    if (this.state._tag === 'initializing') {
      this.retryCount = 0;
      this.setState({
        _tag: 'ready',
        peer: this.peer,
        peerId: id,
        connections: new Map(),
        calls: new Map(),
        maxRetries: this.maxRetries,
        baseRetryDelay: this.baseRetryDelay,
      });
      this.emit({ type: 'peer.ready', peerId: id });
    }
  };

  private onConnection = (connection: DataConnection) => {
    if (this.state._tag !== 'ready') return;
    const child = this.spawnConnectionChild(connection, connection.connectionId, connection.peer);
    
    const newConns = new Map(this.state.connections);
    newConns.set(connection.connectionId, child);
    
    this.setState({ ...this.state, connections: newConns });
  };

  private onIncomingCall = (call: MediaConnection) => {
    if (this.state._tag !== 'ready') return;
    const child = this.spawnCallChild(call, call.connectionId, call.peer, 'inbound');
    
    const newCalls = new Map(this.state.calls);
    newCalls.set(call.connectionId, child);
    
    this.setState({ ...this.state, calls: newCalls });
    this.emit({ type: 'call.incoming', callId: call.connectionId, remotePeerId: call.peer });
  };

  private onDisconnected = () => {
    if (this.state._tag === 'destroyed' || this.state._tag === 'error') return;

    let calls = new Map<string, CallMachine>();
    let conns = new Map<string, ConnectionMachine>();
    
    if (this.state._tag === 'ready' || this.state._tag === 'disconnected') {
      calls = this.state.calls;
      conns = this.state.connections;
    }

    this.setState({
      _tag: 'disconnected',
      peer: this.peer,
      peerId: this.state._tag === 'ready' || this.state._tag === 'disconnected' ? this.state.peerId : '',
      connections: conns,
      calls: calls,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      baseRetryDelay: this.baseRetryDelay,
    });
    
    this.emit({ type: 'peer.disconnected' });

    // Auto-reconnect logic
    if (this.retryCount < this.maxRetries) {
      const delay = Math.min(this.baseRetryDelay * 2 ** this.retryCount, 30_000);
      this.retryCount++;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        if (this.state._tag !== 'disconnected') return;
        this.reconnect();
      }, delay);
    }
  };

  private onError = (error: PeerError<string>) => {
    if (isFatalError(error)) {
      this.cleanupChildren();
      this.setState({ _tag: 'error', lastError: error });
    }
    this.emit({ type: 'peer.error', error });
  };

  private onClose = () => {
    this.destroy();
  };

  // ── Child Helpers ───────────────────────────────────────────────────────────

  private cleanupChildren() {
    if (this.state._tag === 'ready' || this.state._tag === 'disconnected') {
      for (const conn of this.state.connections.values()) {
        try { conn.destroy(); } catch {}
      }
      for (const call of this.state.calls.values()) {
        try { call.destroy(); } catch {}
      }
    }
  }

  private spawnConnectionChild(connection: DataConnection, connectionId: string, remotePeerId: string): ConnectionMachine {
    const machine = new ConnectionMachine(connection, connectionId, remotePeerId, {
      emitConnectionOpened: (id, peerId) => this.emit({ type: 'connection.opened', connectionId: id, remotePeerId: peerId }),
      emitConnectionClosed: (id) => this.removeConnection(id, { type: 'connection.closed', connectionId: id }),
      emitConnectionError: (id, error) => this.removeConnection(id, { type: 'connection.error', connectionId: id, error }),
      emitConnectionData: (id, data) => this.emit({ type: 'connection.data', connectionId: id, data }),
    });

    machine.onTransition((newState) => {
      if (this.state._tag === 'ready' || this.state._tag === 'disconnected') {
        // Just trigger standard state update to notify React!
        const newConns = new Map(this.state.connections);
        newConns.set(connectionId, machine);
        this.setState({ ...this.state, connections: newConns });
      }
    });

    return machine;
  }

  private removeConnection(connectionId: string, event?: PeerEmittedEvent) {
    if (this.state._tag === 'ready' || this.state._tag === 'disconnected') {
      const child = this.state.connections.get(connectionId);
      if (child) child.destroy();
      const newConns = new Map(this.state.connections);
      newConns.delete(connectionId);
      this.setState({ ...this.state, connections: newConns });
    }
    if (event) this.emit(event);
  }

  private spawnCallChild(call: MediaConnection, callId: string, remotePeerId: string, direction: 'inbound' | 'outbound'): CallMachine {
    const machine = new CallMachine(call, callId, remotePeerId, direction, {
      emitCallActive: (id, peerId, stream) => this.emit({ type: 'call.active', callId: id, remotePeerId: peerId, remoteStream: stream }),
      emitCallEnded: (id) => this.removeCall(id, { type: 'call.ended', callId: id }),
      emitCallError: (id, error) => this.removeCall(id, { type: 'call.error', callId: id, error }),
    });

    machine.onTransition((newState) => {
      if (this.state._tag === 'ready' || this.state._tag === 'disconnected') {
        const newCalls = new Map(this.state.calls);
        newCalls.set(callId, machine);
        this.setState({ ...this.state, calls: newCalls });
      }
    });

    return machine;
  }

  private removeCall(callId: string, event?: PeerEmittedEvent) {
    if (this.state._tag === 'ready' || this.state._tag === 'disconnected') {
      const child = this.state.calls.get(callId);
      if (child) child.destroy();
      const newCalls = new Map(this.state.calls);
      newCalls.delete(callId);
      this.setState({ ...this.state, calls: newCalls });
    }
    if (event) this.emit(event);
  }
}
