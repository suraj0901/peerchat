// ═══════════════════════════════════════════════════════════════════════════════
// LiveCallScreen — shown when a call is connecting or live
// ═══════════════════════════════════════════════════════════════════════════════


import type { CallState, ConnectionState } from "peerchat";
import { useMemo, useState } from "react";
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

  if (callState._tag != "live") return null

  const handleHangUp = () => {
    callState.hangUp();
  };

  return (
    <div className="call-layout">
      {/* Main video area */}
      <div className={`call-main ${chatOpen ? '' : 'call-main--full'}`}>
        <RemoteVideo remoteStream={callState.remoteStream} remotePeerId={callState.remotePeerId} />

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
            onClick={handleHangUp}
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


interface RemoteVideoProps {
  remoteStream: MediaStream;
  remotePeerId: string;
}

function RemoteVideo({ remoteStream, remotePeerId }: RemoteVideoProps) {
  const remoteStream_cached = useMemo(() => remoteStream, [remoteStream])
  return (
    <div className="remote-video-container">
      <video
        ref={element => {
          if (element) {
            element.srcObject = remoteStream_cached;
          }
        }}
        autoPlay
        playsInline
        className="remote-video"
        id="remote-video" />
      <div className="remote-label">{remotePeerId}</div>
    </div>
  );
}

