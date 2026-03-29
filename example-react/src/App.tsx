import { useState, useRef, useEffect, useCallback } from "react";
import { usePeer } from "./usePeer";
import "./App.css";

// ── Notification types & helpers ─────────────────────────────────────────────

type AppNotification = {
  id: number;
  type: "error" | "warning" | "info";
  title: string;
  message: string;
};

let notifCounter = 0;

function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const add = useCallback(
    (type: AppNotification["type"], title: string, message: string) => {
      const id = ++notifCounter;
      setNotifications((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 8000);
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { notifications, add, dismiss };
}

// ── SVG Icons (inline for zero-dep) ──────────────────────────────────────────

const Icons = {
  mic: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  ),
  micOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 5" />
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  ),
  cameraOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M21 17.72V11a1 1 0 0 0-.553-.894L16 8" />
      <path d="M14 14H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  ),
  phoneOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="22" x2="2" y1="2" y2="22" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11Z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  ),
  shieldOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 2 20 20" />
      <path d="M5 5a1 1 0 0 0-.7 1.73l.35.35A8 8 0 0 0 12 21a8.38 8.38 0 0 0 2.83-.48" />
      <path d="M20 12c0-4.2-2-6.87-3.35-8.35A1 1 0 0 0 15.92 3h-7.84a1 1 0 0 0-.73.33L5 5" />
    </svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  ),
};

// ── App ──────────────────────────────────────────────────────────────────────

function App() {
  const {
    client,
    peerId,
    peerState,
    mediaState,
    localStream,
    remoteStream,
    devices,
    permissions,
    incomingCall,
    messages,
    activeCallId,
    audioEnabled,
    videoEnabled,

    toggleAudio,
    toggleVideo,
    sendMessage,
  } = usePeer();

  const { notifications, add: addNotification, dismiss: dismissNotification } = useNotifications();

  // ── Wire up PeerClient events → notifications (UI concern lives here) ──
  useEffect(() => {
    if (!client) return;
    const unsubs = [
      client.on("peer.error", (e: any) => {
        addNotification("error", "Connection Error", e.error.message);
      }),
      client.on("peer.disconnected", () => {
        addNotification("warning", "Disconnected", "Lost connection to the signaling server. Reconnecting…");
      }),
      client.on("connection.error", (e: any) => {
        addNotification("error", "Connection Error", e.error.message);
      }),
      client.on("media.stream.error", (e: any) => {
        addNotification("error", "Media Error", e.error.message);
      }),
      client.on("media.permission.denied", () => {
        addNotification("error", "Permission Denied", "Camera/microphone access was denied.");
      }),
      client.on("media.track.ended", (e: any) => {
        addNotification("info", "Track Lost", `Your ${e.kind} track ended. Recovering…`);
      }),
      client.on("media.device.switched", (e: any) => {
        addNotification("info", "Device Switched", `${e.kind === "audio" ? "Microphone" : "Camera"} switched.`);
      }),
      client.on("media.device.switch.failed", (e: any) => {
        addNotification("error", "Switch Failed", `Could not switch ${e.kind}: ${e.error.message}`);
      }),
      client.on("call.ended", () => {
        addNotification("info", "Call Ended", "The call has ended.");
      }),
      client.on("call.error", (e: any) => {
        addNotification("error", "Call Error", e.error.message);
      }),
    ];
    return () => unsubs.forEach((s) => s.unsubscribe());
  }, [client, addNotification]);

  const [targetId, setTargetId] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Stream binding ──────────────────────────────────────────────────────

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

  // ── Chat auto-scroll ───────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCopy = () => {
    if (!peerId) return;
    navigator.clipboard.writeText(peerId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const permissionState =
    permissions.camera === "denied" && permissions.microphone === "denied"
      ? ("denied" as const)
      : permissions.camera === "granted" || permissions.microphone === "granted"
        ? ("granted" as const)
        : ("prompt" as const);

  const handleCall = () => {
    if (!targetId.trim() || !client) return;
    client.call(targetId.trim());
    client.connect(targetId.trim());
  };

  const handleCallKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCall();
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMsg.trim()) return;
    sendMessage(chatMsg.trim());
    setChatMsg("");
  };

  // ── Device selectors ──────────────────────────────────────────────────

  const cameras = devices.filter((d: MediaDeviceInfo) => d.kind === "videoinput");
  const microphones = devices.filter((d: MediaDeviceInfo) => d.kind === "audioinput");

  // ── Determine which screen to render ──────────────────────────────────

  const isInCall = !!remoteStream;

  // =====================================================================
  // 1. LOADING SCREEN — checking permissions
  // =====================================================================
  if (permissionState === "prompt") {
    return (
      <div className="app">
        <div className="screen screen-center">
          <div className="loader" />
          {/* <p className="loader-text">Checking media permissions…</p> */}
        </div>
      </div>
    );
  }

  // =====================================================================
  // 2. PERMISSION DENIED SCREEN
  // =====================================================================
  if (permissionState === "denied" && !localStream && !isInCall) {
    return (
      <div className="app">
        <div className="screen screen--center">
          <div className="denied-card">
            <div className="denied-icon">{Icons.shieldOff}</div>
            <h1>Camera & Microphone Access Required</h1>
            <p>
              PeerChat needs access to your camera and microphone to make video
              calls. You've denied this permission.
            </p>
            <div className="denied-steps">
              <h3>How to fix this:</h3>
              <ol>
                <li>Click the <strong>lock / camera icon</strong> in your browser's address bar</li>
                <li>Set <strong>Camera</strong> and <strong>Microphone</strong> to <strong>Allow</strong></li>
                <li><strong>Reload</strong> this page</li>
              </ol>
            </div>
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload Page
            </button>
          </div>
        </div>
        <Notifications notifications={notifications} onDismiss={dismissNotification} />
      </div>
    );
  }

  // =====================================================================
  // 3-5. MAIN APP (Home / Incoming Call / In-Call)
  // =====================================================================
  return (
    <div className="app">
      {/* ── Notifications (toasts) ─────────────────────────────────────── */}
      <Notifications notifications={notifications} onDismiss={dismissNotification} />

      {/* ── Incoming call overlay ──────────────────────────────────────── */}
      {incomingCall && (
        <div className="overlay">
          <div className="incoming-card">
            <div className="incoming-avatar">
              <div className="pulse-ring" />
              {Icons.phone}
            </div>
            <h2>Incoming Call</h2>
            <p className="incoming-peer">{incomingCall.remotePeerId}</p>
            <div className="incoming-actions">
              <button
                className="btn btn--accept"
                onClick={() => client?.answerCall(incomingCall.callId)}
              >
                {Icons.phone} Accept
              </button>
              <button
                className="btn btn--reject"
                onClick={() => client?.rejectCall(incomingCall.callId)}
              >
                {Icons.phoneOff} Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {!isInCall ? (
        /* ═══════════════════════════════════════════════════════════════
           HOME SCREEN
           ════════════════════════════════════════════════════════════ */
        <div className="screen screen--center">
          <div className="home-card">
            <div className="home-logo">
              <span className="logo-dot" />
              <h1>PeerChat</h1>
            </div>

            {/* Peer status */}
            <div className="status-row">
              <span className={`status-dot status-dot--${peerState}`} />
              <span className="status-label">
                {peerState === "ready"
                  ? "Connected"
                  : peerState === "initializing"
                    ? "Connecting…"
                    : peerState}
              </span>
              {mediaState !== "idle" && mediaState !== "active" && (
                <span className="media-badge">{mediaState}</span>
              )}
            </div>

            {/* Peer ID */}
            <div className="peer-id-section">
              <label>Your Peer ID</label>
              <div className="peer-id-box">
                <code>{peerId || "Generating…"}</code>
                <button
                  className="btn btn--icon"
                  onClick={handleCopy}
                  disabled={!peerId}
                  title="Copy to clipboard"
                >
                  {copied ? Icons.check : Icons.copy}
                </button>
              </div>
            </div>

            {/* Call someone */}
            <div className="call-section">
              <label>Call Someone</label>
              <div className="call-input-row">
                <input
                  type="text"
                  placeholder="Enter peer ID to call…"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  onKeyDown={handleCallKeyDown}
                  id="target-peer-input"
                />
                <button
                  className="btn btn--primary btn--call"
                  onClick={handleCall}
                  disabled={!peerId || !targetId.trim() || peerState !== "ready"}
                  id="call-button"
                >
                  {Icons.phone}
                  <span>Call</span>
                </button>
              </div>
            </div>

            {/* Preview */}
            {localStream && (
              <div className="preview-section">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="preview-video"
                />
              </div>
            )}

            {/* Media toggle */}
            <div className="home-media-row">
              {!localStream ? (
                <button className="btn btn--secondary" onClick={() => client?.requestMedia()}>
                  {Icons.camera} Preview Camera
                </button>
              ) : (
                <button className="btn btn--secondary" onClick={() => client?.stopMedia()}>
                  {Icons.cameraOff} Stop Preview
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ═══════════════════════════════════════════════════════════════
           IN-CALL SCREEN
           ════════════════════════════════════════════════════════════ */
        <div className="call-layout">
          {/* ── Main video area ──────────────────────────────────────── */}
          <div className={`call-main ${chatOpen ? "" : "call-main--full"}`}>
            {/* Remote video */}
            <div className="remote-video-container">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="remote-video"
                id="remote-video"
              />
              <div className="remote-label">Remote</div>
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
                <div className="pip-muted-overlay">
                  {Icons.cameraOff}
                </div>
              )}
            </div>

            {/* ── Bottom controls ────────────────────────────────────── */}
            <div className="controls-bar">
              <div className="controls-group">
                {/* Mic */}
                <div className="control-with-select">
                  <button
                    className={`ctrl-btn ${!audioEnabled ? "ctrl-btn--off" : ""}`}
                    onClick={toggleAudio}
                    title={audioEnabled ? "Mute microphone" : "Unmute microphone"}
                    id="toggle-mic"
                  >
                    {audioEnabled ? Icons.mic : Icons.micOff}
                  </button>
                  {microphones.length > 1 && (
                    <select
                      className="device-select"
                      onChange={(e) => client?.switchDevice("audio", e.target.value)}
                      title="Select microphone"
                    >
                      {microphones.map((d: MediaDeviceInfo) => (
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
                    className={`ctrl-btn ${!videoEnabled ? "ctrl-btn--off" : ""}`}
                    onClick={toggleVideo}
                    title={videoEnabled ? "Turn off camera" : "Turn on camera"}
                    id="toggle-camera"
                  >
                    {videoEnabled ? Icons.camera : Icons.cameraOff}
                  </button>
                  {cameras.length > 1 && (
                    <select
                      className="device-select"
                      onChange={(e) => client?.switchDevice("video", e.target.value)}
                      title="Select camera"
                    >
                      {cameras.map((d: MediaDeviceInfo) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Cam ${d.deviceId.slice(0, 5)}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Chat toggle */}
                <button
                  className={`ctrl-btn ${chatOpen ? "ctrl-btn--active" : ""}`}
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
                onClick={() => { if (activeCallId) client?.hangUp(activeCallId); }}
                title="Hang up"
                id="hangup-button"
              >
                {Icons.phoneOff}
              </button>
            </div>
          </div>

          {/* ── Chat sidebar ─────────────────────────────────────────── */}
          {chatOpen && (
            <aside className="chat-sidebar">
              <div className="chat-header">
                <h3>Chat</h3>
                <button className="btn btn--icon" onClick={() => setChatOpen(false)}>
                  {Icons.x}
                </button>
              </div>
              <div className="chat-messages">
                {messages.length === 0 && (
                  <p className="chat-empty">No messages yet. Say hello!</p>
                )}
                {messages.map((m: { sender: string; data: unknown }, i: number) => (
                  <div
                    key={i}
                    className={`chat-bubble ${m.sender === "local" ? "chat-bubble--sent" : "chat-bubble--received"}`}
                  >
                    <span className="chat-sender">
                      {m.sender === "local" ? "You" : "Remote"}
                    </span>
                    <div className="chat-text">{String(m.data)}</div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <form className="chat-form" onSubmit={handleSend}>
                <input
                  type="text"
                  placeholder="Type a message…"
                  value={chatMsg}
                  onChange={(e) => setChatMsg(e.target.value)}
                  id="chat-input"
                />
                <button
                  type="submit"
                  className="btn btn--icon btn--send"
                  disabled={!chatMsg.trim()}
                  id="send-button"
                >
                  {Icons.send}
                </button>
              </form>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

// ── Notifications component ──────────────────────────────────────────────────

function Notifications({
  notifications,
  onDismiss,
}: {
  notifications: { id: number; type: string; title: string; message: string }[];
  onDismiss: (id: number) => void;
}) {
  if (notifications.length === 0) return null;
  return (
    <div className="toast-container">
      {notifications.map((n) => (
        <div key={n.id} className={`toast toast--${n.type}`}>
          <div className="toast-content">
            <strong>{n.title}</strong>
            <p>{n.message}</p>
          </div>
          <button className="toast-close" onClick={() => onDismiss(n.id)}>
            {Icons.x}
          </button>
        </div>
      ))}
    </div>
  );
}

export default App;
