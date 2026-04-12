import type { DataConnection, Peer } from 'peerjs';
import { ConnectionMachine } from './ConnectionMachine';
import { createLogger } from '../core/logger';
import { isSignalingMessage, type SignalingService } from '../signaling';
import type { PeerContext } from '../peer/state';

const log = createLogger('ConnectionManager');

export class ConnectionManager {
  private readonly connections = new Map<string, ConnectionMachine>();

  constructor(
    private readonly ctx: PeerContext,
    private readonly signalingService: SignalingService
  ) {}

  /** Get all active connection machines */
  public getAll(): IterableIterator<ConnectionMachine> {
    return this.connections.values();
  }

  /** Get a connection machine by ID */
  public getConnection(connectionId: string): ConnectionMachine | undefined {
    return this.connections.get(connectionId);
  }

  /** Get an open connection state for a specific peer, if one exists */
  public getOpenConnection(remotePeerId: string) {
    for (const machine of this.connections.values()) {
      const child = machine.getState();
      if (child._tag === 'open' && child.remotePeerId === remotePeerId) {
        return child;
      }
    }
    return null;
  }

  /** Initiate a new outbound connection */
  public connect(peer: Peer, remotePeerId: string): void {
    log.info(`📤 connect("${remotePeerId}") called`);

    for (const machine of this.connections.values()) {
      const child = machine.getState();
      if ((child._tag === 'connecting' || child._tag === 'open') && child.remotePeerId === remotePeerId) {
        log.warn(`  → duplicate connection to "${remotePeerId}" — skipping (existing state: ${child._tag})`);
        return;
      }
    }

    const connection = peer.connect(remotePeerId);
    log.debug(`  → PeerJS connection created, connectionId: ${connection.connectionId}`);
    this.addConnection(connection, connection.connectionId, remotePeerId);
  }

  /** Handle an incoming connection from the network */
  public handleIncoming(connection: DataConnection): void {
    log.info(`📥 incoming connection from "${connection.peer}", connectionId: ${connection.connectionId}`);
    this.addConnection(connection, connection.connectionId, connection.peer);
  }

  private addConnection(connection: DataConnection, connectionId: string, remotePeerId: string): void {
    log.debug(`  spawning ConnectionMachine for "${remotePeerId}" (id: ${connectionId})`);
    
    const machine = new ConnectionMachine(
      connection,
      connectionId,
      remotePeerId,
      (id, data) => {
        if (isSignalingMessage(data)) {
          this.signalingService.handleMessage(id, data);
          return;
        }
        this.ctx.emit({ type: 'connection.data', connectionId: id, data });
      }
    );

    machine.onTransition((next, prev) => {
      log.info(`  connection[${connectionId}] child transition: ${prev._tag} → ${next._tag}`);
      
      if (next._tag === 'open' && prev._tag === 'connecting') {
        this.ctx.emit({ type: 'connection.opened', connectionId, remotePeerId });
      }
      
      if (next._tag === 'closed') {
        this.removeConnection(connectionId);
        this.ctx.emit({ type: 'connection.closed', connectionId });
        return;
      }
      
      if (next._tag === 'error') {
        this.removeConnection(connectionId);
        this.ctx.emit({ type: 'connection.error', connectionId, error: next.error });
        return;
      }
      
      this.ctx.notifyChange();
    });

    this.connections.set(connectionId, machine);
    this.ctx.bumpVersion();
  }

  public removeConnection(connectionId: string): void {
    log.debug(`  removing connection ${connectionId}`);
    const machine = this.connections.get(connectionId);
    if (machine) machine.destroy();
    this.connections.delete(connectionId);
    this.ctx.bumpVersion();
  }

  public cleanupAll(): void {
    log.debug(`  cleaning up ${this.connections.size} connection(s)`);
    for (const conn of this.connections.values()) {
      try {
        conn.destroy();
      } catch (e) {
        log.debug('  error during connection cleanup:', e);
      }
    }
    this.connections.clear();
    this.ctx.bumpVersion();
  }

  public destroy(): void {
    this.cleanupAll();
  }
}
