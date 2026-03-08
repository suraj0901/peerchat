import { PeerChat, type Call, type Channel } from "peerchat";

// ── DOM Elements ────────────────────────────────────────────────────────

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

// ── State ───────────────────────────────────────────────────────────────

let channel: Channel | null = null;
let activeCall: Call | null = null;

// ── PeerChat Init ───────────────────────────────────────────────────────

const peer = new PeerChat();

peer.on("status", (status) => {
    statusLabel.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    statusDot.className = "status-dot";

    switch (status) {
        case "ready":
            statusDot.classList.add("ready");
            myPeerIdEl.textContent = peer.id;
            break;
        case "disconnected":
        case "destroyed":
            statusDot.classList.add("error");
            break;
    }
});

peer.on("error", (err) => {
    addSystemMessage(`⚠️ Error: ${err.message}`);
});

// ── Incoming call handler ───────────────────────────────────────────────

peer.on("incomingCall", (incomingCall) => {
    addSystemMessage("📞 Incoming call…");

    // Auto-answer for this demo
    incomingCall.answer().map(() => {
        wireCall(incomingCall);
    }).mapErr((err) => {
        addSystemMessage(`Failed to answer call: ${err.error}`);
    })
});

// ── Incoming data channel handler ───────────────────────────────────────

peer.on("incomingConnection", (incomingChannel) => {
    addSystemMessage("🔗 Peer connected to you");
    wireChannel(incomingChannel);
});

// ── Copy ID ─────────────────────────────────────────────────────────────

copyIdBtn.addEventListener("click", () => {
    if (!peer.id) return;
    navigator.clipboard.writeText(peer.id);
    copyIdBtn.textContent = "✅";
    setTimeout(() => (copyIdBtn.textContent = "📋"), 1500);
});

// ── Connect (data channel) ──────────────────────────────────────────────

connectBtn.addEventListener("click", () => {
    const remoteId = remoteIdInput.value.trim();
    if (!remoteId) return;

    addSystemMessage(`Connecting to ${remoteId}…`);
    const ch = peer.connect(remoteId);
    wireChannel(ch);
});

function wireChannel(ch: Channel) {
    channel = ch;

    ch.on("status", (s) => {
        if (s === "open") {
            addSystemMessage(`✅ Data channel open with ${ch.remotePeerId}`);
            msgInput.disabled = false;
            sendBtn.disabled = false;
            callBtn.disabled = false;
        } else if (s === "closed") {
            addSystemMessage("Data channel closed");
            msgInput.disabled = true;
            sendBtn.disabled = true;
            channel = null;
        }
    });

    ch.on("message", (data) => {
        addChatBubble(String(data), "received");
    });

    ch.on("error", (err) => {
        addSystemMessage(`⚠️ Channel error: ${err.message}`);
    });
}

// ── Chat ────────────────────────────────────────────────────────────────

chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !channel) return;

    channel.send(text);
    addChatBubble(text, "sent");
    msgInput.value = "";
});

// ── Call ─────────────────────────────────────────────────────────────────

callBtn.addEventListener("click", () => {
    const remoteId = remoteIdInput.value.trim() || channel?.remotePeerId;
    if (!remoteId) {
        addSystemMessage("Enter a remote Peer ID first");
        return;
    }

    callStatusEl.textContent = "Requesting camera & mic…";

    peer
        .call(remoteId)
        .map((call) => {
            wireCall(call);
        })
        .mapErr((err) => {
            callStatusEl.textContent = `Failed: ${String(err)}`;
        });
});

function wireCall(call: Call) {
    activeCall = call;
    callBtn.disabled = true;
    muteBtn.disabled = false;
    camBtn.disabled = false;
    hangupBtn.disabled = false;

    try {
        localVideoEl.srcObject = call.localStream;
        console.log("local stream", call.localStream);
    } catch {
        // local stream might not be available yet
    }

    call.on("status", (s) => {
        callStatusEl.textContent = `Call: ${s}`;

        if (s === "ended") {
            cleanupCall();
        }
    });

    call.on("remoteStream", (stream) => {
        remoteVideoEl.srcObject = stream;
    });

    call.on("error", (err) => {
        addSystemMessage(`⚠️ Call error: ${err.message}`);
        cleanupCall();
    });
}

muteBtn.addEventListener("click", () => {
    if (!activeCall) return;
    activeCall.media.toggleMute();
    muteBtn.textContent = activeCall.isMuted ? "🔇 Unmute" : "🎤 Mute";
});

camBtn.addEventListener("click", () => {
    if (!activeCall) return;
    activeCall.media.toggleCamera();
    camBtn.textContent = activeCall.isCameraOn ? "📷 Cam Off" : "📷 Cam On";
});

hangupBtn.addEventListener("click", () => {
    activeCall?.hangup();
});

function cleanupCall() {
    activeCall = null;
    localVideoEl.srcObject = null;
    remoteVideoEl.srcObject = null;
    callBtn.disabled = !channel;
    muteBtn.disabled = true;
    camBtn.disabled = true;
    hangupBtn.disabled = true;
    muteBtn.textContent = "🎤 Mute";
    camBtn.textContent = "📷 Cam Off";
    callStatusEl.textContent = "";
}

// ── UI Helpers ──────────────────────────────────────────────────────────

function addChatBubble(text: string, kind: "sent" | "received") {
    clearEmptyState();
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${kind}`;

    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    bubble.innerHTML = `${escapeHtml(text)}<span class="meta">${time}</span>`;

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(text: string) {
    clearEmptyState();
    const el = document.createElement("p");
    el.className = "system-msg";
    el.textContent = text;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearEmptyState() {
    const empty = chatMessages.querySelector(".empty-state");
    if (empty) empty.remove();
}

function escapeHtml(str: string) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
