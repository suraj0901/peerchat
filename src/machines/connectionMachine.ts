import { type MachineDefinition } from "nano-statechart";

export type ConnState = "disconnected" | "connecting" | "connected";

export type ConnEvent =
  | { type: "CONNECT_PEER"; remotePeerId: string }
  | { type: "INCOMING_CONNECTION"; remotePeerId: string }
  | { type: "CONNECTION_OPEN" }
  | { type: "SEND_MESSAGE"; text: string }
  | { type: "RECEIVE_MESSAGE"; text: string; sender: string }
  | { type: "CONNECTION_ERROR"; error: string }
  | { type: "CONNECTION_CLOSED" }
  | { type: "DISCONNECT" };

export type ConnEffect =
  | { type: "CONNECT_TO_PEER" }
  | { type: "SEND_DATA" }
  | { type: "CLOSE_CONNECTION" };

export type ChatMessage = {
  text: string;
  sender: string;
  timestamp: number;
};

export type ConnContext = {
  remotePeerId: string | null;
  messages: ChatMessage[];
  error: string | null;
};

export const connectionMachine: MachineDefinition<ConnState, ConnEvent, ConnEffect, ConnContext> = {
  initial: "disconnected",
  context: {
    remotePeerId: null,
    messages: [],
    error: null,
  },
  states: {
    disconnected: {
      on: {
        CONNECT_PEER: {
          target: "connecting",
          effects: [{ type: "CONNECT_TO_PEER" }],
          reduce: (ctx, event) => ({ ...ctx, remotePeerId: (event as Extract<ConnEvent, { type: "CONNECT_PEER" }>).remotePeerId, error: null, messages: [] }),
        },
        INCOMING_CONNECTION: {
          target: "connecting",
          reduce: (ctx, event) => ({ ...ctx, remotePeerId: (event as Extract<ConnEvent, { type: "INCOMING_CONNECTION" }>).remotePeerId, error: null, messages: [] }),
        },
      },
    },
    connecting: {
      on: {
        CONNECTION_OPEN: {
          target: "connected",
        },
        CONNECTION_ERROR: {
          target: "disconnected",
          reduce: (ctx, event) => ({ ...ctx, error: (event as Extract<ConnEvent, { type: "CONNECTION_ERROR" }>).error, remotePeerId: null }),
        },
        CONNECTION_CLOSED: {
          target: "disconnected",
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
      },
    },
    connected: {
      on: {
        SEND_MESSAGE: {
          target: "connected",
          effects: [{ type: "SEND_DATA" }],
          reduce: (ctx, event) => ({
            ...ctx,
            messages: [...ctx.messages, { text: (event as Extract<ConnEvent, { type: "SEND_MESSAGE" }>).text, sender: "local", timestamp: Date.now() }],
          }),
        },
        RECEIVE_MESSAGE: {
          target: "connected",
          reduce: (ctx, event) => {
            const ev = event as Extract<ConnEvent, { type: "RECEIVE_MESSAGE" }>;
            return {
              ...ctx,
              messages: [...ctx.messages, { text: ev.text, sender: ev.sender, timestamp: Date.now() }],
            };
          },
        },
        CONNECTION_ERROR: {
          target: "disconnected",
          reduce: (ctx, event) => ({ ...ctx, error: (event as Extract<ConnEvent, { type: "CONNECTION_ERROR" }>).error, remotePeerId: null }),
        },
        CONNECTION_CLOSED: {
          target: "disconnected",
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
        DISCONNECT: {
          target: "disconnected",
          effects: [{ type: "CLOSE_CONNECTION" }],
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
      },
    },
  },
};
