import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { MediaMachine } from 'peerchat';
import type { MediaState } from 'peerchat';
import { useMachineState } from './use-machine';

// ── Context ──────────────────────────────────────────────────────────────────

interface MediaContextValue {
  machine: MediaMachine;
  state: MediaState;
}

const MediaContext = createContext<MediaContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function MediaProvider({ children }: { children: ReactNode }) {
  const machineRef = useRef<MediaMachine>(undefined);

  if (!machineRef.current) {
    machineRef.current = new MediaMachine();
  }

  const state = useMachineState(machineRef.current);

  useEffect(() => {
    return () => machineRef.current?.destroy();
  }, []);

  return (
    <MediaContext.Provider value={{ machine: machineRef.current, state }}>
      {children}
    </MediaContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMediaContext(): MediaContextValue {
  const ctx = useContext(MediaContext);
  if (!ctx) throw new Error('useMediaContext must be used within <MediaProvider>');
  return ctx;
}
