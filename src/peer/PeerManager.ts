import type { Peer } from 'peerjs';
import { AbstractMachine } from '../core';
import { PeerInitializingState, type PeerContext, type PeerState } from './state';
import type { PeerEmittedEvent } from './types';

// ── PeerManager ──────────────────────────────────────────────────────────────

export class PeerManager extends AbstractMachine<PeerState, PeerEmittedEvent> {
  constructor(input: { peer: Peer; maxRetries?: number; baseRetryDelay?: number }) {
    super();

    const maxRetries = input.maxRetries ?? 5;
    const baseRetryDelay = input.baseRetryDelay ?? 1000;

    const ctx = this.createContext<PeerContext>({
      emit: (event) => this.emit(event),
      notifyChange: () => this.notifySubscribers(),
    });

    this.currentState = new PeerInitializingState(input.peer, maxRetries, baseRetryDelay, ctx);
  }
}
