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

  // ── Public Commands ─────────────────────────────────────────────────────────

  public connect(remotePeerId: string) {
    const state = this.currentState;
    if (state._tag === 'ready') state.connect(remotePeerId);
  }

  public call(remotePeerId: string, localStream: MediaStream) {
    const state = this.currentState;
    if (state._tag === 'ready') state.call(remotePeerId, localStream);
  }

  public reconnect() {
    const state = this.currentState;
    if (state._tag === 'disconnected') state.reconnect();
  }

  public override destroy() {
    if (this.currentState._tag === 'destroyed') return;

    // Clean up children if in a state that has them
    const state = this.currentState;
    if (state._tag === 'ready' || state._tag === 'disconnected') {
      for (const conn of state.connections.values()) {
        try { conn.destroy(); } catch { /* ignore */ }
      }
      for (const call of state.calls.values()) {
        try { call.destroy(); } catch { /* ignore */ }
      }
    }

    super.destroy();
  }
}
