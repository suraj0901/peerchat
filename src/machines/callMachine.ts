import { setup, fromCallback, assign, sendParent } from 'xstate';
import type { MediaConnection, PeerError } from 'peerjs';
import type {
  CallContext,
  CallEvent,
  CallCallbackEvent,
  CallInput,
  CallParentEvent,
} from './types';

// ── Event Source ──────────────────────────────────────────────────────────────

/**
 * Bridges the PeerJS MediaConnection event emitter into the XState event system.
 *
 * Lifetime: alive for the entire 'active' compound state, covering ringing,
 * connecting, and live sub-states. PeerJS emits 'stream' regardless of whether
 * the connection is inbound or outbound, so a single source handles both.
 *
 * Note: PeerJS does not expose removeListener on MediaConnection.
 * Cleanup relies on call.close() rather than explicit listener removal.
 */
const callEventSource = fromCallback<CallCallbackEvent, MediaConnection>(
  ({ input: call, sendBack }: { input: MediaConnection; sendBack: (event: CallCallbackEvent) => void }) => {
    call.on('stream', (stream: MediaStream) =>
      sendBack({ type: 'CALL_STREAM', stream })
    );
    call.on('close', () =>
      sendBack({ type: 'CALL_CLOSE' })
    );
    call.on('error', (error: PeerError<string>) =>
      sendBack({ type: 'CALL_ERROR', error })
    );

    return () => {
      // PeerJS does not support removeListener — teardown is via call.close()
    };
  }
);

// ── Machine ───────────────────────────────────────────────────────────────────

/**
 * Models the lifecycle of a single PeerJS MediaConnection (audio/video call).
 *
 * States:
 *   active.ringing    — inbound call; awaiting ANSWER or REJECT from local user.
 *                       Skipped entirely for outbound calls via an 'always' guard.
 *   active.connecting — call has been answered (or is outbound); waiting for
 *                       PeerJS to deliver the remote MediaStream via 'stream' event.
 *   active.live       — remote stream is flowing; HANG_UP is accepted here.
 *   ended             — final; call closed cleanly (local hang-up or remote close).
 *   error             — final; call closed with an error.
 *
 * Key design choices:
 *
 * - 'ringing' vs 'connecting' split: inbound calls are unanswered MediaConnection
 *   objects — PeerJS will not emit 'stream' until answer() is called. Keeping
 *   'ringing' as a distinct state makes it impossible to accidentally call HANG_UP
 *   on a call that was never answered (use REJECT instead).
 *
 * - answer() is called as a transition action from ringing → connecting, not as
 *   an entry action on 'connecting', because the localStream is only available at
 *   the moment the ANSWER command is received.
 *
 * - call.close() is the only way to reject/hang up in PeerJS. PeerJS has no
 *   separate reject mechanism — close() on an unanswered call sends a close signal
 *   to the remote peer.
 *
 * Parent communication:
 *   CALL_ACTOR_ACTIVE  — remote stream arrived; call is live (carries remoteStream).
 *   CALL_ACTOR_ENDED   — call ended cleanly.
 *   CALL_ACTOR_ERROR   — call ended with an error.
 *
 * Commands accepted per state:
 *   ringing    — ANSWER (→ connecting), REJECT (→ ended)
 *   connecting — HANG_UP (→ ended)
 *   live       — HANG_UP (→ ended)
 */
export const callMachine = setup({
  types: {
    context: {} as CallContext,
    events: {} as CallEvent,
    input: {} as CallInput,
  },
  actors: { callEventSource },
  actions: {
    // ── MediaConnection operations ────────────────────────────────────────────

    answerCall: ({ context, event }) => {
      const { localStream } = event as Extract<CallEvent, { type: 'ANSWER' }>;
      context.call.answer(localStream);
    },

    closeCall: ({ context }) => {
      context.call.close();
    },

    // ── Context mutations ─────────────────────────────────────────────────────

    assignRemoteStream: assign({
      remoteStream: ({ event }) =>
        (event as Extract<CallEvent, { type: 'CALL_STREAM' }>).stream,
    }),

    // ── Parent notifications ──────────────────────────────────────────────────

    notifyParentActive: sendParent(
      ({ context, event }): CallParentEvent => ({
        type: 'CALL_ACTOR_ACTIVE',
        callId: context.callId,
        remotePeerId: context.remotePeerId,
        remoteStream: (event as Extract<CallEvent, { type: 'CALL_STREAM' }>).stream,
      })
    ),

    notifyParentEnded: sendParent(
      ({ context }): CallParentEvent => ({
        type: 'CALL_ACTOR_ENDED',
        callId: context.callId,
      })
    ),

    notifyParentError: sendParent(
      ({ context, event }): CallParentEvent => ({
        type: 'CALL_ACTOR_ERROR',
        callId: context.callId,
        error: (event as Extract<CallEvent, { type: 'CALL_ERROR' }>).error,
      })
    ),
  },

  guards: {
    isOutbound: ({ context }) => context.direction === 'outbound',
  },
}).createMachine({
  id: 'call',
  context: ({ input }) => ({
    ...input,
    remoteStream: null,
  }),

  initial: 'active',
  states: {
    active: {
      // The event source spans all active sub-states. For inbound calls this
      // means we start listening immediately — PeerJS may buffer the 'stream'
      // event if answer() is called synchronously after the MediaConnection
      // is constructed, but having the listener registered early is safe.
      invoke: {
        id: 'callEvents',
        src: 'callEventSource',
        input: ({ context }) => context.call,
      },

      initial: 'ringing',
      states: {
        ringing: {
          // Outbound calls never ring — skip immediately to connecting.
          always: {
            guard: 'isOutbound',
            target: 'connecting',
          },
          on: {
            ANSWER: {
              // answer() must be called before PeerJS will emit 'stream'.
              target: 'connecting',
              actions: 'answerCall',
            },
            REJECT: {
              // close() on an unanswered call signals rejection to the remote peer.
              target: '#call.ended',
              actions: 'closeCall',
            },
            CALL_CLOSE: {
              // Caller hung up before we answered.
              target: '#call.ended',
            },
            CALL_ERROR: {
              target: '#call.error',
              actions: 'notifyParentError',
            },
          },
        },

        connecting: {
          // Waiting for the remote media stream to arrive. This can take a
          // moment for ICE negotiation to complete. HANG_UP is accepted here
          // in case the user wants to cancel before the call is established.
          on: {
            CALL_STREAM: {
              target: 'live',
              actions: ['assignRemoteStream', 'notifyParentActive'],
            },
            HANG_UP: {
              target: '#call.ended',
              actions: 'closeCall',
            },
            CALL_CLOSE: {
              target: '#call.ended',
            },
            CALL_ERROR: {
              target: '#call.error',
              actions: 'notifyParentError',
            },
          },
        },

        live: {
          // The call is fully established and streams are flowing.
          on: {
            HANG_UP: {
              target: '#call.ended',
              actions: 'closeCall',
            },
            CALL_CLOSE: {
              // Remote peer hung up.
              target: '#call.ended',
            },
            CALL_ERROR: {
              target: '#call.error',
              actions: 'notifyParentError',
            },
          },
        },
      },
    },

    ended: {
      // notifyParentEnded fires on entry — covers both caller-initiated (REJECT,
      // HANG_UP) and remote-initiated (CALL_CLOSE) clean endings.
      type: 'final',
      entry: 'notifyParentEnded',
    },

    error: {
      // notifyParentError was already fired as a transition action.
      type: 'final',
    },
  },
});
