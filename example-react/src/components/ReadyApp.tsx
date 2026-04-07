// ═══════════════════════════════════════════════════════════════════════════════
// ReadyApp — peer is connected, this is the main experience
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useMediaContext } from '../context/media-context';
import type { CallState, ConnectionState } from 'peerchat';
import type { AnyMachine, PeerReadyState } from '../types';
import { Notifications } from './Notifications';
import { HomeScreen } from './HomeScreen';
import { useNotifications } from '../hooks/useNotifications';
import { usePeerContext } from '../context/peer-context';
import { IncomingCallOverlay } from './IncomingCallOverlay';
import { LiveCallScreen } from './LiveCallScreen';



export function ReadyApp({ state }: { state: PeerReadyState }) {
  const { manager } = usePeerContext();
  const { machine: media } = useMediaContext();
  const { notifications, add: addNotification, dismiss: dismissNotification } = useNotifications();

  // ── Wire events → notifications ───────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      manager.on('peer.error', (e) => {
        addNotification('error', 'Connection Error', e.error.message);
      }),
      manager.on('connection.error', (e) => {
        addNotification('error', 'Connection Error', e.error.message);
      }),
      media.on('media.stream.error', (e) => {
        addNotification('error', 'Media Error', e.error.message);
      }),
      media.on('media.permission.denied', () => {
        addNotification('error', 'Permission Denied', 'Camera/microphone access was denied.');
      }),
      media.on('media.track.ended', (e) => {
        addNotification('info', 'Track Lost', `Your ${e.kind} track ended. Recovering…`);
      }),
      media.on('media.device.switched', (e) => {
        addNotification('info', 'Device Switched', `${e.kind === 'audio' ? 'Microphone' : 'Camera'} switched.`);
      }),
      media.on('media.device.switch.failed', (e) => {
        addNotification('error', 'Switch Failed', `Could not switch ${e.kind}: ${e.error.message}`);
      }),
      manager.on('call.ended', () => {
        addNotification('info', 'Call Ended', 'The call has ended.');
      }),
      manager.on('call.error', (e) => {
        addNotification('error', 'Call Error', e.error.message);
      }),
      manager.on('call.declined', () => {
        addNotification('info', 'Call Declined', 'Your call was declined.');
      }),
      manager.on('call.rejected', () => {
        addNotification('info', 'Call Rejected', 'Your call was rejected (busy).');
      })
    ];
    return () => unsubs.forEach((s) => s.unsubscribe());
  }, [manager, media, addNotification]);

  // ── Find the first live call (if any) ──────────────────────────────────
  let liveCallEntry: [string, AnyMachine<CallState>] | null = null;
  let ringingCallEntry: [string, AnyMachine<CallState>] | null = null;

  for (const [id, machine] of state.calls) {
    const s = machine.callMachine.getState();
    if (s._tag === 'live' || s._tag === 'connecting') {
      liveCallEntry = [id, machine.callMachine];
    }
    if (s._tag === 'ringing') {
      ringingCallEntry = [id, machine.callMachine];
    }
  }

  // ── Find the first open connection (if any) ───────────────────────────
  let openConnectionEntry: [string, AnyMachine<ConnectionState>] | null = null;
  for (const [id, machine] of state.connections) {
    if (machine.getState()._tag === 'open' || machine.getState()._tag === 'connecting') {
      openConnectionEntry = [id, machine];
    }
  }

  return (
    <div className="app">
      <Notifications notifications={notifications} onDismiss={dismissNotification} />

      {/* Incoming call overlay — shown when a call is ringing */}
      {ringingCallEntry && (
        <IncomingCallOverlay
          key={ringingCallEntry[0]}
          machine={ringingCallEntry[1]}
        />
      )}

      {/* Main content: home screen or live call */}
      {liveCallEntry ? (
        <LiveCallScreen
          key={liveCallEntry[0]}
          callMachine={liveCallEntry[1]}
          connectionMachine={openConnectionEntry?.[1] ?? null}
        />
      ) : (
        <HomeScreen peerState={state} />
      )}
    </div>
  );
}