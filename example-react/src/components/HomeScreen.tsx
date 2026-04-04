import { useState, useRef, useEffect } from 'react';
import type { PeerReadyState } from '../types';
import { Icons } from './Icons';
import { MediaToggle } from './MediaToggle';
import { useMediaContext } from '../context/media-context';

// ═══════════════════════════════════════════════════════════════════════════════
// HomeScreen — shown when not in a call
// ═══════════════════════════════════════════════════════════════════════════════
export function HomeScreen({ peerState }: { peerState: PeerReadyState; }) {
  const { state: mediaState } = useMediaContext();

  const [targetId, setTargetId] = useState('');
  const [copied, setCopied] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  // ── Bind local stream to video element ─────────────────────────────────
  const localStream = mediaState._tag === 'active' || mediaState._tag === 'switching'
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
  const permissionState = permissions.camera === 'denied' && permissions.microphone === 'denied'
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
              id="target-peer-input" />
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
              className="preview-video" />
          </div>
        )}

        {/* Media controls — state-driven */}
        <MediaToggle />
      </div>
    </div>
  );
}
