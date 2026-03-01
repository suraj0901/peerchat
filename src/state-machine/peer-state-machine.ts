import Peer, { DataConnection, PeerOptions } from "peerjs";
import { StateMachine } from "./base-state-machine";
import { DataConnectionStateMachine } from "./data-connection-sm";
import { MediaConnectionStateMachine } from "./media-connection-sm";

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
* Wraps a PeerJS Peer instance and manages its state.
*/
export class PeerStateMachine {
    public readonly stateMachine: StateMachine<PeerState, PeerEvent>;
    private readonly peer: Peer; // Replace with actual Peer type from 'peerjs'
    private readonly eventListeners: Array<() => void> = [];

    constructor(peer: Peer) {
        this.peer = peer
        this.stateMachine = new StateMachine<PeerState, PeerEvent>('connecting', peerTransitions);

        // Listen to PeerJS events
        const openHandler = () => this.stateMachine.transition('OPEN');
        const disconnectedHandler = () => this.stateMachine.transition('DISCONNECTED');
        const errorHandler = (err: any) => {
            console.error('Peer error:', err);
            this.stateMachine.transition('ERROR');
        };
        const closeHandler = () => this.stateMachine.transition('CLOSE');

        this.peer.on('open', openHandler);
        this.peer.on('disconnected', disconnectedHandler);
        this.peer.on('error', errorHandler);
        this.peer.on('close', closeHandler);

        // Store cleanup functions
        this.eventListeners.push(
            () => this.peer.off('open', openHandler),
            () => this.peer.off('disconnected', disconnectedHandler),
            () => this.peer.off('error', errorHandler),
            () => this.peer.off('close', closeHandler)
        );
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
        this.cleanup();
    }

    call(remotePeerId: string, localStream: MediaStream) {
        const call = this.peer.call(remotePeerId, localStream);
        return new MediaConnectionStateMachine(call);
    }

    onIncomingCall(handler: (call: MediaConnectionStateMachine) => void) {
        const wrapper =  (call: any) => {
            const mediaConn = new MediaConnectionStateMachine(call, 'incoming')
            handler(mediaConn);
        }
        this.peer.on('call',  wrapper);
        this.eventListeners.push(() => this.peer.off('call', wrapper));
    }

    connect(remotePeerId: string) {
        const conn = this.peer.connect(remotePeerId);
        return new DataConnectionStateMachine(conn);
    }

    onIncomingConnection(handler: (conn: DataConnectionStateMachine) => void) {
        const wrapper = (conn: DataConnection) => {
            const dataConn = new DataConnectionStateMachine(conn);
            handler(dataConn);
        }
        this.peer.on('connection', wrapper);
        this.eventListeners.push(() => this.peer.off('connection', wrapper));
    }

    /** Clean up event listeners (internal). */
    private cleanup(): void {
        this.eventListeners.forEach(unsub => unsub());
        this.eventListeners.length = 0;
    }
}