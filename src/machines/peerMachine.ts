import { setup, fromCallback, assign, sendTo, emit } from 'xstate';
import type { Peer, DataConnection, MediaConnection, PeerError } from 'peerjs';
import { connectionMachine } from './connectionMachine';
import { callMachine } from './callMachine';
import type {
  PeerContext,
  PeerEvent,
  PeerCallbackEvent,
  PeerCommand,
  PeerInput,
  PeerEmittedEvent,
  ConnectionParentEvent,
  ConnectionRef,
  CallParentEvent,
  CallRef,
} from './types';
import { FATAL_PEER_ERROR_TYPES } from './types';

// ── Event Source ──────────────────────────────────────────────────────────────

/**
 * Bridges the PeerJS Peer event emitter into the XState event system.
 *
 * Lifetime: alive for the entire 'alive' compound state, which spans
 * initializing, ready, and disconnected sub-states. A single long-lived
 * source is correct here — the Peer object persists across reconnections.
 */
const peerEventSource = fromCallback<PeerCallbackEvent, Peer>(
  ({ input: peer, sendBack }: { input: Peer; sendBack: (event: PeerCallbackEvent) => void }) => {
    peer.on('open', (id) =>
      sendBack({ type: 'PEER_OPEN', id })
    );
    peer.on('connection', (connection: DataConnection) =>
      sendBack({ type: 'PEER_CONNECTION', connection })
    );
    peer.on('call', (call: MediaConnection) =>
      sendBack({ type: 'PEER_CALL', call })
    );
    peer.on('disconnected', () =>
      sendBack({ type: 'PEER_DISCONNECTED' })
    );
    peer.on('error', (error: PeerError<string>) =>
      sendBack({ type: 'PEER_ERROR', error })
    );
    peer.on('close', () =>
      sendBack({ type: 'PEER_CLOSE' })
    );

    return () => {
      // PeerJS does not support removeListener — teardown is via peer.destroy()
    };
  }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

const isFatalError = (error: PeerError<string>): boolean =>
  (FATAL_PEER_ERROR_TYPES as ReadonlyArray<string>).includes(error.type);

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

// ── Machine ───────────────────────────────────────────────────────────────────

/**
 * Models the full lifecycle of a PeerJS Peer, including signaling server
 * connectivity, all spawned DataConnection actors, and all spawned call actors.
 *
 * States:
 *   alive.initializing  — peer created, waiting for signaling server handshake
 *   alive.ready         — fully operational; manages connection and call actors
 *   alive.disconnected  — lost signaling server connection; can reconnect
 *   error               — final; fatal PeerJS error, Peer instance is unusable
 *   destroyed           — final; peer.destroy() was called
 *
 * Data connections — managed by connectionMachine child actors:
 *   CONNECT_TO             → outbound DataConnection
 *   PEER_CONNECTION        → inbound DataConnection
 *   SEND / CLOSE_CONNECTION → forwarded to the appropriate actor
 *
 * Media calls — managed by callMachine child actors:
 *   CALL                   → outbound MediaConnection (peer.call())
 *   PEER_CALL              → inbound MediaConnection (peer.on('call'))
 *   ANSWER_CALL            → forwarded to the call actor (triggers call.answer())
 *   REJECT_CALL            → forwarded to the call actor (triggers call.close())
 *   HANG_UP                → forwarded to the call actor (triggers call.close())
 *
 * Observable events (via actor.on(...)):
 *   peer.ready           — signaling handshake complete, peerId available
 *   peer.disconnected    — lost signaling server connection
 *   peer.error           — a PeerJS error occurred (fatal or non-fatal)
 *   connection.opened    — a DataConnection is fully open and ready
 *   connection.closed    — a DataConnection closed cleanly
 *   connection.error     — a DataConnection closed with an error
 *   connection.data      — data received on a DataConnection
 *   call.incoming        — an inbound call is ringing; call ANSWER_CALL or REJECT_CALL
 *   call.active          — a call is live; remoteStream is available
 *   call.ended           — a call ended cleanly (either side hung up)
 *   call.error           — a call ended with an error
 */
export const peerMachine = setup({
  types: {
    context: {} as PeerContext,
    events: {} as PeerEvent,
    input: {} as PeerInput,
    emitted: {} as PeerEmittedEvent,
  },
  actors: { peerEventSource, connectionMachine, callMachine },

  actions: {
    // ── Peer operations ──────────────────────────────────────────────────────

    reconnectPeer: ({ context }) => {
      context.peer.reconnect();
    },

    destroyPeer: ({ context }) => {
      context.peer.destroy();
    },

    /**
     * Cleanup all spawned connection/call actors when leaving the 'alive' state.
     * Calls close() on every DataConnection and MediaConnection so PeerJS can
     * tear down the underlying RTCPeerConnections properly.
     */
    cleanupAllActors: ({ context }) => {
      for (const ref of Object.values(context.connections)) {
        try { ref.send({ type: 'CLOSE' }); } catch { /* actor may already be stopped */ }
      }
      for (const ref of Object.values(context.calls)) {
        try { ref.send({ type: 'HANG_UP' }); } catch { /* actor may already be stopped */ }
      }
    },

    // ── Context mutations ────────────────────────────────────────────────────

    assignPeerId: assign({
      peerId: ({ event }) =>
        (event as Extract<PeerEvent, { type: 'PEER_OPEN' }>).id,
    }),

    assignLastError: assign({
      lastError: ({ event }) =>
        (event as Extract<PeerEvent, { type: 'PEER_ERROR' }>).error,
    }),

    clearLastError: assign({ lastError: null }),

    incrementRetryCount: assign({
      retryCount: ({ context }) => context.retryCount + 1,
    }),

    resetRetryCount: assign({ retryCount: 0 }),

    // ── Connection spawning ───────────────────────────────────────────────────

    spawnInboundConnection: assign({
      connections: ({ context, event, spawn }) => {
        const { connection } = event as Extract<PeerEvent, { type: 'PEER_CONNECTION' }>;
        const ref = spawn('connectionMachine', {
          id: `connection-${connection.connectionId}`,
          input: {
            connection,
            connectionId: connection.connectionId,
            remotePeerId: connection.peer,
          },
        });
        return { ...context.connections, [connection.connectionId]: ref } as Record<string, ConnectionRef>;
      },
    }),

    /**
     * Initiates an outbound connection via peer.connect() and spawns an actor for it.
     * peer.connect() is a necessary imperative side-effect with no XState equivalent.
     */
    spawnOutboundConnection: assign({
      connections: ({ context, event, spawn }) => {
        const { remotePeerId } = event as Extract<PeerEvent, { type: 'CONNECT_TO' }>;
        const connection = context.peer.connect(remotePeerId);
        const ref = spawn('connectionMachine', {
          id: `connection-${connection.connectionId}`,
          input: {
            connection,
            connectionId: connection.connectionId,
            remotePeerId,
          },
        });
        return { ...context.connections, [connection.connectionId]: ref } as Record<string, ConnectionRef>;
      },
    }),

    removeConnection: assign({
      connections: ({ context, event }) => {
        const { connectionId } = event as Extract<
          ConnectionParentEvent,
          { type: 'CONNECTION_ACTOR_CLOSED' | 'CONNECTION_ACTOR_ERROR' }
        >;
        return without(context.connections, connectionId);
      },
    }),

    // ── Call spawning ─────────────────────────────────────────────────────────

    /**
     * Spawns an inbound call actor. We emit call.incoming so the application
     * layer knows it should call ANSWER_CALL (with a local stream) or REJECT_CALL.
     */
    spawnInboundCall: assign({
      calls: ({ context, event, spawn }) => {
        const { call } = event as Extract<PeerEvent, { type: 'PEER_CALL' }>;
        const callId = call.connectionId;
        const ref = spawn('callMachine', {
          id: `call-${callId}`,
          input: {
            call,
            callId,
            remotePeerId: call.peer,
            direction: 'inbound' as const,
          },
        });
        return { ...context.calls, [callId]: ref } as Record<string, CallRef>;
      },
    }),

    /**
     * Initiates an outbound call via peer.call() and spawns an actor for it.
     * The localStream is passed directly to peer.call() — PeerJS attaches it
     * to the RTCPeerConnection before the offer is sent.
     */
    spawnOutboundCall: assign({
      calls: ({ context, event, spawn }) => {
        const { remotePeerId, localStream } = event as Extract<PeerEvent, { type: 'CALL' }>;
        const call = context.peer.call(remotePeerId, localStream);
        const callId = call.connectionId;
        const ref = spawn('callMachine', {
          id: `call-${callId}`,
          input: {
            call,
            callId,
            remotePeerId,
            direction: 'outbound' as const,
          },
        });
        return { ...context.calls, [callId]: ref } as Record<string, CallRef>;
      },
    }),

    removeCall: assign({
      calls: ({ context, event }) => {
        const { callId } = event as Extract<
          CallParentEvent,
          { type: 'CALL_ACTOR_ENDED' | 'CALL_ACTOR_ERROR' }
        >;
        return without(context.calls, callId);
      },
    }),

    // ── Commands forwarded to connection actors ───────────────────────────────

    forwardSend: sendTo(
      ({ context, event }) => {
        const { connectionId } = event as Extract<PeerCommand, { type: 'SEND' }>;
        return context.connections[connectionId]!;
      },
      ({ event }) => {
        const { data } = event as Extract<PeerCommand, { type: 'SEND' }>;
        return { type: 'SEND' as const, data };
      }
    ),

    forwardClose: sendTo(
      ({ context, event }) => {
        const { connectionId } = event as Extract<PeerCommand, { type: 'CLOSE_CONNECTION' }>;
        return context.connections[connectionId]!;
      },
      { type: 'CLOSE' as const }
    ),

    // ── Commands forwarded to call actors ─────────────────────────────────────

    forwardAnswer: sendTo(
      ({ context, event }) => {
        const { callId } = event as Extract<PeerCommand, { type: 'ANSWER_CALL' }>;
        return context.calls[callId]!;
      },
      ({ event }) => {
        const { localStream } = event as Extract<PeerCommand, { type: 'ANSWER_CALL' }>;
        return { type: 'ANSWER' as const, localStream };
      }
    ),

    forwardReject: sendTo(
      ({ context, event }) => {
        const { callId } = event as Extract<PeerCommand, { type: 'REJECT_CALL' }>;
        return context.calls[callId]!;
      },
      { type: 'REJECT' as const }
    ),

    forwardHangUp: sendTo(
      ({ context, event }) => {
        const { callId } = event as Extract<PeerCommand, { type: 'HANG_UP' }>;
        return context.calls[callId]!;
      },
      { type: 'HANG_UP' as const }
    ),

    // ── Emitted events (observable by external subscribers) ──────────────────

    emitPeerReady: emit(({ event }): PeerEmittedEvent => ({
      type: 'peer.ready',
      // Read from event rather than context to avoid assign-ordering ambiguity
      peerId: (event as Extract<PeerEvent, { type: 'PEER_OPEN' }>).id,
    })),

    emitPeerDisconnected: emit((): PeerEmittedEvent => ({
      type: 'peer.disconnected',
    })),

    emitPeerError: emit(({ event }): PeerEmittedEvent => ({
      type: 'peer.error',
      error: (event as Extract<PeerEvent, { type: 'PEER_ERROR' }>).error,
    })),

    emitConnectionOpened: emit(({ event }): PeerEmittedEvent => {
      const e = event as Extract<ConnectionParentEvent, { type: 'CONNECTION_ACTOR_OPENED' }>;
      return { type: 'connection.opened', connectionId: e.connectionId, remotePeerId: e.remotePeerId };
    }),

    emitConnectionClosed: emit(({ event }): PeerEmittedEvent => ({
      type: 'connection.closed',
      connectionId: (event as Extract<ConnectionParentEvent, { type: 'CONNECTION_ACTOR_CLOSED' }>)
        .connectionId,
    })),

    emitConnectionError: emit(({ event }): PeerEmittedEvent => {
      const e = event as Extract<ConnectionParentEvent, { type: 'CONNECTION_ACTOR_ERROR' }>;
      return { type: 'connection.error', connectionId: e.connectionId, error: e.error };
    }),

    emitConnectionData: emit(({ event }): PeerEmittedEvent => {
      const e = event as Extract<ConnectionParentEvent, { type: 'CONNECTION_ACTOR_DATA' }>;
      return { type: 'connection.data', connectionId: e.connectionId, data: e.data };
    }),

    emitCallIncoming: emit(({ event }): PeerEmittedEvent => {
      const { call } = event as Extract<PeerEvent, { type: 'PEER_CALL' }>;
      return { type: 'call.incoming', callId: call.connectionId, remotePeerId: call.peer };
    }),

    emitCallActive: emit(({ event }): PeerEmittedEvent => {
      const e = event as Extract<CallParentEvent, { type: 'CALL_ACTOR_ACTIVE' }>;
      return {
        type: 'call.active',
        callId: e.callId,
        remotePeerId: e.remotePeerId,
        remoteStream: e.remoteStream,
      };
    }),

    emitCallEnded: emit(({ event }): PeerEmittedEvent => ({
      type: 'call.ended',
      callId: (event as Extract<CallParentEvent, { type: 'CALL_ACTOR_ENDED' }>).callId,
    })),

    emitCallError: emit(({ event }): PeerEmittedEvent => {
      const e = event as Extract<CallParentEvent, { type: 'CALL_ACTOR_ERROR' }>;
      return { type: 'call.error', callId: e.callId, error: e.error };
    }),
  },

  guards: {
    isFatalPeerError: ({ event }) =>
      isFatalError((event as Extract<PeerEvent, { type: 'PEER_ERROR' }>).error),

    connectionExists: ({ context, event }) => {
      const e = event as Extract<PeerCommand, { type: 'SEND' | 'CLOSE_CONNECTION' }>;
      return e.connectionId in context.connections;
    },

    callExists: ({ context, event }) => {
      const e = event as Extract<PeerCommand, { type: 'ANSWER_CALL' | 'REJECT_CALL' | 'HANG_UP' }>;
      return e.callId in context.calls;
    },

    /** Prevents spawning duplicate connections to the same remote peer. */
    connectionNotDuplicate: ({ context, event }) => {
      const { remotePeerId } = event as Extract<PeerCommand, { type: 'CONNECT_TO' }>;
      return !Object.values(context.connections).some(
        ref => ref.getSnapshot().context.remotePeerId === remotePeerId
      );
    },

    /** Prevents spawning duplicate calls to the same remote peer. */
    callNotDuplicate: ({ context, event }) => {
      const { remotePeerId } = event as Extract<PeerCommand, { type: 'CALL' }>;
      return !Object.values(context.calls).some(
        ref => ref.getSnapshot().context.remotePeerId === remotePeerId
      );
    },

    canAutoReconnect: ({ context }) =>
      context.retryCount < context.maxRetries,
  },

  delays: {
    RECONNECT_DELAY: ({ context }) =>
      Math.min(context.baseRetryDelay * 2 ** context.retryCount, 30_000),
  },
}).createMachine({
  id: 'peer',
  context: ({ input }) => ({
    peer: input.peer,
    peerId: null,
    connections: {},
    calls: {},
    lastError: null,
    retryCount: 0,
    maxRetries: input.maxRetries ?? 5,
    baseRetryDelay: input.baseRetryDelay ?? 1000,
  }),

  initial: 'alive',
  states: {
    /**
     * The peer instance is alive. The peerEventSource runs for the entire
     * duration of this compound state — it persists across reconnections
     * because the underlying Peer object is the same instance.
     */
    alive: {
      invoke: {
        id: 'peerEvents',
        src: 'peerEventSource',
        input: ({ context }) => context.peer,
      },
      // Clean up all spawned actors when leaving 'alive' for any reason
      exit: 'cleanupAllActors',
      initial: 'initializing',
      on: {
        // PeerJS fires 'close' after peer.destroy() — handle it at the
        // compound state level so it works regardless of sub-state.
        PEER_CLOSE: {
          target: '#peer.destroyed',
        },
      },
      states: {
        initializing: {
          on: {
            PEER_OPEN: {
              target: 'ready',
              actions: ['assignPeerId', 'clearLastError', 'resetRetryCount', 'emitPeerReady'],
            },
            PEER_ERROR: [
              {
                guard: 'isFatalPeerError',
                target: '#peer.error',
                actions: ['assignLastError', 'emitPeerError'],
              },
              {
                actions: ['assignLastError', 'emitPeerError'],
              },
            ],
          },
        },

        ready: {
          on: {
            // ── Data connections ─────────────────────────────────────────────
            PEER_CONNECTION: {
              actions: 'spawnInboundConnection',
            },
            CONNECT_TO: {
              guard: 'connectionNotDuplicate',
              actions: 'spawnOutboundConnection',
            },
            SEND: {
              guard: 'connectionExists',
              actions: 'forwardSend',
            },
            CLOSE_CONNECTION: {
              guard: 'connectionExists',
              actions: 'forwardClose',
            },
            CONNECTION_ACTOR_OPENED: {
              actions: 'emitConnectionOpened',
            },
            CONNECTION_ACTOR_CLOSED: {
              actions: ['emitConnectionClosed', 'removeConnection'],
            },
            CONNECTION_ACTOR_ERROR: {
              actions: ['emitConnectionError', 'removeConnection'],
            },
            CONNECTION_ACTOR_DATA: {
              actions: 'emitConnectionData',
            },

            // ── Media calls ──────────────────────────────────────────────────
            PEER_CALL: {
              // Inbound call received — spawn actor and notify caller so they
              // can call ANSWER_CALL or REJECT_CALL with the returned callId.
              actions: ['spawnInboundCall', 'emitCallIncoming'],
            },
            CALL: {
              // Outbound call — peer.call() is called inside spawnOutboundCall.
              guard: 'callNotDuplicate',
              actions: 'spawnOutboundCall',
            },
            ANSWER_CALL: {
              guard: 'callExists',
              actions: 'forwardAnswer',
            },
            REJECT_CALL: {
              guard: 'callExists',
              actions: 'forwardReject',
            },
            HANG_UP: {
              guard: 'callExists',
              actions: 'forwardHangUp',
            },
            CALL_ACTOR_ACTIVE: {
              actions: 'emitCallActive',
            },
            CALL_ACTOR_ENDED: {
              actions: ['emitCallEnded', 'removeCall'],
            },
            CALL_ACTOR_ERROR: {
              actions: ['emitCallError', 'removeCall'],
            },

            // ── Signaling server ─────────────────────────────────────────────
            PEER_DISCONNECTED: {
              target: 'disconnected',
              actions: 'emitPeerDisconnected',
            },

            // ── Errors ───────────────────────────────────────────────────────
            PEER_ERROR: [
              {
                guard: 'isFatalPeerError',
                target: '#peer.error',
                actions: ['assignLastError', 'emitPeerError'],
              },
              {
                actions: ['assignLastError', 'emitPeerError'],
              },
            ],

            // ── Teardown ─────────────────────────────────────────────────────
            DESTROY: {
              target: '#peer.destroyed',
              actions: 'destroyPeer',
            },
          },
        },

        disconnected: {
          // Automatic reconnection with exponential backoff
          after: {
            RECONNECT_DELAY: {
              guard: 'canAutoReconnect',
              target: 'initializing',
              actions: ['incrementRetryCount', 'reconnectPeer'],
            },
          },
          on: {
            // Manual reconnect bypasses the backoff timer
            RECONNECT: {
              target: 'initializing',
              actions: 'reconnectPeer',
            },
            PEER_ERROR: {
              actions: ['assignLastError', 'emitPeerError'],
            },
            DESTROY: {
              target: '#peer.destroyed',
              actions: 'destroyPeer',
            },
          },
        },
      },
    },

    /** Fatal PeerJS error — the Peer instance cannot be recovered. */
    error: {
      type: 'final',
    },

    /** peer.destroy() was explicitly called. */
    destroyed: {
      type: 'final',
    },
  },
});
