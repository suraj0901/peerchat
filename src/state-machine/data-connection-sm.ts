import { StateMachine } from "./base-state-machine";


export type DataConnectionState =
    | 'connecting'
    | 'open'
    | 'closing'
    | 'closed'
    | 'error';

export type DataConnectionEvent =
    | 'OPEN'
    | 'CLOSE'
    | 'ERROR'
    | 'LOCAL_CLOSE';

const dataConnectionTransitions: Record<DataConnectionState, Partial<Record<DataConnectionEvent, DataConnectionState>>> = {
    connecting: { OPEN: 'open', ERROR: 'error', CLOSE: 'closed' },
    open: { CLOSE: 'closed', ERROR: 'error', LOCAL_CLOSE: 'closing' },
    closing: { CLOSE: 'closed', ERROR: 'error' },
    closed: {},
    error: { CLOSE: 'closed' }, // after error, we can manually close to clean up
};

/**
 * Wraps a PeerJS DataConnection instance.
 */
export class DataConnectionStateMachine {
    public readonly stateMachine: StateMachine<DataConnectionState, DataConnectionEvent>;
    private readonly conn: any; // Replace with actual DataConnection type
    private readonly eventListeners: Array<() => void> = [];

    constructor(conn: any) {
        this.conn = conn;
        this.stateMachine = new StateMachine<DataConnectionState, DataConnectionEvent>('connecting', dataConnectionTransitions);

        const openHandler = () => this.stateMachine.transition('OPEN');
        const closeHandler = () => {
            this.stateMachine.transition('CLOSE');
            this.cleanup();
        }
        const errorHandler = (err: any) => {
            console.error('DataConnection error:', err);
            this.stateMachine.transition('ERROR');
        };

        conn.on('open', openHandler);
        conn.on('close', closeHandler);
        conn.on('error', errorHandler);

        this.eventListeners.push(
            () => conn.off('open', openHandler),
            () => conn.off('close', closeHandler),
            () => conn.off('error', errorHandler)
        );

        // If the connection is already open when we start listening, transition immediately
        if (conn.open) {
            this.stateMachine.transition('OPEN');
        }
    }

    /** Send data through the connection. */
    send(data: unknown): void {
        if (this.stateMachine.currentState !== 'open') {
            throw new Error(`Cannot send data while in state "${this.stateMachine.currentState}"`);
        }
        this.conn.send(data);
    }

    /** Close the connection locally. */
    close(): void {
        const state = this.stateMachine.currentState;
        if (state === 'closed' || state === 'closing') return;
        if (!this.stateMachine.canTransition("CLOSE")) {
            throw new Error(`Cannot close while in state "${state}"`);
        }
        this.stateMachine.transition('LOCAL_CLOSE');
        this.conn.close();
    }

    /** Clean up event listeners (internal). */
    private cleanup(): void {
        this.eventListeners.forEach(unsub => unsub());
        this.eventListeners.length = 0;
    }
}