import type { PeerState } from 'peerchat';
import { PeerManager } from 'peerchat';
import Peer from 'peerjs';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMachineState } from '../hooks/use-machine';

// ── Context ──────────────────────────────────────────────────────────────────

interface PeerContextValue {
  manager: PeerManager;
  state: PeerState;
}

const PeerContext = createContext<PeerContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function PeerProvider({ children }: { children: ReactNode }) {
  const [manager] = useState<PeerManager>(() => {
    return new PeerManager({ peer: new Peer() })
  });


  const state = useMachineState(manager);

  useEffect(() => {
    return () => {
      manager.destroy()
    }
  }, [manager]);

  return (
    <PeerContext.Provider value={{ manager, state }}>
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
