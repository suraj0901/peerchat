import type { PeerState } from 'peerchat';

// ── Types ────────────────────────────────────────────────────────────────────
// We need to reference child machine types. Since CallMachine/ConnectionMachine
// are not exported from the public API, we use structural typing.
export type AnyMachine<S> = {
  subscribe(cb: () => void): { unsubscribe(): void; };
  getState(): S;
  destroy(): void;
};

// PeerReadyState is the narrowed type here.
// Safe to access: state.peerId, state.calls, state.connections, state.call(), state.connect()
export type PeerReadyState = Extract<PeerState, { _tag: 'ready' }>;
