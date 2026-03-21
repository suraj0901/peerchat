import { useEffect, useState, useCallback, useRef } from "react";
import { PeerClient } from "peerchat";
import { Peer } from "peerjs";

// ── Types ────────────────────────────────────────────────────────────────────

export type PermissionState = "checking" | "prompt" | "granted" | "denied";

export type IncomingCall = {
  callId: string;
  remotePeerId: string;
};

export type AppNotification = {
  id: number;
  type: "error" | "warning" | "info";
  title: string;
  message: string;
};

// ── Media error helpers ──────────────────────────────────────────────────────

function describeMediaError(error: Error): { title: string; message: string } {
  const name = error.name;
  switch (name) {
    case "NotAllowedError":
      return {
        title: "Permission Denied",
        message:
          "Camera or microphone access was denied. Please allow access in your browser settings and reload.",
      };
    case "NotFoundError":
      return {
        title: "No Device Found",
        message:
          "No camera or microphone was found. Please connect a device and try again.",
      };
    case "NotReadableError":
      return {
        title: "Device In Use",
        message:
          "Your camera or microphone is already in use by another application. Close other apps using it and try again.",
      };
    case "OverconstrainedError":
      return {
        title: "Unsupported Settings",
        message:
          "The requested device settings are not available on your hardware.",
      };
    case "AbortError":
      return {
        title: "Request Aborted",
        message:
          "The media request was aborted. This can happen if the page was navigated away during the prompt.",
      };
    case "SecurityError":
      return {
        title: "Security Error",
        message:
          "Media access is blocked due to security restrictions. The page must be served over HTTPS.",
      };
    default:
      return {
        title: "Media Error",
        message: error.message || "An unknown error occurred while accessing your media devices.",
      };
  }
}

// ── Permission check ─────────────────────────────────────────────────────────

async function checkMediaPermissions(): Promise<PermissionState> {
  // Permissions API is not supported in all browsers (e.g. Firefox for camera/mic)
  if (!navigator.permissions?.query) return "prompt";

  try {
    const [cam, mic] = await Promise.all([
      navigator.permissions.query({ name: "camera" as PermissionName }),
      navigator.permissions.query({ name: "microphone" as PermissionName }),
    ]);

    if (cam.state === "denied" && mic.state === "denied") return "denied";
    if (cam.state === "granted" || mic.state === "granted") return "granted";
    return "prompt";
  } catch {
    // Browser doesn't support these permission queries — fall through
    return "prompt";
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

let notifCounter = 0;

export function usePeer() {
  const [client, setClient] = useState<PeerClient | null>(null);

  // Permission
  const [permissionState, setPermissionState] = useState<PermissionState>("checking");

  // Peer
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peerState, setPeerState] = useState<string>("initializing");

  // Media
  const [mediaState, setMediaState] = useState<string>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  // Calls
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  // Chat
  const [messages, setMessages] = useState<{ sender: string; data: unknown }[]>([]);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);

  // Notifications (toasts)
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Track mute state locally
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  const clientRef = useRef<PeerClient | null>(null);

  // ── Notification helpers ──────────────────────────────────────────────────

  const addNotification = useCallback(
    (type: AppNotification["type"], title: string, message: string) => {
      const id = ++notifCounter;
      setNotifications((prev) => [...prev, { id, type, title, message }]);
      // Auto-dismiss after 8s
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 8000);
    },
    [],
  );

  const dismissNotification = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ── Initialization ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Check permissions first
      const permState = await checkMediaPermissions();
      if (cancelled) return;
      setPermissionState(permState);

      // 2. Initialize PeerClient regardless (peer connection != media)
      const peer = new Peer();
      const peerClient = new PeerClient(peer);
      clientRef.current = peerClient;
      if (!cancelled) setClient(peerClient);

      // Initial sync
      if (peerClient.peerId) setPeerId(peerClient.peerId);

      // ── Peer events ───────────────────────────────────────────────────
      const unsubs = [
        peerClient.on("peer.ready", ({ peerId }) => {
          setPeerId(peerId);
          setPeerState("ready");
        }),
        peerClient.on("peer.error", ({ error }) => {
          setPeerState("error");
          addNotification("error", "Connection Error", error.message);
        }),
        peerClient.on("peer.disconnected", () => {
          setPeerState("disconnected");
          addNotification("warning", "Disconnected", "Lost connection to the signaling server. Attempting to reconnect…");
        }),

        // ── Data connections ──────────────────────────────────────────
        peerClient.on("connection.opened", ({ connectionId }) => {
          setActiveConnId(connectionId);
        }),
        peerClient.on("connection.data", ({ connectionId, data }) => {
          setMessages((prev) => [...prev, { sender: connectionId, data }]);
        }),
        peerClient.on("connection.closed", ({ connectionId }) => {
          setActiveConnId((prev) => (prev === connectionId ? null : prev));
        }),
        peerClient.on("connection.error", ({ error }) => {
          addNotification("error", "Connection Error", error.message);
        }),

        // ── Media events ────────────────────────────────────────────────
        peerClient.on("media.stream.ready", ({ stream }) => {
          setLocalStream(stream);
          setMediaState("active");
          // Reset mute states — new stream tracks are enabled by default
          setAudioEnabled(true);
          setVideoEnabled(true);
        }),
        peerClient.on("media.stream.stopped", () => {
          setLocalStream(null);
          setMediaState("idle");
        }),
        peerClient.on("media.stream.error", ({ error }) => {
          setMediaState("error");
          const desc = describeMediaError(error);
          addNotification("error", desc.title, desc.message);
        }),
        peerClient.on("media.permission.denied", () => {
          setMediaState("denied");
          setPermissionState("denied");
          addNotification(
            "error",
            "Permission Denied",
            "Camera and microphone access was denied. Please update your browser settings to allow access, then reload this page.",
          );
        }),
        peerClient.on("media.track.ended", ({ kind }) => {
          addNotification(
            "info",
            "Track Lost",
            `Your ${kind} track ended unexpectedly. Attempting to recover…`,
          );
        }),
        peerClient.on("media.recovering", () => {
          setMediaState("recovering");
        }),
        peerClient.on("media.device.switched", ({ kind, stream }) => {
          setLocalStream(stream);
          addNotification("info", "Device Switched", `${kind === "audio" ? "Microphone" : "Camera"} switched successfully.`);
        }),
        peerClient.on("media.device.switch.failed", ({ kind, error }) => {
          addNotification(
            "error",
            "Switch Failed",
            `Could not switch ${kind === "audio" ? "microphone" : "camera"}: ${error.message}`,
          );
        }),
        peerClient.on("media.devices.updated", ({ devices }) => {
          setDevices(devices);
        }),

        // ── Call events ─────────────────────────────────────────────────
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
          addNotification("info", "Call Ended", "The call has ended.");
        }),
        peerClient.on("call.error", ({ error }) => {
          addNotification("error", "Call Error", error.message);
        }),
      ];

      // Store cleanup
      return () => {
        unsubs.forEach((sub) => sub.unsubscribe());
        peerClient.destroy();
      };
    })();

    return () => {
      cancelled = true;
      clientRef.current?.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ─────────────────────────────────────────────────────────────────

  const connect = useCallback(
    (id: string) => {
      client?.connect(id);
    },
    [client],
  );

  const sendMessage = useCallback(
    (data: unknown) => {
      if (!activeConnId) return;
      client?.sendData(activeConnId, data);
      setMessages((prev) => [...prev, { sender: "local", data }]);
    },
    [client, activeConnId],
  );

  const makeCall = useCallback(
    (id: string) => {
      client?.call(id);
      // Also open a data connection for chat
      client?.connect(id);
    },
    [client],
  );

  const answerCall = useCallback(
    (callId: string) => {
      client?.answerCall(callId);
      setIncomingCall(null);
    },
    [client],
  );

  const rejectCall = useCallback(
    (callId: string) => {
      client?.rejectCall(callId);
      setIncomingCall(null);
    },
    [client],
  );

  const hangUp = useCallback(() => {
    if (activeCallId) {
      client?.hangUp(activeCallId);
      setRemoteStream(null);
      setActiveCallId(null);
    }
  }, [client, activeCallId]);

  const requestMedia = useCallback(
    (constraints?: MediaStreamConstraints) => {
      client?.requestMedia(constraints);
    },
    [client],
  );

  const stopMedia = useCallback(() => {
    client?.stopMedia();
  }, [client]);

  const switchDevice = useCallback(
    (kind: "audio" | "video", deviceId: string) => {
      client?.switchDevice(kind, deviceId);
    },
    [client],
  );

  const toggleAudio = useCallback(() => {
    if (!localStream) return;
    const tracks = localStream.getAudioTracks();
    const next = !audioEnabled;
    tracks.forEach((t) => (t.enabled = next));
    setAudioEnabled(next);
  }, [localStream, audioEnabled]);

  const toggleVideo = useCallback(() => {
    if (!localStream) return;
    const tracks = localStream.getVideoTracks();
    const next = !videoEnabled;
    tracks.forEach((t) => (t.enabled = next));
    setVideoEnabled(next);
  }, [localStream, videoEnabled]);

  return {
    // State
    client,
    permissionState,
    peerId,
    peerState,
    mediaState,
    localStream,
    remoteStream,
    devices,
    activeCallId,
    incomingCall,
    messages,
    activeConnId,
    notifications,
    audioEnabled,
    videoEnabled,

    // Actions
    connect,
    sendMessage,
    makeCall,
    answerCall,
    rejectCall,
    hangUp,
    requestMedia,
    stopMedia,
    switchDevice,
    toggleAudio,
    toggleVideo,
    dismissNotification,
  };
}
