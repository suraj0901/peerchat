import { useEffect, useState, useCallback, useRef } from "react";
import { PeerClient, type PeerClientState } from "peerchat";
import { Peer } from "peerjs";

// ── Types ────────────────────────────────────────────────────────────────────

export type IncomingCall = {
  callId: string;
  remotePeerId: string;
};

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * React hook that bridges PeerClient into React state.
 *
 * Returns:
 *   - `client`       — the PeerClient instance (call methods directly)
 *   - `state`        — reactive snapshot of peer + media machine state
 *   - `remoteStream` — the active remote MediaStream (from call events)
 *   - `activeCallId` — the current call ID (null when not in a call)
 *   - `incomingCall`  — incoming call info (null when no incoming call)
 *   - `messages`      — chat messages received via data connection
 *   - `activeConnId`  — the current data connection ID
 *   - `audioEnabled`  — local audio mute state
 *   - `videoEnabled`  — local video mute state
 *   - `toggleAudio()` / `toggleVideo()` — mute toggles
 *   - `sendMessage()` — send a chat message on the active data connection
 */
export function usePeer() {
  const [client, setClient] = useState<PeerClient | null>(null);

  // ── Unified state (from subscribe()) ────────────────────────────────────
  const [state, setState] = useState<PeerClientState>({
    peerId: null,
    peerState: "initializing",
    peerError: null,
    mediaState: "idle",
    localStream: null,
    devices: [],
    mediaMode: "user",
    mediaError: null,
    permissions: { camera: "unknown", microphone: "unknown" },
  });

  // ── Event-only state (not derivable from snapshots) ─────────────────────
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [messages, setMessages] = useState<{ sender: string; data: unknown }[]>([]);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);

  // Track mute state locally
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  const clientRef = useRef<PeerClient | null>(null);

  // ── Initialization ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const peer = new Peer();
    const peerClient = new PeerClient(peer);
    clientRef.current = peerClient;
    if (!cancelled) setClient(peerClient);

    // ── Unified reactive state via subscribe() ─────────────────────────
    const stateSub = peerClient.subscribe((s) => {
      if (!cancelled) setState(s);
    });

    // ── Event-only listeners (side-effects only) ───────────────────────
    const unsubs = [
      // Data connections
      peerClient.on("connection.opened", ({ connectionId }) => {
        setActiveConnId(connectionId);
      }),
      peerClient.on("connection.data", ({ connectionId, data }) => {
        setMessages((prev) => [...prev, { sender: connectionId, data }]);
      }),
      peerClient.on("connection.closed", ({ connectionId }) => {
        setActiveConnId((prev) => (prev === connectionId ? null : prev));
      }),

      // Media events — reset mute states on new stream
      peerClient.on("media.stream.ready", () => {
        setAudioEnabled(true);
        setVideoEnabled(true);
      }),

      // Call events
      peerClient.on("call.incoming", ({ callId, remotePeerId }) => {
        setIncomingCall({ callId, remotePeerId });
      }),
      peerClient.on("call.active", ({ callId, remoteStream }) => {
        setRemoteStream(remoteStream);
        setActiveCallId(callId);
        setIncomingCall(null);
      }),
      peerClient.on("call.ended", () => {
        setRemoteStream(null);
        setActiveCallId(null);
      }),
    ];

    return () => {
      cancelled = true;
      stateSub.unsubscribe();
      unsubs.forEach((sub) => sub.unsubscribe());
      peerClient.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ─────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    (data: unknown) => {
      if (!activeConnId || !client) return;
      client.sendData(activeConnId, data);
      setMessages((prev) => [...prev, { sender: "local", data }]);
    },
    [client, activeConnId],
  );

  const toggleAudio = useCallback(() => {
    if (!state.localStream) return;
    const next = !audioEnabled;
    state.localStream.getAudioTracks().forEach((t) => (t.enabled = next));
    setAudioEnabled(next);
  }, [state.localStream, audioEnabled]);

  const toggleVideo = useCallback(() => {
    if (!state.localStream) return;
    const next = !videoEnabled;
    state.localStream.getVideoTracks().forEach((t) => (t.enabled = next));
    setVideoEnabled(next);
  }, [state.localStream, videoEnabled]);

  return {
    // The PeerClient instance — call methods directly (call, hangUp, connect, etc.)
    client,

    // Reactive state
    ...state,

    // Event-derived state
    remoteStream,
    activeCallId,
    incomingCall,
    messages,
    activeConnId,
    audioEnabled,
    videoEnabled,

    // Actions that need React state coordination
    sendMessage,
    toggleAudio,
    toggleVideo,
  };
}
