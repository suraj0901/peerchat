// ═══════════════════════════════════════════════════════════════════════════════
// LiveCallScreen — shown when a call is connecting or live
// ═══════════════════════════════════════════════════════════════════════════════


import type { CallState, ConnectionState } from "peerchat";
import { useState } from "react";
import { useMachineState } from "../hooks/use-machine";
import type { AnyMachine } from "../types";
import { ChatSidebar } from "./ChatSidebar";
import { Icons } from "./Icons";
import { LocalMediaControls } from "./LocalMediaControls";
import { LocalPiP } from "./LocalPiP";

interface LiveCallScreenProps {
  callMachine: AnyMachine<CallState>;
  connectionMachine: AnyMachine<ConnectionState> | null;
}

export function LiveCallScreen({ callMachine, connectionMachine }: LiveCallScreenProps) {
  const callState = useMachineState(callMachine);

  const [chatOpen, setChatOpen] = useState(true);

  if (callState._tag === "connecting") return <CallConnectingScreen callState={callState} />

  if (callState._tag != "live") return null

  return (
    <div className="call-layout">
      {/* Main video area */}
      <div className={`call-main ${chatOpen ? '' : 'call-main--full'}`}>
        <div className="remote-video-container">
          <video
            ref={element => {
              if (element && element.srcObject !== callState.remoteStream) {
                element.srcObject = callState.remoteStream;
              }
            }}
            autoPlay
            playsInline
            className="remote-video"
            id="remote-video" />
          <div className="remote-label">{callState.remotePeerId}</div>
        </div>

        {/* Local PiP - state handled internally */}
        <LocalPiP />

        {/* Controls bar */}
        <div className="controls-bar">
          <div className="controls-group">
            {/* Media Controls - state handled internally */}
            <LocalMediaControls />

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
            onClick={() => callState.hangUp()}
            title="Hang up"
            id="hangup-button"
          >
            {Icons.phoneOff}
          </button>
        </div>
      </div>

      {/* Chat sidebar */}
      {chatOpen && connectionMachine && (
        <ChatSidebar
          machine={connectionMachine}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

function CallConnectingScreen({ callState }: { callState: Extract<CallState, { _tag: "connecting" }> }) {
  return <div className="call-layout">
    <div className="call-main call-main--full">
      <div className="remote-video-container">
        <div className="screen screen--center" style={{ background: '#000' }}>
          <div className="loader">
          </div>
          <p className="loader-text">Connecting to {callState.remotePeerId}…</p>
        </div>
      </div>
      <div className="controls-bar">
        <div className="controls-group" />
        <button
          className="ctrl-btn ctrl-btn--hangup"
          onClick={() => callState.hangUp()}
          title="Cancel"
          id="hangup-button"
        >
          {Icons.phoneOff}
        </button>
      </div>
    </div>
  </div>;
}
