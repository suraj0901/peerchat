import type { MediaConnection } from 'peerjs';
import { createMachine } from '../../core';
import {
  transition as callTransition,
  initialEffects as callInitialEffects,
} from '../../call/transitions';
import type { CallState, CallEvent, CallParentEvent } from '../../call/types';
import type {
  PeerState,
  PeerReady,
  PeerEvent,
  PeerEffect,
  CallChild,
} from '../types';
import { emit } from '../effects';

// ── Child Spawning ────────────────────────────────────────────────────────────

/** Create a call child machine and wire its parent events. */
function spawnCallChild(
  call: MediaConnection,
  callId: string,
  remotePeerId: string,
  direction: 'inbound' | 'outbound',
  parentSend: (event: PeerEvent) => void,
): CallChild {
  const initialState: CallState = direction === 'inbound'
    ? { _tag: 'ringing', call, callId, remotePeerId, direction: 'inbound' }
    : { _tag: 'connecting', call, callId, remotePeerId, direction: 'outbound' };

  const child = createMachine<CallState, CallEvent, CallParentEvent>(
    callTransition,
    initialState,
    callInitialEffects(call, direction),
  );

  // Route child emitted events to parent
  child.on('CALL_ACTIVE', (e) =>
    parentSend({ type: 'CHILD_CALL_ACTIVE', callId: e.callId, remotePeerId: e.remotePeerId, remoteStream: e.remoteStream }));
  child.on('CALL_ENDED', (e) =>
    parentSend({ type: 'CHILD_CALL_ENDED', callId: e.callId }));
  child.on('CALL_ERROR_PARENT', (e) =>
    parentSend({ type: 'CHILD_CALL_ERROR', callId: e.callId, error: e.error }));

  return child;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Remove a call child, destroying it and returning updated state + effects. */
function removeCall(
  state: PeerReady,
  callId: string,
  emitEvent: PeerEffect,
): [PeerState, PeerEffect[]] {
  const child = state.calls.get(callId);
  if (child) child.destroy();
  const newCalls = new Map(state.calls);
  newCalls.delete(callId);
  return [{ ...state, calls: newCalls }, [emitEvent]];
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handles all call-related events in the `ready` state.
 * Returns `null` if the event is not call-related.
 */
export function handleCallEvent(
  state: PeerReady,
  event: PeerEvent,
  parentSend: (event: PeerEvent) => void,
): [PeerState, PeerEffect[]] | null {
  switch (event.type) {
    case 'PEER_CALL': {
      const call = event.call;
      const callId = call.connectionId;
      const child = spawnCallChild(call, callId, call.peer, 'inbound', parentSend);
      const newCalls = new Map(state.calls);
      newCalls.set(callId, child);
      return [
        { ...state, calls: newCalls },
        [emit({ type: 'call.incoming', callId, remotePeerId: call.peer })],
      ];
    }

    case 'CALL': {
      // Guard: prevent duplicate calls
      for (const child of state.calls.values()) {
        const childState = child.getState();
        if ((childState._tag === 'ringing' || childState._tag === 'connecting' || childState._tag === 'live') &&
          childState.remotePeerId === event.remotePeerId) {
          return [state, []]; // Duplicate — ignore
        }
      }
      const call = state.peer.call(event.remotePeerId, event.localStream);
      const callId = call.connectionId;
      const child = spawnCallChild(call, callId, event.remotePeerId, 'outbound', parentSend);
      const newCalls = new Map(state.calls);
      newCalls.set(callId, child);
      return [{ ...state, calls: newCalls }, []];
    }

    case 'ANSWER_CALL': {
      const child = state.calls.get(event.callId);
      if (child) child.send({ type: 'ANSWER', localStream: event.localStream });
      return [state, []];
    }

    case 'REJECT_CALL': {
      const child = state.calls.get(event.callId);
      if (child) child.send({ type: 'REJECT' });
      return [state, []];
    }

    case 'HANG_UP': {
      const child = state.calls.get(event.callId);
      if (child) child.send({ type: 'HANG_UP' });
      return [state, []];
    }

    case 'CHILD_CALL_ACTIVE':
      return [state, [emit({ type: 'call.active', callId: event.callId, remotePeerId: event.remotePeerId, remoteStream: event.remoteStream })]];

    case 'CHILD_CALL_ENDED':
      return removeCall(state, event.callId,
        emit({ type: 'call.ended', callId: event.callId }));

    case 'CHILD_CALL_ERROR':
      return removeCall(state, event.callId,
        emit({ type: 'call.error', callId: event.callId, error: event.error }));

    default:
      return null; // Not a call event
  }
}
