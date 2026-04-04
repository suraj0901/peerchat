// ═══════════════════════════════════════════════════════════════════════════════
// LiveCallScreen — shown when a call is connecting or live
// ═══════════════════════════════════════════════════════════════════════════════


import type { CallState, ConnectionState } from "peerchat"
import { useMachineState } from "../hooks/use-machine";
import { useMediaContext } from "../context/media-context";
import { useEffect, useRef, useState } from "react";
import type { AnyMachine } from "../types";
import { Icons } from "./Icons";
import { ChatSidebar } from "./ChatSidebar";

export function LiveCallScreen({
  callMachine,
  connectionMachine,
}: {
  callMachine: AnyMachine<CallState>;
  connectionMachine: AnyMachine<ConnectionState> | null;
}) {
  const callState = useMachineState(callMachine);
  const { state: mediaState } = useMediaContext();

  const [chatOpen, setChatOpen] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // ── Stream binding ─────────────────────────────────────────────────────

  const localStream =
    mediaState._tag === 'active' || mediaState._tag === 'switching'
      ? mediaState.stream
      : null;

  const remoteStream = callState._tag === 'live' ? callState.remoteStream : null;

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // ── Track toggles ──────────────────────────────────────────────────────

  const toggleAudio = () => {
    if (!localStream) return;
    const next = !audioEnabled;
    localStream.getAudioTracks().forEach((t) => (t.enabled = next));
    setAudioEnabled(next);
  };

  const toggleVideo = () => {
    if (!localStream) return;
    const next = !videoEnabled;
    localStream.getVideoTracks().forEach((t) => (t.enabled = next));
    setVideoEnabled(next);
  };

  // ── Device selectors ───────────────────────────────────────────────────

  const devices =
    mediaState._tag === 'active' || mediaState._tag === 'switching'
      ? mediaState.devices
      : [];
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  const microphones = devices.filter((d) => d.kind === 'audioinput');

  const handleSwitchDevice = (kind: 'audio' | 'video', deviceId: string) => {
    if (mediaState._tag === 'active') {
      mediaState.switchDevice(kind, deviceId);
    }
  };

  // ── Hang up — state-safe ───────────────────────────────────────────────

  const handleHangUp = () => {
    if (callState._tag === 'live') callState.hangUp();
    if (callState._tag === 'connecting') callState.hangUp();
  };

  // ── Connecting state ───────────────────────────────────────────────────

  if (callState._tag === 'connecting') {
    return (
      <div className="call-layout">
        <div className="call-main call-main--full">
          <div className="remote-video-container">
            <div className="screen screen-center" style={{ background: '#000' }}>
              <div className="loader" />
              <p className="loader-text">Connecting to {callState.remotePeerId}…</p>
            </div>
          </div>
          <div className="controls-bar">
            <div className="controls-group" />
            <button
              className="ctrl-btn ctrl-btn--hangup"
              onClick={handleHangUp}
              title="Cancel"
              id="hangup-button"
            >
              {Icons.phoneOff}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Ended / Error — the parent will remove us, but guard anyway ────────

  if (callState._tag !== 'live') return null;

  return (
    <div className="call-layout">
      {/* Main video area */}
      <div className={`call-main ${chatOpen ? '' : 'call-main--full'}`}>
        <div className="remote-video-container">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="remote-video"
            id="remote-video"
          />
          <div className="remote-label">{callState.remotePeerId}</div>
        </div>

        {/* Local PiP */}
        <div className="local-pip">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="local-video"
            id="local-video"
          />
          {!videoEnabled && (
            <div className="pip-muted-overlay">{Icons.cameraOff}</div>
          )}
        </div>

        {/* Controls bar */}
        <div className="controls-bar">
          <div className="controls-group">
            {/* Mic */}
            <div className="control-with-select">
              <button
                className={`ctrl-btn ${!audioEnabled ? 'ctrl-btn--off' : ''}`}
                onClick={toggleAudio}
                title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                id="toggle-mic"
              >
                {audioEnabled ? Icons.mic : Icons.micOff}
              </button>
              {microphones.length > 1 && (
                <select
                  className="device-select"
                  onChange={(e) => handleSwitchDevice('audio', e.target.value)}
                  title="Select microphone"
                >
                  {microphones.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mic ${d.deviceId.slice(0, 5)}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Camera */}
            <div className="control-with-select">
              <button
                className={`ctrl-btn ${!videoEnabled ? 'ctrl-btn--off' : ''}`}
                onClick={toggleVideo}
                title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                id="toggle-camera"
              >
                {videoEnabled ? Icons.camera : Icons.cameraOff}
              </button>
              {cameras.length > 1 && (
                <select
                  className="device-select"
                  onChange={(e) => handleSwitchDevice('video', e.target.value)}
                  title="Select camera"
                >
                  {cameras.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Cam ${d.deviceId.slice(0, 5)}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Chat toggle */}
            <button
              className={`ctrl-btn ${chatOpen ? 'ctrl-btn--active' : ''}`}
              onClick={() => setChatOpen((p) => !p)}
              title="Toggle chat"
              id="toggle-chat"
            >
              {Icons.chat}
            </button>
          </div>

          {/* Hang up */}
          <button
            className="ctrl-btn ctrl-btn--hangup"
            onClick={handleHangUp}
            title="Hang up"
            id="hangup-button"
          >
            {Icons.phoneOff}
          </button>
        </div>
      </div>

      {/* Chat sidebar — only when connection exists and chat is open */}
      {chatOpen && connectionMachine && (
        <ChatSidebar
          machine={connectionMachine}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}