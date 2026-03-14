import { type MachineDefinition } from "nano-statechart";

export type MediaState = "idle" | "acquiring_media" | "ready" | "calling" | "incoming_call" | "in_call";

export type MediaEvent =
  | { type: "START_CALL"; remotePeerId: string }
  | { type: "MEDIA_ACQUIRED"; stream: MediaStream }
  | { type: "MEDIA_ERROR"; error: string }
  | { type: "INCOMING_CALL"; remotePeerId: string }
  | { type: "ACCEPT_CALL" }
  | { type: "DECLINE_CALL" }
  | { type: "CALL_ANSWERED"; remoteStream: MediaStream }
  | { type: "HANG_UP" }
  | { type: "CALL_CLOSED" }
  | { type: "CALL_ERROR"; error: string };

export type MediaEffect =
  | { type: "ACQUIRE_MEDIA" }
  | { type: "PLACE_CALL" }
  | { type: "ANSWER_CALL" }
  | { type: "STOP_MEDIA" }
  | { type: "CLOSE_CALL" };

export type MediaContext = {
  remotePeerId: string | null;
  error: string | null;
  isOutgoing: boolean;
};

export const mediaMachine: MachineDefinition<MediaState, MediaEvent, MediaEffect, MediaContext> = {
  initial: "idle",
  context: {
    remotePeerId: null,
    error: null,
    isOutgoing: false,
  },
  states: {
    idle: {
      on: {
        START_CALL: {
          target: "acquiring_media",
          effects: [{ type: "ACQUIRE_MEDIA" }],
          reduce: (ctx, event) => {
            const ev = event as Extract<MediaEvent, { type: "START_CALL" }>;
            return {
              ...ctx,
              remotePeerId: ev.remotePeerId,
              isOutgoing: true,
              error: null,
            };
          },
        },
        INCOMING_CALL: {
          target: "incoming_call",
          reduce: (ctx, event) => ({
            ...ctx,
            remotePeerId: (event as Extract<MediaEvent, { type: "INCOMING_CALL" }>).remotePeerId,
            isOutgoing: false,
            error: null,
          }),
        },
      },
    },
    acquiring_media: {
      on: {
        MEDIA_ACQUIRED: {
          target: "ready", // Transitory state, immediately moves to placing call or answering call
        },
        MEDIA_ERROR: {
          target: "idle",
          reduce: (ctx, event) => ({ ...ctx, error: (event as Extract<MediaEvent, { type: "MEDIA_ERROR" }>).error, remotePeerId: null }),
        },
        HANG_UP: {
          target: "idle",
          effects: [{ type: "STOP_MEDIA" }],
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
      },
    },
    ready: {
      // Auto-transitions are handled by placing the actual call via effect or answering
      entry: [{ type: "PLACE_CALL" }], // PLACE_CALL effect checks `isOutgoing` secretly OR we can just have a unified PLACE_CALL that answers if we are answering
      on: {
        // Assume PLACE_CALL fires CALL_ANSWERED locally if we just answered, 
        // OR remote terminal sends stream to fire CALL_ANSWERED if outgoing.
        // Let's go to `calling` for outgoing, or jump straight to `in_call` for answering
        CALL_ANSWERED: {
          target: "in_call",
        },
        CALL_ERROR: {
          target: "idle",
          effects: [{ type: "STOP_MEDIA" }],
          reduce: (ctx, event) => ({ ...ctx, error: (event as Extract<MediaEvent, { type: "CALL_ERROR" }>).error, remotePeerId: null }),
        },
        HANG_UP: {
          target: "idle",
          effects: [{ type: "CLOSE_CALL" }, { type: "STOP_MEDIA" }],
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
      },
    },
    calling: {
      on: {
        CALL_ANSWERED: {
          target: "in_call",
        },
        CALL_CLOSED: {
          target: "idle",
          effects: [{ type: "STOP_MEDIA" }],
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
        CALL_ERROR: {
          target: "idle",
          effects: [{ type: "STOP_MEDIA" }],
          reduce: (ctx, event) => ({ ...ctx, error: (event as Extract<MediaEvent, { type: "CALL_ERROR" }>).error, remotePeerId: null }),
        },
        HANG_UP: {
          target: "idle",
          effects: [{ type: "CLOSE_CALL" }, { type: "STOP_MEDIA" }],
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
      },
    },
    incoming_call: {
      on: {
        ACCEPT_CALL: {
          target: "acquiring_media",
          effects: [{ type: "ACQUIRE_MEDIA" }],
        },
        DECLINE_CALL: {
          target: "idle",
          effects: [{ type: "CLOSE_CALL" }],
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
        CALL_CLOSED: {
          target: "idle",
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
      },
    },
    in_call: {
      on: {
        CALL_CLOSED: {
          target: "idle",
          effects: [{ type: "STOP_MEDIA" }],
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
        HANG_UP: {
          target: "idle",
          effects: [{ type: "CLOSE_CALL" }, { type: "STOP_MEDIA" }],
          reduce: (ctx) => ({ ...ctx, remotePeerId: null }),
        },
      },
    },
  },
};
