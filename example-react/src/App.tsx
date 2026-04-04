import { useState, useRef, useEffect, useCallback } from 'react';
import { usePeerContext } from './peer-context';
import { useMediaContext } from './media-context';
import { useMachineState } from './use-machine';
import type { PeerState, CallState, ConnectionState } from 'peerchat';
import './App.css';

// ── Types ────────────────────────────────────────────────────────────────────

// We need to reference child machine types. Since CallMachine/ConnectionMachine
// are not exported from the public API, we use structural typing.
type AnyMachine<S> = {
  subscribe(cb: () => void): { unsubscribe(): void };
  getState(): S;
  destroy(): void;
};

type ChatMessage = { sender: 'local' | 'remote'; data: unknown };

// ── Notification system ──────────────────────────────────────────────────────

type AppNotification = {
  id: number;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
};

let notifCounter = 0;

function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const add = useCallback(
    (type: AppNotification['type'], title: string, message: string) => {
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
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  ),
};

// ═══════════════════════════════════════════════════════════════════════════════
// App — top-level switch on peer state
// ═══════════════════════════════════════════════════════════════════════════════

function App() {
  const { state: peerState } = usePeerContext();

  switch (peerState._tag) {
    case 'initializing':
      return (
        <div className="app">
          <div className="screen screen-center">
            <div className="loader" />
          </div>
        </div>
      );

    case 'ready':
      return <ReadyApp state={peerState} />;

    case 'disconnected':
      return (
        <div className="app">
          <div className="screen screen--center">
            <div className="home-card">
              <div className="home-logo">
                <span className="logo-dot" />
                <h1>PeerChat</h1>
              </div>
              <div className="status-row">
                <span className="status-dot status-dot--disconnected" />
                <span className="status-label">Disconnected — reconnecting…</span>
              </div>
              <button
                className="btn btn--primary"
                onClick={() => peerState.reconnect()}
              >
                Reconnect Now
              </button>
            </div>
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="app">
          <div className="screen screen--center">
            <div className="denied-card">
              <div className="denied-icon">{Icons.shieldOff}</div>
              <h1>Connection Error</h1>
              <p>{peerState.lastError.message}</p>
              <button className="btn btn--primary" onClick={() => window.location.reload()}>
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );

    case 'destroyed':
      return (
        <div className="app">
          <div className="screen screen--center">
            <div className="home-card">
              <h1>Session Ended</h1>
              <p style={{ color: 'var(--text-secondary)' }}>Peer connection has been destroyed.</p>
              <button className="btn btn--primary" onClick={() => window.location.reload()}>
                Start New Session
              </button>
            </div>
          </div>
        </div>
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ReadyApp — peer is connected, this is the main experience
// ═══════════════════════════════════════════════════════════════════════════════

// PeerReadyState is the narrowed type here.
// Safe to access: state.peerId, state.calls, state.connections, state.call(), state.connect()
type PeerReadyState = Extract<PeerState, { _tag: 'ready' }>;

function ReadyApp({ state }: { state: PeerReadyState }) {
  const { manager } = usePeerContext();
  const { machine: media } = useMediaContext();
  const { notifications, add: addNotification, dismiss: dismissNotification } = useNotifications();

  // ── Wire events → notifications ───────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      manager.on('peer.error', (e) => {
        addNotification('error', 'Connection Error', e.error.message);
      }),
      manager.on('connection.error', (e) => {
        addNotification('error', 'Connection Error', e.error.message);
      }),
      media.on('media.stream.error', (e) => {
        addNotification('error', 'Media Error', e.error.message);
      }),
      media.on('media.permission.denied', () => {
        addNotification('error', 'Permission Denied', 'Camera/microphone access was denied.');
      }),
      media.on('media.track.ended', (e) => {
        addNotification('info', 'Track Lost', `Your ${e.kind} track ended. Recovering…`);
      }),
      media.on('media.device.switched', (e) => {
        addNotification('info', 'Device Switched', `${e.kind === 'audio' ? 'Microphone' : 'Camera'} switched.`);
      }),
      media.on('media.device.switch.failed', (e) => {
        addNotification('error', 'Switch Failed', `Could not switch ${e.kind}: ${e.error.message}`);
      }),
      manager.on('call.ended', () => {
        addNotification('info', 'Call Ended', 'The call has ended.');
      }),
      manager.on('call.error', (e) => {
        addNotification('error', 'Call Error', e.error.message);
      }),
    ];
    return () => unsubs.forEach((s) => s.unsubscribe());
  }, [manager, media, addNotification]);

  // ── Find the first live call (if any) ──────────────────────────────────
  let liveCallEntry: [string, AnyMachine<CallState>] | null = null;
  let ringingCallEntry: [string, AnyMachine<CallState>] | null = null;

  for (const [id, machine] of state.calls) {
    const s = machine.getState();
    if (s._tag === 'live' || s._tag === 'connecting') {
      liveCallEntry = [id, machine];
    }
    if (s._tag === 'ringing') {
      ringingCallEntry = [id, machine];
    }
  }

  // ── Find the first open connection (if any) ───────────────────────────
  let openConnectionEntry: [string, AnyMachine<ConnectionState>] | null = null;
  for (const [id, machine] of state.connections) {
    if (machine.getState()._tag === 'open' || machine.getState()._tag === 'connecting') {
      openConnectionEntry = [id, machine];
    }
  }

  return (
    <div className="app">
      <Notifications notifications={notifications} onDismiss={dismissNotification} />

      {/* Incoming call overlay — shown when a call is ringing */}
      {ringingCallEntry && (
        <IncomingCallOverlay
          key={ringingCallEntry[0]}
          machine={ringingCallEntry[1]}
        />
      )}

      {/* Main content: home screen or live call */}
      {liveCallEntry ? (
        <LiveCallScreen
          key={liveCallEntry[0]}
          callMachine={liveCallEntry[1]}
          connectionMachine={openConnectionEntry?.[1] ?? null}
        />
      ) : (
        <HomeScreen peerState={state} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HomeScreen — shown when not in a call
// ═══════════════════════════════════════════════════════════════════════════════

function HomeScreen({ peerState }: { peerState: PeerReadyState }) {
  const { state: mediaState } = useMediaContext();

  const [targetId, setTargetId] = useState('');
  const [copied, setCopied] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  // ── Bind local stream to video element ─────────────────────────────────
  const localStream =
    mediaState._tag === 'active' || mediaState._tag === 'switching'
      ? mediaState.stream
      : null;

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const handleCopy = () => {
    navigator.clipboard.writeText(peerState.peerId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCall = () => {
    const id = targetId.trim();
    if (!id) return;
    // Call requires a local stream — media must be active
    if (mediaState._tag === 'active') {
      peerState.call(id, mediaState.stream);
      peerState.connect(id);
    }
  };

  const handleCallKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCall();
  };

  // Permission gate
  const permissions = mediaState.permissions;
  const permissionState =
    permissions.camera === 'denied' && permissions.microphone === 'denied'
      ? ('denied' as const)
      : permissions.camera === 'granted' || permissions.microphone === 'granted'
        ? ('granted' as const)
        : ('prompt' as const);

  if (permissionState === 'denied' && !localStream) {
    return (
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
    );
  }

  const canCall = mediaState._tag === 'active' && targetId.trim().length > 0;

  return (
    <div className="screen screen--center">
      <div className="home-card">
        <div className="home-logo">
          <span className="logo-dot" />
          <h1>PeerChat</h1>
        </div>

        {/* Peer status */}
        <div className="status-row">
          <span className="status-dot status-dot--ready" />
          <span className="status-label">Connected</span>
          {mediaState._tag !== 'idle' && mediaState._tag !== 'active' && (
            <span className="media-badge">{mediaState._tag}</span>
          )}
        </div>

        {/* Peer ID */}
        <div className="peer-id-section">
          <label>Your Peer ID</label>
          <div className="peer-id-box">
            <code>{peerState.peerId}</code>
            <button
              className="btn btn--icon"
              onClick={handleCopy}
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
              disabled={!canCall}
              id="call-button"
              title={mediaState._tag !== 'active' ? 'Start camera preview first' : undefined}
            >
              {Icons.phone}
              <span>Call</span>
            </button>
          </div>
        </div>

        {/* Camera preview — only when media is active */}
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

        {/* Media controls — state-driven */}
        <MediaToggle />
      </div>
    </div>
  );
}

// ── MediaToggle — renders based on media state _tag ──────────────────────────

function MediaToggle() {
  const { state } = useMediaContext();

  switch (state._tag) {
    case 'idle':
      return (
        <div className="home-media-row">
          <button
            className="btn btn--secondary"
            onClick={() => state.request({ audio: true, video: true })}
          >
            {Icons.camera} Preview Camera
          </button>
        </div>
      );

    case 'checkingPermissions':
    case 'requesting':
    case 'recovering':
      return (
        <div className="home-media-row">
          <button className="btn btn--secondary" disabled>
            <div className="loader" style={{ width: 16, height: 16, margin: 0, borderWidth: 2 }} />
            Starting…
          </button>
        </div>
      );

    case 'active':
    case 'switching':
      return (
        <div className="home-media-row">
          <button className="btn btn--secondary" onClick={() => state.stop()}>
            {Icons.cameraOff} Stop Preview
          </button>
        </div>
      );

    case 'denied':
      return (
        <div className="home-media-row">
          <button className="btn btn--secondary" onClick={() => state.retry()}>
            {Icons.camera} Retry Camera
          </button>
        </div>
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IncomingCallOverlay — renders when a CallMachine is in 'ringing' state
// ═══════════════════════════════════════════════════════════════════════════════

function IncomingCallOverlay({ machine }: { machine: AnyMachine<CallState> }) {
  const callState = useMachineState(machine);
  const { state: mediaState } = useMediaContext();

  // Auto-request media if idle when a call comes in
  useEffect(() => {
    if (callState._tag === 'ringing' && mediaState._tag === 'idle') {
      mediaState.request({ audio: true, video: true });
    }
  }, [callState._tag, mediaState]);

  // Only render when ringing
  if (callState._tag !== 'ringing') return null;

  const canAnswer = mediaState._tag === 'active';

  return (
    <div className="overlay">
      <div className="incoming-card">
        <div className="incoming-avatar">
          <div className="pulse-ring" />
          {Icons.phone}
        </div>
        <h2>Incoming Call</h2>
        <p className="incoming-peer">{callState.remotePeerId}</p>
        <div className="incoming-actions">
          {canAnswer ? (
            <button
              className="btn btn--accept"
              onClick={() => callState.answer(mediaState.stream)}
            >
              {Icons.phone} Accept
            </button>
          ) : (
            <button className="btn btn--accept" disabled>
              <div className="loader" style={{ width: 16, height: 16, margin: 0, borderWidth: 2 }} />
              Getting camera…
            </button>
          )}
          <button
            className="btn btn--reject"
            onClick={() => callState.reject()}
          >
            {Icons.phoneOff} Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LiveCallScreen — shown when a call is connecting or live
// ═══════════════════════════════════════════════════════════════════════════════

function LiveCallScreen({
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

// ═══════════════════════════════════════════════════════════════════════════════
// ChatSidebar — subscribes to a ConnectionMachine independently
// ═══════════════════════════════════════════════════════════════════════════════

function ChatSidebar({
  machine,
  onClose,
}: {
  machine: AnyMachine<ConnectionState>;
  onClose: () => void;
}) {
  const connState = useMachineState(machine);
  const { manager } = usePeerContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatMsg, setChatMsg] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Listen for incoming data on this connection
  useEffect(() => {
    const sub = manager.on('connection.data', ({ connectionId, data }) => {
      if (connState._tag === 'open' && connectionId === connState.connectionId) {
        setMessages((prev) => [...prev, { sender: 'remote', data }]);
      }
    });
    return sub.unsubscribe;
  }, [manager, connState]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatMsg.trim();
    if (!text) return;

    // State-safe: only send when connection is open
    if (connState._tag === 'open') {
      connState.send(text);
      setMessages((prev) => [...prev, { sender: 'local', data: text }]);
      setChatMsg('');
    }
  };

  const isOpen = connState._tag === 'open';

  return (
    <aside className="chat-sidebar">
      <div className="chat-header">
        <h3>Chat</h3>
        <button className="btn btn--icon" onClick={onClose}>{Icons.x}</button>
      </div>
      <div className="chat-messages">
        {!isOpen && (
          <p className="chat-empty">Connecting data channel…</p>
        )}
        {isOpen && messages.length === 0 && (
          <p className="chat-empty">No messages yet. Say hello!</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`chat-bubble ${m.sender === 'local' ? 'chat-bubble--sent' : 'chat-bubble--received'}`}
          >
            <span className="chat-sender">
              {m.sender === 'local' ? 'You' : 'Remote'}
            </span>
            <div className="chat-text">{String(m.data)}</div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <form className="chat-form" onSubmit={handleSend}>
        <input
          type="text"
          placeholder={isOpen ? 'Type a message…' : 'Connecting…'}
          value={chatMsg}
          onChange={(e) => setChatMsg(e.target.value)}
          disabled={!isOpen}
          id="chat-input"
        />
        <button
          type="submit"
          className="btn btn--icon btn--send"
          disabled={!isOpen || !chatMsg.trim()}
          id="send-button"
        >
          {Icons.send}
        </button>
      </form>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Notifications
// ═══════════════════════════════════════════════════════════════════════════════

function Notifications({
  notifications,
  onDismiss,
}: {
  notifications: AppNotification[];
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
