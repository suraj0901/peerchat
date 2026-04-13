import type { Peer } from 'peerjs';
import { AbstractMachine } from '../core';
import { createLogger } from '../core/logger';
import { PeerInitializingState, type PeerContext, type PeerState } from './state';
import type { PeerEmittedEvent } from './types';
import { ConnectionManager } from '../connection/ConnectionManager';
import { CallManager } from '../call/CallManager';
import { SignalingService } from '../signaling';

// ── PeerMachine ──────────────────────────────────────────────────────────────

/**
 * State machine for the PeerJS peer lifecycle.
 * Manages only state transitions (initializing → ready → disconnected → etc).
 * Business logic (calls, connections, media) is handled by PeerManager (facade).
 *
 * @internal This class is not part of the public API. Use PeerManager instead.
 */
export class PeerMachine extends AbstractMachine<PeerState, PeerEmittedEvent> {
  protected readonly log = createLogger('PeerManager');

  readonly connectionManager: ConnectionManager;
  readonly callManager: CallManager;
  readonly signalingService: SignalingService;

  constructor(
    readonly peer: Peer,
    maxRetries: number,
    baseRetryDelay: number,
  ) {
    super();
    this.log.info('🔧 PeerManager created', { maxRetries, baseRetryDelay, peerId: peer.id });

    const self = this;

    const ctx = this.createContext<PeerContext>({
      emit: (event) => this.emit(event),
      notifyChange: () => this.notifySubscribers(),
      bumpVersion: () => this.bumpVersion(),
      get connectionManager() { return self.connectionManager; },
      get callManager() { return self.callManager; },
    });

    this.signalingService = new SignalingService({
      getConnection: (remotePeerId) => this.connectionManager.getOpenConnection(remotePeerId),
      emit: (event) => this.emit(event),
      notifyChange: () => this.notifySubscribers(),
    });

    this.connectionManager = new ConnectionManager(ctx, this.signalingService);
    this.callManager = new CallManager(peer, ctx, this.signalingService, this.connectionManager);

    this.currentState = new PeerInitializingState(peer, maxRetries, baseRetryDelay, ctx);
  }
}
