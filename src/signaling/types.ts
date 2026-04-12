import type { PeerEmittedEvent } from '../peer/types';

export type SignalingMessage =
  | { type: 'remote_close'; callId: string }
  | { type: 'call_rejected'; callId: string }
  | { type: 'call_declined'; callId: string }
  | { type: 'call_held'; callId: string }
  | { type: 'call_resumed'; callId: string };

export type SignalingHandler = (message: SignalingMessage, connectionId: string) => void;

export interface SignalingServiceConfig {
  getConnection: (remotePeerId: string) => { connectionId: string; send: (data: unknown) => void } | null;
  emit: (event: PeerEmittedEvent) => void;
  notifyChange: () => void;
}