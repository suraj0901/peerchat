import { type MachineDefinition } from "nano-statechart";

export type PeerState = "initializing" | "ready" | "error";

export type PeerEvent =
  | { type: "CONNECT" }
  | { type: "PEER_OPEN"; peerId: string }
  | { type: "PEER_ERROR"; error: string }
  | { type: "DESTROY" };

export type PeerEffect =
  | { type: "CREATE_PEER" }
  | { type: "DESTROY_PEER" };

export type PeerContext = {
  peerId: string | null;
  error: string | null;
};

export const peerMachine: MachineDefinition<PeerState, PeerEvent, PeerEffect, PeerContext> = {
  initial: "initializing",
  context: {
    peerId: null,
    error: null,
  },
  states: {
    initializing: {
      on: {
        CONNECT: {
          target: "initializing",
          effects: [{ type: "CREATE_PEER" }],
        },
        PEER_OPEN: {
          target: "ready",
          reduce: (ctx, event) => ({ ...ctx, peerId: (event as Extract<PeerEvent, { type: "PEER_OPEN" }>).peerId, error: null }),
        },
        PEER_ERROR: {
          target: "error",
          reduce: (ctx, event) => ({ ...ctx, error: (event as Extract<PeerEvent, { type: "PEER_ERROR" }>).error }),
        },
      },
      exit: [{ type: "DESTROY_PEER" }], // Clean up if we switch out early (though rare)
    },
    ready: {
      on: {
        PEER_ERROR: {
          target: "error",
          reduce: (ctx, event) => ({ ...ctx, error: (event as Extract<PeerEvent, { type: "PEER_ERROR" }>).error }),
        },
        DESTROY: {
          target: "initializing",
          effects: [{ type: "DESTROY_PEER" }],
          reduce: (ctx) => ({ ...ctx, peerId: null, error: null }),
        },
      },
    },
    error: {
      on: {
        CONNECT: {
          target: "initializing",
          effects: [{ type: "CREATE_PEER" }],
          reduce: (ctx) => ({ ...ctx, error: null }),
        },
      },
    },
  },
};
