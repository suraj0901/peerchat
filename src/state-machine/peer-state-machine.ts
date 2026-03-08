import Peer from "peerjs";
import { StateMachine } from "./base-state-machine";
import { EventBindings } from "./event-bindings";

export type PeerState =
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'failed'
    | 'closed';

export type PeerEvent =
    | 'OPEN'
    | 'DISCONNECTED'
    | 'ERROR'
    | 'CLOSE'
    | 'RECONNECT';


const peerTransitions: Record<PeerState, Partial<Record<PeerEvent, PeerState>>> = {
    connecting: { OPEN: 'connected', ERROR: 'failed' },
    connected: { DISCONNECTED: 'disconnected', ERROR: 'failed', CLOSE: 'closed' },
    disconnected: { RECONNECT: 'connecting', ERROR: 'failed', CLOSE: 'closed' },
    failed: { CLOSE: 'closed' },
    closed: {}, // no transitions
};

/**
 * Wraps a PeerJS Peer instance and manages its signaling-server lifecycle.
 */
export class PeerStateMachine {
    public readonly stateMachine: StateMachine<PeerState, PeerEvent>;
    private readonly peer: Peer;
    private readonly bindings = new EventBindings();

    constructor(peer: Peer) {
        this.peer = peer;
        this.stateMachine = new StateMachine<PeerState, PeerEvent>('connecting', peerTransitions);

        this.bindings.bind(peer, 'open', () => this.stateMachine.transition('OPEN'));
        this.bindings.bind(peer, 'disconnected', () => this.stateMachine.transition('DISCONNECTED'));
        this.bindings.bind(peer, 'error', (err: any) => {
            console.error('Peer error:', err);
            this.stateMachine.transition('ERROR');
        });
        this.bindings.bind(peer, 'close', () => this.stateMachine.transition('CLOSE'));
    }

    /** Manually disconnect from the server (keeps peer ID). */
    disconnect(): void {
        if (!this.stateMachine.canTransition("DISCONNECTED")) {
            throw new Error(`Cannot disconnect while in state "${this.stateMachine.currentState}"`);
        }
        this.peer.disconnect();
        // The 'disconnected' event will trigger the transition
    }

    /** Attempt to reconnect after being disconnected. */
    reconnect(): void {
        if (!this.stateMachine.canTransition("RECONNECT")) {
            throw new Error(`Cannot reconnect while in state "${this.stateMachine.currentState}"`);
        }
        this.stateMachine.transition('RECONNECT');
        this.peer.reconnect();
    }

    /** Permanently destroy the peer. */
    destroy(): void {
        if (this.stateMachine.currentState === 'closed') return;
        this.peer.destroy();
        // The 'close' event will transition to closed, but we also clean up listeners.
        this.bindings.cleanup();
    }
}