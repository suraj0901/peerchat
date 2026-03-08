import type { DataConnection } from "peerjs";
import { TypedEmitter } from "./typed-emitter";
import { DataConnectionStateMachine, type DataConnectionState } from "./state-machine";
import type { MappedState } from "./state-machine/base-state-machine";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ChannelStatus = "connecting" | "open" | "closed";

export type ChannelEvents = {
    status: (status: ChannelStatus) => void;
    message: (data: unknown) => void;
    error: (error: Error) => void;
};

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<DataConnectionState, ChannelStatus> = {
    connecting: "connecting",
    open: "open",
    closing: "closed",
    closed: "closed",
    error: "closed",
};

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/**
 * A high-level handle for a peer-to-peer data channel.
 *
 * Wraps the lower-level `DataConnectionStateMachine` and exposes a simple,
 * intent-based API: `send()`, `close()`, and events for status / messages.
 */
export class Channel extends TypedEmitter<ChannelEvents> {
    private readonly _sm: DataConnectionStateMachine;
    private readonly _mappedStatus: MappedState<ChannelStatus>;

    /** @internal — Use `PeerChat.connect()` or the `incomingConnection` event instead. */
    constructor(conn: DataConnection) {
        super();
        this._sm = new DataConnectionStateMachine(conn);

        // Derived status — single source of truth from the state machine
        this._mappedStatus = this._sm.stateMachine.mapState(s => STATUS_MAP[s]);
        this._mappedStatus.onChange((newStatus) => {
            this.emit("status", newStatus);
        });

        // Side-effects: error event
        this._sm.stateMachine.onStateChange((newState) => {
            if (newState === "error") {
                this.emit("error", new Error("Data connection error"));
            }
        });

        // --- wire data messages ---
        conn.on("data", (data: unknown) => {
            this.emit("message", data);
        });
    }

    // -- Read-only state -------------------------------------------------------

    get remotePeerId(): string {
        return (this._sm as any).conn.peer;
    }

    get status(): ChannelStatus {
        return this._mappedStatus.get();
    }

    // -- Actions ---------------------------------------------------------------

    /**
     * Send data to the remote peer.
     * @throws if the channel is not open.
     */
    send(data: unknown): void {
        this._sm.send(data);
    }

    /**
     * Close the channel. Idempotent — safe to call multiple times.
     */
    close(): void {
        if (this.status === "closed") return;
        this._sm.close();
    }
}
