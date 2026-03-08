import Peer, { type DataConnection, type MediaConnection, type PeerOptions } from "peerjs";
import { TypedEmitter } from "./typed-emitter";
import { PeerStateMachine, type PeerState } from "./state-machine";
import { MediaAcquirer } from "./media";
import { Call } from "./call";
import { Channel } from "./channel";
import { Option } from "./util";
import type { MappedState } from "./state-machine/base-state-machine";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PeerChatStatus = "connecting" | "ready" | "disconnected" | "destroyed";

export type PeerChatEvents = {
    status: (status: PeerChatStatus) => void;
    incomingCall: (call: Call) => void;
    incomingConnection: (channel: Channel) => void;
    error: (error: Error) => void;
};

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<PeerState, PeerChatStatus> = {
    connecting: "connecting",
    connected: "ready",
    disconnected: "disconnected",
    failed: "disconnected",
    closed: "destroyed",
};

// ---------------------------------------------------------------------------
// PeerChat
// ---------------------------------------------------------------------------

/**
 * The main entry point for PeerChat.
 *
 * Creates and manages a PeerJS connection, exposing a simple, intent-based
 * API for making calls and opening data channels.
 *
 * @example
 * ```ts
 * const peer = new PeerChat('my-id');
 *
 * peer.on('status', (status) => console.log('Peer status:', status));
 *
 * // Make a call
 * const callResult = await peer.call('friend-id');
 * if (callResult.isOk()) {
 *   const call = callResult.value;
 *   call.on('remoteStream', (stream) => { videoEl.srcObject = stream; });
 *   call.on('status', (s) => console.log('Call:', s));
 * }
 *
 * // Open a data channel
 * const channel = peer.connect('friend-id');
 * channel.on('status', (s) => { if (s === 'open') channel.send('hello!'); });
 * channel.on('message', (data) => console.log('Got:', data));
 *
 * // Handle incoming
 * peer.on('incomingCall', (call) => {
 *   call.answer();
 *   call.on('remoteStream', (stream) => { ... });
 * });
 * ```
 */
export class PeerChat extends TypedEmitter<PeerChatEvents> {
    private readonly _peerSM: PeerStateMachine;
    private readonly _peer: Peer;
    private readonly _mappedStatus: MappedState<PeerChatStatus>;
    private _activeCall: Option<Call> = Option.none;

    constructor(id?: string, options?: PeerOptions) {
        super();
        this._peer = id ? new Peer(id, options) : options ? new Peer(options) : new Peer();
        this._peerSM = new PeerStateMachine(this._peer);

        // Derived status — single source of truth from the state machine
        this._mappedStatus = this._peerSM.stateMachine.mapState(s => STATUS_MAP[s]);
        this._mappedStatus.onChange((newStatus) => {
            this.emit("status", newStatus);
        });

        // Side-effect: error event on 'failed' state
        this._peerSM.stateMachine.onStateChange((newState) => {
            if (newState === "failed") {
                this.emit("error", new Error("Peer connection failed"));
            }
        });

        // --- Incoming calls ---
        this._peer.on("call", (mediaConn: MediaConnection) => {
            this.emit("incomingCall", (constraints: MediaStreamConstraints = { audio: true, video: true }) => {

                const call = new Call(mediaConn, "incoming");

                // Auto-reject if already in a call
                if (Option.isSome(this._activeCall)) {
                    console.warn("Already in a call — automatically rejecting incoming call.");
                    call.reject();
                    return;
                }

                this._activeCall = Option.some(call);
                call.on("status", (status) => {
                    if (status === "ended") {
                        this._activeCall = Option.none;
                    }
                });
                return call;
            });
        });

        // --- Incoming data connections ---
        this._peer.on("connection", (dataConn: DataConnection) => {
            const channel = new Channel(dataConn);
            this.emit("incomingConnection", channel);
        });
    }

    // -- Read-only state -------------------------------------------------------

    /** The peer ID assigned by the signaling server. */
    get id(): string {
        return this._peer.id;
    }

    /** Current connection status. */
    get status(): PeerChatStatus {
        return this._mappedStatus.get();
    }

    // -- Actions ---------------------------------------------------------------

    /**
     * Start a media call to a remote peer.
     *
     * Acquires local media (camera + microphone by default) and initiates the
     * call. Returns a `ResultAsync` that resolves to a `Call` handle on success.
     */
    call(
        remotePeerId: string,
        constraints: MediaStreamConstraints = { audio: true, video: true },
    ) {
        if (Option.isSome(this._activeCall)) {
            throw new Error("Already in a call. Hang up first.");
        }

        return MediaAcquirer.getUserMedia(constraints).map((stream) => {
            const rawMediaConn = this._peer.call(remotePeerId, stream);
            const call = new Call(rawMediaConn, "outgoing");

            this._activeCall = Option.some(call);
            call.on("status", (status) => {
                if (status === "ended") {
                    this._activeCall = Option.none;
                }
            });

            return call;
        });
    }

    /**
     * Open a data channel to a remote peer.
     */
    connect(remotePeerId: string): Channel {
        const rawDataConn = this._peer.connect(remotePeerId);
        return new Channel(rawDataConn);
    }

    /**
     * Disconnect from the signaling server (keeps the peer ID for reconnect).
     */
    disconnect(): void {
        this._peerSM.disconnect();
    }

    /**
     * Reconnect to the signaling server after a disconnect.
     */
    reconnect(): void {
        this._peerSM.reconnect();
    }

    /**
     * Permanently destroy the peer. No further operations are possible.
     */
    destroy(): void {
        // End any active call
        if (Option.isSome(this._activeCall)) {
            this._activeCall.value.hangup();
            this._activeCall = Option.none;
        }
        this._peerSM.destroy();
        this.removeAllListeners();
    }
}
