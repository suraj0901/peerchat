import type { MediaConnection } from "peerjs";
import { TypedEmitter } from "./typed-emitter";
import { MediaConnectionStateMachine } from "./state-machine";
import type { CallMediaManager } from "./media";

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
    private _status: CallStatus;

    /** @internal — Use `PeerChat.call()` or the `incomingCall` event instead. */
    constructor(
        conn: MediaConnection,
        direction: "outgoing" | "incoming" = "outgoing",
    ) {
        super();

        const initialSmStatus = direction === "incoming" ? "incoming" : "connecting";
        this._sm = new MediaConnectionStateMachine(conn, initialSmStatus);
        this._status = direction === "incoming" ? "ringing" : "connecting";

        // --- wire internal state machine → public status ---
        this._sm.stateMachine.onStateChange((newState) => {
            switch (newState) {
                case "connecting":
                    this._setStatus("connecting");
                    break;
                case "active":
                    this._setStatus("active");
                    if (this._sm.remoteStream) {
                        this.emit("remoteStream", this._sm.remoteStream);
                    }
                    break;
                case "closed":
                case "closing":
                    this._setStatus("ended");
                    break;
                case "error":
                    this.emit("error", new Error("Media connection error"));
                    this._setStatus("ended");
                    break;
            }
        });
    }

    // -- Read-only state -------------------------------------------------------

    get remotePeerId(): string {
        return this._sm.remotePeerId;
    }

    get status(): CallStatus {
        return this._status;
    }

    get remoteStream(): MediaStream | undefined {
        return this._sm.remoteStream;
    }

    /** The local media stream being sent to the remote peer. */
    get localStream(): MediaStream {
        return this._media.getStream();
    }

    // -- Actions ---------------------------------------------------------------

    /**
     * Answer an incoming call. Only valid when `status === 'ringing'`.
     */
    answer(stream?: MediaStream): void {
        this._sm.answer(stream);
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
        if (this._status === "ended") return;
        this._sm.close();
    }

    // -- Media controls (delegated to CallMediaManager) ------------------------

    get isMuted(): boolean {
        return this._media.isMuted();
    }

    get isCameraOn(): boolean {
        return !this._media.isMuted(); // camera check via localMedia
    }

    toggleMute(): void {
        this._media.toggleMute();
    }

    toggleCamera(): void {
        this._media.toggleCamera();
    }

    mute(): void {
        this._media.mute();
    }

    unmute(): void {
        this._media.unmute();
    }

    cameraOn(): void {
        this._media.cameraOn();
    }

    cameraOff(): void {
        this._media.cameraOff();
    }

    switchCamera(deviceId: string) {
        return this._media.switchCamera(deviceId);
    }

    switchMicrophone(deviceId: string) {
        return this._media.switchMicrophone(deviceId);
    }

    switchSpeaker(deviceId: string, audioElement: HTMLAudioElement) {
        return this._media.switchSpeaker(deviceId, audioElement);
    }

    startScreenShare(constraints?: DisplayMediaStreamOptions) {
        return this._media.startScreenShare(constraints);
    }

    stopScreenShare() {
        return this._media.stopScreenShare();
    }

    // -- Internals -------------------------------------------------------------

    /** Access to the underlying CallMediaManager (created by MediaConnectionStateMachine). */
    private get _media(): CallMediaManager {
        return this._sm.media;
    }

    private _setStatus(status: CallStatus): void {
        if (this._status === status) return;
        this._status = status;
        this.emit("status", status);
    }
}
