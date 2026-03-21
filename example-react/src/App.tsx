import { useState, useRef, useEffect } from 'react'
import { usePeer } from './usePeer'
import './App.css'

function App() {
  const {
    client,
    peerId,
    peerState,
    mediaState,
    localStream,
    remoteStream,
    messages,
    connect,
    sendData,
    makeCall,
    hangUp,
    requestMedia,
    stopMedia
  } = usePeer();

  const [targetId, setTargetId] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [activeConnId, setActiveConnId] = useState<string | null>(null); // Simplified for 1:1 chat

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Auto-play streams
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);


  const handleConnect = () => {
    connect(targetId);
    setActiveConnId(targetId); // Assume connection is straight to targetId for this example
  };

  const handleCall = () => {
    makeCall(targetId);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMsg.trim() || !activeConnId) return;
    sendData(activeConnId, chatMsg);
    setChatMsg("");
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>PeerChat React</h1>
        <div className="status-badge">
          Status: <span className={`status ${peerState}`}>{peerState}</span>
        </div>
      </header>

      <main className="main-content">
        <section className="panel connection-panel">
          <h2>Your Peer ID</h2>
          <div className="id-display">{peerId || "Generating..."}</div>
          
          <div className="connect-form">
            <input 
              type="text" 
              placeholder="Enter remote Peer ID..." 
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            />
            <button onClick={handleConnect} disabled={!client || !targetId}>Connect</button>
            <button onClick={handleCall} disabled={!client || !targetId}>Call</button>
          </div>
        </section>

        <div className="media-chat-wrapper">
          <section className="panel media-panel">
            <h2>Media Control</h2>
            <div className="media-status">State: {mediaState}</div>
            
            <div className="video-grid">
              <div className="video-card">
                <h3>Local</h3>
                <video ref={localVideoRef} autoPlay playsInline muted className={localStream ? 'active' : ''} />
                <div className="controls">
                  {!localStream ? (
                    <button onClick={requestMedia}>Start Camera</button>
                  ) : (
                    <button onClick={stopMedia}>Stop Camera</button>
                  )}
                </div>
              </div>
              <div className="video-card">
                <h3>Remote</h3>
                <video ref={remoteVideoRef} autoPlay playsInline className={remoteStream ? 'active' : ''} />
              </div>
            </div>
            {remoteStream && (
              <div className="call-controls">
                <button onClick={() => hangUp('current')}>Hang Up</button>
              </div>
            )}
          </section>

          <section className="panel chat-panel">
            <h2>Chat</h2>
            <div className="messages">
              {messages.length === 0 && <p className="empty-chat">No messages yet.</p>}
              {messages.map((m, i) => (
                <div key={i} className={`msg-bubble ${m.sender === "local" ? "sent" : "received"}`}>
                  <span className="msg-sender">{m.sender === "local" ? "You" : m.sender}</span>
                  <div className="msg-text">{String(m.data)}</div>
                </div>
              ))}
            </div>
            <form onSubmit={handleSend} className="chat-form">
              <input 
                type="text" 
                placeholder="Type a message..." 
                value={chatMsg}
                onChange={e => setChatMsg(e.target.value)}
                disabled={!activeConnId}
              />
              <button type="submit" disabled={!activeConnId || !chatMsg.trim()}>Send</button>
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
