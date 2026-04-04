import './App.css';
import { usePeerContext } from './context/peer-context';
import { Icons } from './components/Icons';
import { ReadyApp } from './components/ReadyApp';
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

export default App;
