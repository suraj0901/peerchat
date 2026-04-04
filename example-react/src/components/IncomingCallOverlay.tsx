// ═══════════════════════════════════════════════════════════════════════════════
// IncomingCallOverlay — renders when a CallMachine is in 'ringing' state
// ═══════════════════════════════════════════════════════════════════════════════


import { useEffect } from "react";
import { useMediaContext } from "../context/media-context";
import { useMachineState } from "../hooks/use-machine";
import type { AnyMachine } from "../types";
import type { CallState } from "peerchat";
import { Icons } from "./Icons";

export function IncomingCallOverlay({ machine }: { machine: AnyMachine<CallState> }) {
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
