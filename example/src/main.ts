import { PeerClient } from "peerchat";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusDot = $<HTMLSpanElement>("statusDot");
const statusLabel = $<HTMLSpanElement>("statusLabel");
const myPeerIdEl = $<HTMLElement>("myPeerId");
const copyIdBtn = $<HTMLButtonElement>("copyIdBtn");

const remoteIdInput = $<HTMLInputElement>("remoteIdInput");
const connectBtn = $<HTMLButtonElement>("connectBtn");

const chatMessages = $<HTMLDivElement>("chatMessages");
const chatForm = $<HTMLFormElement>("chatForm");
const msgInput = $<HTMLInputElement>("msgInput");
const sendBtn = $<HTMLButtonElement>("sendBtn");

const localVideoEl = $<HTMLVideoElement>("localVideo");
const remoteVideoEl = $<HTMLVideoElement>("remoteVideo");
const callBtn = $<HTMLButtonElement>("callBtn");
const muteBtn = $<HTMLButtonElement>("muteBtn");
const camBtn = $<HTMLButtonElement>("camBtn");
const hangupBtn = $<HTMLButtonElement>("hangupBtn");
const callStatusEl = $<HTMLDivElement>("callStatus");

let peer: PeerClient;
let isInCall = false;

function init() {
  peer = new PeerClient();

  peer.subscribe((snapshot) => {
    updateUI(snapshot);
  });
}

function updateUI(snapshot: ReturnType<typeof peer.getSnapshot>) {
  const { peer: peerState, conn, media, localStream, remoteStream } = snapshot;
  const { mediaDevice } = snapshot;

  statusDot.className = "status-dot";
  switch (peerState.state) {
    case "ready":
      statusDot.classList.add("ready");
      myPeerIdEl.textContent = peerState.context.peerId || "—";
      statusLabel.textContent = "Ready";
      break;
    case "error":
      statusDot.classList.add("error");
      statusLabel.textContent = peerState.context.peerError || "Error";
      break;
    case "initializing":
      statusLabel.textContent = "Connecting...";
      break;
  }

  const canChat = conn.state === "connected";
  const canCall = conn.state === "connected" || media.state === "in_call";

  msgInput.disabled = !canChat;
  sendBtn.disabled = !canChat;
  callBtn.disabled = !canCall;

  if (canChat) {
    const messages = peerState.context.messages;
    renderMessages(messages);
  }

  if (media.state === "in_call") {
    isInCall = true;
    muteBtn.disabled = false;
    camBtn.disabled = false;
    hangupBtn.disabled = false;
    callBtn.disabled = true;

    if (localStream) {
      localVideoEl.srcObject = localStream;
    }
    if (remoteStream) {
      remoteVideoEl.srcObject = remoteStream;
    }

    muteBtn.textContent = mediaDevice.audio === "muted" ? "🔇 Unmute" : "🎤 Mute";
    camBtn.textContent = mediaDevice.video === "off" ? "📷 Cam On" : "📷 Cam Off";
    callStatusEl.textContent = "In call";
  } else if (media.state === "incoming_call") {
    callStatusEl.textContent = "Incoming call...";
  } else if (media.state === "placing_call") {
    callStatusEl.textContent = "Calling...";
  } else if (media.state === "acquiring_media") {
    callStatusEl.textContent = "Requesting camera & mic...";
  } else {
    isInCall = false;
    muteBtn.disabled = true;
    camBtn.disabled = true;
    hangupBtn.disabled = true;
    callBtn.disabled = !canCall;
    muteBtn.textContent = "🎤 Mute";
    camBtn.textContent = "📷 Cam Off";
    localVideoEl.srcObject = null;
    remoteVideoEl.srcObject = null;
    callStatusEl.textContent = "";
  }
}

function renderMessages(messages: Array<{ text: string; sender: string; timestamp: number }>) {
  const lastRendered = chatMessages.dataset.lastCount ? parseInt(chatMessages.dataset.lastCount) : 0;
  if (messages.length === lastRendered) return;

  chatMessages.innerHTML = "";
  if (messages.length === 0) {
    chatMessages.innerHTML = '<p class="empty-state">Connect to a peer to start chatting</p>';
  } else {
    messages.forEach((msg) => {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${msg.sender === "local" ? "sent" : "received"}`;
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      bubble.innerHTML = `${escapeHtml(msg.text)}<span class="meta">${time}</span>`;
      chatMessages.appendChild(bubble);
    });
  }
  chatMessages.dataset.lastCount = String(messages.length);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

copyIdBtn.addEventListener("click", () => {
  const peerId = peer.getSnapshot().peer.context.peerId;
  if (!peerId) return;
  navigator.clipboard.writeText(peerId);
  copyIdBtn.textContent = "✅";
  setTimeout(() => (copyIdBtn.textContent = "📋"), 1500);
});

connectBtn.addEventListener("click", () => {
  const remoteId = remoteIdInput.value.trim();
  if (!remoteId) return;

  addSystemMessage(`Connecting to ${remoteId}…`);
  peer.connectPeer(remoteId);
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text) return;

  peer.sendMessage(text);
  msgInput.value = "";
});

callBtn.addEventListener("click", () => {
  const remoteId = remoteIdInput.value.trim();
  if (!remoteId) {
    addSystemMessage("Enter a remote Peer ID first");
    return;
  }

  callStatusEl.textContent = "Requesting camera & mic...";
  peer.startCall(remoteId);
});

muteBtn.addEventListener("click", () => {
  peer.toggleAudio();
});

camBtn.addEventListener("click", () => {
  peer.toggleVideo();
});

hangupBtn.addEventListener("click", () => {
  peer.hangUp();
  isInCall = false;
});

function addSystemMessage(text: string) {
  const empty = chatMessages.querySelector(".empty-state");
  if (empty) empty.remove();

  const el = document.createElement("p");
  el.className = "system-msg";
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str: string) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
