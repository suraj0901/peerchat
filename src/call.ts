import type { MediaConnection } from "peerjs";
import { TypedEmitter } from "./typed-emitter";
import { MediaConnectionStateMachine, type MediaConnectionState } from "./state-machine";
import type { MappedState } from "./state-machine/base-state-machine";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CallStatus = "connecting" | "ringing" | "active" | "ended";

export type CallEvents = {
    status: (status: CallStatus) => void;
    remoteStream: (stream: MediaStream) => void;
    error: (error: Error) => void;
};

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<MediaConnectionState, CallStatus> = {
    connecting: "connecting",
    incoming: "ringing",
    active: "active",
    closing: "ended",
    closed: "ended",
    error: "ended",
};

// ---------------------------------------------------------------------------
// Call
// ---------------------------------------------------------------------------

/**
 * A high-level handle for a media call (audio/video).
 *
 * Wraps `MediaConnectionStateMachine` + `CallMediaManager` and exposes an
 * intent-based API: `answer()`, `reject()`, `hangup()`, and media controls.
 */
export class Call extends TypedEmitter<CallEvents> {
    private readonly _sm: MediaConnectionStateMachine;
    private readonly _mappedStatus: MappedState<CallStatus>;

    /** @internal — Use `PeerChat.call()` or the `incomingCall` event instead. */
    constructor(
        conn: MediaConnection,
        direction: "outgoing" | "incoming" = "outgoing",
    ) {
        super();

        const initialSmStatus = direction === "incoming" ? "incoming" : "connecting";
        this._sm = new MediaConnectionStateMachine(conn, initialSmStatus);

        // Derived status — single source of truth from the state machine
        this._mappedStatus = this._sm.stateMachine.mapState(s => STATUS_MAP[s]);
        this._mappedStatus.onChange((newStatus) => {
            this.emit("status", newStatus);
        });

        // Side-effects that aren't status: remoteStream + error events
        this._sm.stateMachine.onStateChange((newState) => {
            if (newState === "active" && this._sm.remoteStream) {
                this.emit("remoteStream", this._sm.remoteStream);
            }
            if (newState === "error") {
                this.emit("error", new Error("Media connection error"));
            }
        });
    }

    // -- Read-only state -------------------------------------------------------

    get remotePeerId(): string {
        return this._sm.remotePeerId;
    }

    get status(): CallStatus {
        return this._mappedStatus.get();
    }

    get remoteStream(): MediaStream | undefined {
        return this._sm.remoteStream;
    }

    /** The local media stream being sent to the remote peer. */
    get localStream(): MediaStream {
        return this.media.getStream();
    }

    /** Whether the microphone is muted. */
    get isMuted(): boolean {
        return this.media.isMuted();
    }

    /** Whether the camera is currently on. */
    get isCameraOn(): boolean {
        return this.media.localMedia.isCameraOn();
    }

    // -- Media controls --------------------------------------------------------

    /**
     * Access to the underlying `CallMediaManager` for media controls:
     * `toggleMute()`, `mute()`, `unmute()`, `toggleCamera()`, `cameraOn()`,
     * `cameraOff()`, `switchCamera()`, `switchMicrophone()`, `switchSpeaker()`,
     * `startScreenShare()`, `stopScreenShare()`.
     */
    get media() {
        return this._sm.media;
    }

    // -- Actions ---------------------------------------------------------------

    /**
     * Answer an incoming call. Only valid when `status === 'ringing'`.
     *
     * Acquires local media (camera + microphone by default) and answers the
     * call. Returns a `ResultAsync` that resolves on success.
     */
    answer() {
        this._sm.answer();
    }

    /**
     * Reject an incoming call. Only valid when `status === 'ringing'`.
     */
    reject(): void {
        this._sm.reject();
    }

    /**
     * Hang up the call. Idempotent — safe to call multiple times.
     */
    hangup(): void {
        if (this.status === "ended") return;
        this._sm.close();
    }
}
