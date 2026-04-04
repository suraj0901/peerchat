// ═══════════════════════════════════════════════════════════════════════════════
// ChatSidebar — subscribes to a ConnectionMachine independently
// ═══════════════════════════════════════════════════════════════════════════════

import type { AnyMachine } from "../types";
import { Icons } from "./Icons";
import type { ConnectionState } from "peerchat"
import { useMachineState } from "../hooks/use-machine";
import { useEffect, useRef, useState } from "react";
import { usePeerContext } from "../context/peer-context";

type ChatMessage = { sender: 'local' | 'remote'; data: unknown };

export function ChatSidebar({
  machine,
  onClose,
}: {
  machine: AnyMachine<ConnectionState>;
  onClose: () => void;
}) {
  const connState = useMachineState(machine);
  const { manager } = usePeerContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatMsg, setChatMsg] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Listen for incoming data on this connection
  useEffect(() => {
    const sub = manager.on('connection.data', ({ connectionId, data }) => {
      if (connState._tag === 'open' && connectionId === connState.connectionId) {
        setMessages((prev) => [...prev, { sender: 'remote', data }]);
      }
    });
    return sub.unsubscribe;
  }, [manager, connState]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatMsg.trim();
    if (!text) return;

    // State-safe: only send when connection is open
    if (connState._tag === 'open') {
      connState.send(text);
      setMessages((prev) => [...prev, { sender: 'local', data: text }]);
      setChatMsg('');
    }
  };

  const isOpen = connState._tag === 'open';

  return (
    <aside className="chat-sidebar">
      <div className="chat-header">
        <h3>Chat</h3>
        <button className="btn btn--icon" onClick={onClose}>{Icons.x}</button>
      </div>
      <div className="chat-messages">
        {!isOpen && (
          <p className="chat-empty">Connecting data channel…</p>
        )}
        {isOpen && messages.length === 0 && (
          <p className="chat-empty">No messages yet. Say hello!</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`chat-bubble ${m.sender === 'local' ? 'chat-bubble--sent' : 'chat-bubble--received'}`}
          >
            <span className="chat-sender">
              {m.sender === 'local' ? 'You' : 'Remote'}
            </span>
            <div className="chat-text">{String(m.data)}</div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <form className="chat-form" onSubmit={handleSend}>
        <input
          type="text"
          placeholder={isOpen ? 'Type a message…' : 'Connecting…'}
          value={chatMsg}
          onChange={(e) => setChatMsg(e.target.value)}
          disabled={!isOpen}
          id="chat-input"
        />
        <button
          type="submit"
          className="btn btn--icon btn--send"
          disabled={!isOpen || !chatMsg.trim()}
          id="send-button"
        >
          {Icons.send}
        </button>
      </form>
    </aside>
  );
}