import { useEffect, useState } from "react";
import { PeerClient } from "peerchat";
import { Peer } from "peerjs";

export function usePeer() {
  const [client, setClient] = useState<PeerClient | null>(null);
  
  // Expose reactive state for the React component
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peerState, setPeerState] = useState<string>("initializing");
  const [mediaState, setMediaState] = useState<string>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [messages, setMessages] = useState<{ sender: string, data: unknown }[]>([]);

  useEffect(() => {
    // Initialize the underlying PeerJS instance first
    const peer = new Peer();
    const peerClient = new PeerClient(peer);
    setClient(peerClient);

    // Initial sync
    setPeerId(peerClient.peerId);

    // Subscribe to unified events
    const unsubs = [
      peerClient.on("peer.ready", ({ peerId }) => {
        setPeerId(peerId);
        setPeerState("ready");
      }),
      peerClient.on("peer.error", () => {
        setPeerState("error");
      }),
      peerClient.on("peer.disconnected", () => {
        setPeerState("disconnected");
      }),
      
      // Data connections
      peerClient.on("connection.data", ({ connectionId, data }) => {
        setMessages(prev => [...prev, { sender: connectionId, data }]);
      }),

      // Media stream ready (local)
      peerClient.on("media.stream.ready", ({ stream }) => {
        setLocalStream(stream);
        setMediaState("active");
      }),
      peerClient.on("media.stream.stopped", () => {
        setLocalStream(null);
        setMediaState("idle");
      }),

      // Call events
      peerClient.on("call.active", ({ remoteStream }) => {
        setRemoteStream(remoteStream);
      }),
      peerClient.on("call.ended", () => {
        setRemoteStream(null);
      })
    ];

    return () => {
      unsubs.forEach(sub => sub.unsubscribe());
      peerClient.destroy();
    };
  }, []);

  // Helpful handlers
  const connect = (id: string) => client?.connect(id);
  const sendData = (connectionId: string, data: unknown) => {
    client?.sendData(connectionId, data);
    setMessages(prev => [...prev, { sender: "local", data }]);
  };
  const makeCall = (id: string) => client?.call(id);
  const hangUp = (callId: string) => client?.hangUp(callId);
  const requestMedia = () => client?.requestMedia();
  const stopMedia = () => client?.stopMedia();

  return {
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
  };
}
