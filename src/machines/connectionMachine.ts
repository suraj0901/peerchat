import { setup, fromCallback, sendParent } from 'xstate';
import type { DataConnection, PeerError } from 'peerjs';
import type {
  ConnectionContext,
  ConnectionEvent,
  ConnectionCallbackEvent,
  ConnectionInput,
  ConnectionParentEvent,
} from './types';

// ── Event Source ──────────────────────────────────────────────────────────────

/**
 * Bridges the PeerJS DataConnection event emitter into the XState event system.
 *
 * Lifetime: alive for as long as the 'active' compound state is entered,
 * which covers both 'connecting' and 'open' sub-states.
 *
 * Note: PeerJS does not expose removeListener/off on DataConnection, so
 * cleanup relies on connection.close() rather than explicit listener removal.
 */
const connectionEventSource = fromCallback<ConnectionCallbackEvent, DataConnection>(
  ({ input: connection, sendBack }: { input: DataConnection; sendBack: (event: ConnectionCallbackEvent) => void }) => {
    connection.on('open', () =>
      sendBack({ type: 'CONNECTION_OPEN' })
    );
    connection.on('data', (data) =>
      sendBack({ type: 'CONNECTION_DATA', data })
    );
    connection.on('close', () =>
      sendBack({ type: 'CONNECTION_CLOSE' })
    );
    connection.on('error', (error: PeerError<string>) =>
      sendBack({ type: 'CONNECTION_ERROR', error })
    );

    return () => {
      // PeerJS does not support removeListener — teardown is via connection.close()
    };
  }
);

// ── Machine ───────────────────────────────────────────────────────────────────

/**
 * Models the lifecycle of a single PeerJS DataConnection.
 *
 * States:
 *   active.connecting  — waiting for PeerJS to confirm the connection is open
 *   active.open        — ready to send/receive data
 *   closed             — final; connection ended cleanly
 *   error              — final; connection ended with an error
 *
 * Parent communication:
 *   All significant transitions send a ConnectionParentEvent to the parent
 *   peer machine via sendParent. External consumers should observe the peer
 *   machine's emitted events rather than this actor directly.
 *
 * Commands accepted:
 *   SEND  — only processed in 'open'; silently ignored otherwise (guard on parent)
 *   CLOSE — only processed in 'open'; triggers connection.close() then → closed
 */
export const connectionMachine = setup({
  types: {
    context: {} as ConnectionContext,
    events: {} as ConnectionEvent,
    input: {} as ConnectionInput,
  },
  actors: { connectionEventSource },
  actions: {
    notifyParentOpened: sendParent(
      ({ context }): ConnectionParentEvent => ({
        type: 'CONNECTION_ACTOR_OPENED',
        connectionId: context.connectionId,
        remotePeerId: context.remotePeerId,
      })
    ),

    notifyParentClosed: sendParent(
      ({ context }): ConnectionParentEvent => ({
        type: 'CONNECTION_ACTOR_CLOSED',
        connectionId: context.connectionId,
      })
    ),

    notifyParentError: sendParent(
      ({ context, event }): ConnectionParentEvent => ({
        type: 'CONNECTION_ACTOR_ERROR',
        connectionId: context.connectionId,
        error: (event as Extract<ConnectionEvent, { type: 'CONNECTION_ERROR' }>).error,
      })
    ),

    notifyParentData: sendParent(
      ({ context, event }): ConnectionParentEvent => ({
        type: 'CONNECTION_ACTOR_DATA',
        connectionId: context.connectionId,
        data: (event as Extract<ConnectionEvent, { type: 'CONNECTION_DATA' }>).data,
      })
    ),

    sendData: ({ context, event }) => {
      const { data } = event as Extract<ConnectionEvent, { type: 'SEND' }>;
      context.connection.send(data);
    },

    closeConnection: ({ context }) => {
      context.connection.close();
    },
  },
}).createMachine({
  id: 'connection',
  context: ({ input }) => ({ ...input }),

  initial: 'active',
  states: {
    active: {
      // The event source lives here — it is torn down when we leave 'active'
      // (i.e. when we enter the 'closed' or 'error' terminal states).
      invoke: {
        id: 'connectionEvents',
        src: 'connectionEventSource',
        input: ({ context }) => context.connection,
      },
      initial: 'connecting',
      states: {
        connecting: {
          on: {
            CONNECTION_OPEN: {
              target: 'open',
              actions: 'notifyParentOpened',
            },
            CONNECTION_CLOSE: {
              // Remote end closed before we even opened — treat as clean close
              target: '#connection.closed',
            },
            CONNECTION_ERROR: {
              target: '#connection.error',
              actions: 'notifyParentError',
            },
          },
        },

        open: {
          on: {
            SEND: {
              actions: 'sendData',
            },
            CLOSE: {
              // Caller-initiated close: fire close() then transition
              target: '#connection.closed',
              actions: 'closeConnection',
            },
            CONNECTION_DATA: {
              actions: 'notifyParentData',
            },
            CONNECTION_CLOSE: {
              // Remote-initiated or server-initiated close
              target: '#connection.closed',
            },
            CONNECTION_ERROR: {
              target: '#connection.error',
              actions: 'notifyParentError',
            },
          },
        },
      },
    },

    closed: {
      // notifyParentClosed runs on entry so the parent can clean up its ref.
      // This fires for both caller-initiated and remote-initiated closes.
      type: 'final',
      entry: 'notifyParentClosed',
    },

    error: {
      // notifyParentError is fired as a transition action before entering here,
      // so no additional entry action is needed.
      type: 'final',
    },
  },
});
