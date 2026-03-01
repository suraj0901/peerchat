import Peer, { type DataConnection, type MediaConnection, type PeerOptions } from "peerjs";
import { TypedEmitter } from "./typed-emitter";
import { PeerStateMachine } from "./state-machine";
import { MediaAcquirer } from "./media";
import { Call } from "./call";
import { Channel } from "./channel";
import { Option } from "./util";

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
    private _status: PeerChatStatus = "connecting";
    private _activeCall: Option<Call> = Option.none;

    constructor(id?: string, options?: PeerOptions) {
        super();
        this._peer = id ? new Peer(id, options) : options ? new Peer(options) : new Peer();
        this._peerSM = new PeerStateMachine(this._peer);

        // --- Map internal peer states → simplified public status ---
        this._peerSM.stateMachine.onStateChange((newState) => {
            switch (newState) {
                case "connected":
                    this._setStatus("ready");
                    break;
                case "disconnected":
                    this._setStatus("disconnected");
                    break;
                case "failed":
                    this.emit("error", new Error("Peer connection failed"));
                    this._setStatus("disconnected");
                    break;
                case "closed":
                    this._setStatus("destroyed");
                    break;
            }
        });

        // --- Incoming calls ---
        // Listen directly on the raw Peer so we can create high-level Call
        // objects without the intermediate MediaConnectionStateMachine.
        this._peer.on("call", (mediaConn: MediaConnection) => {
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

            this.emit("incomingCall", call);
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
        return this._status;
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

    // -- Internals -------------------------------------------------------------

    private _setStatus(status: PeerChatStatus): void {
        if (this._status === status) return;
        this._status = status;
        this.emit("status", status);
    }
}
