import type { DataConnection } from "peerjs";
import { TypedEmitter } from "./typed-emitter";
import { DataConnectionStateMachine } from "./state-machine";

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
    private _status: ChannelStatus;

    /** @internal — Use `PeerChat.connect()` or the `incomingConnection` event instead. */
    constructor(conn: DataConnection) {
        super();
        this._sm = new DataConnectionStateMachine(conn);
        this._status = this._sm.stateMachine.currentState === "open" ? "open" : "connecting";

        // --- wire internal state machine → public status --
        this._sm.stateMachine.onStateChange((newState) => {
            switch (newState) {
                case "open":
                    this._setStatus("open");
                    break;
                case "closed":
                case "closing":
                    this._setStatus("closed");
                    break;
                case "error":
                    this.emit("error", new Error("Data connection error"));
                    this._setStatus("closed");
                    break;
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
        return this._status;
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
        if (this._status === "closed") return;
        this._sm.close();
    }

    // -- Internals -------------------------------------------------------------

    private _setStatus(status: ChannelStatus): void {
        if (this._status === status) return;
        this._status = status;
        this.emit("status", status);
    }
}
