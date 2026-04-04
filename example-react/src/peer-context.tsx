import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import Peer from 'peerjs';
import { PeerManager } from 'peerchat';
import type { PeerState } from 'peerchat';
import { useMachineState } from './use-machine';

// ── Context ──────────────────────────────────────────────────────────────────

interface PeerContextValue {
  manager: PeerManager;
  state: PeerState;
}

const PeerContext = createContext<PeerContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function PeerProvider({ children }: { children: ReactNode }) {
  const managerRef = useRef<PeerManager>(undefined);

  if (!managerRef.current) {
    managerRef.current = new PeerManager({ peer: new Peer() });
  }

  const state = useMachineState(managerRef.current);

  useEffect(() => {
    return () => managerRef.current?.destroy();
  }, []);

  return (
    <PeerContext.Provider value={{ manager: managerRef.current, state }}>
      {children}
    </PeerContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePeerContext(): PeerContextValue {
  const ctx = useContext(PeerContext);
  if (!ctx) throw new Error('usePeerContext must be used within <PeerProvider>');
  return ctx;
}
