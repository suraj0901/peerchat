import type { Peer } from 'peerjs';
import { createMachine, type Machine } from '../core';
import { createPeerTransition } from './transitions';
import type { PeerState, PeerEvent, PeerEmittedEvent, PeerInput, PeerEffect } from './types';

// ── PeerManager ───────────────────────────────────────────────────────────────

export type PeerMachine = Machine<PeerState, PeerEvent, PeerEmittedEvent>;

/**
 * Creates a peer state machine — manages PeerJS signaling, data connections,
 * and media calls.
 *
 * Child machines for connections and calls are spawned internally. Their
 * events bubble up as CHILD_* events and are re-emitted as user-facing
 * events (connection.opened, call.active, etc.).
 */
export function createPeerManager(input: PeerInput): PeerMachine {
  const initialState: PeerState = {
    _tag: 'initializing',
    peer: input.peer,
    maxRetries: input.maxRetries ?? 5,
    baseRetryDelay: input.baseRetryDelay ?? 1000,
  };

  // The peer transition function needs parentSend to spawn child machines
  // that route events back to the parent. We create the machine first,
  // then wire up the transition with a reference to the machine's send.
  let machineSend: ((event: PeerEvent) => void) | null = null;

  const transitionFn = createPeerTransition((event) => {
    // Deferred: machineSend is set after createMachine returns
    machineSend?.(event);
  });

  const startPeerListener: PeerEffect = {
    type: 'startSubscription',
    id: 'peerEvents',
    subscribe: (send) => {
      const peer = input.peer;
      peer.on('open', (id) => send({ type: 'PEER_OPEN', id }));
      peer.on('connection', (connection) => send({ type: 'PEER_CONNECTION', connection }));
      peer.on('call', (call) => send({ type: 'PEER_CALL', call }));
      peer.on('disconnected', () => send({ type: 'PEER_DISCONNECTED' }));
      peer.on('error', (error) => send({ type: 'PEER_ERROR', error }));
      peer.on('close', () => send({ type: 'PEER_CLOSE' }));

      return () => {
        // PeerJS does not support removeListener — teardown is via peer.destroy()
      };
    },
  };

  const machine = createMachine<PeerState, PeerEvent, PeerEmittedEvent>(
    transitionFn,
    initialState,
    [startPeerListener],
  );

  // Wire up the deferred reference
  machineSend = machine.send;

  return machine;
}
