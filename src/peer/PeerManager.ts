import type { Peer } from 'peerjs';
import { AbstractMachine } from '../core';
import { createLogger } from '../core/logger';
import { PeerInitializingState, type PeerContext, type PeerState, PEER_TRANSITIONS } from './state';
import type { PeerEmittedEvent } from './types';

// ── PeerManager ──────────────────────────────────────────────────────────────

export class PeerManager extends AbstractMachine<PeerState, PeerEmittedEvent> {
  protected readonly log = createLogger('PeerManager');

  constructor(input: { peer: Peer; maxRetries?: number; baseRetryDelay?: number }) {
    super();

    const maxRetries = input.maxRetries ?? 5;
    const baseRetryDelay = input.baseRetryDelay ?? 1000;

    this.log.info('🔧 PeerManager created', { maxRetries, baseRetryDelay, peerId: input.peer.id });

    this.transitionMap = PEER_TRANSITIONS;

    const ctx = this.createContext<PeerContext>({
      emit: (event) => this.emit(event),
      notifyChange: () => this.notifySubscribers(),
    });

    this.currentState = new PeerInitializingState(input.peer, maxRetries, baseRetryDelay, ctx);
  }
}
