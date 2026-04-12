import type { PeerEmittedEvent } from '../peer/types';

export const SIGNALING_MESSAGE_TYPES = new Set([
  'remote_close',
  'call_rejected',
  'call_declined',
  'call_held',
  'call_resumed',
] as const);

export type SignalingMessage =
  | { type: 'remote_close'; callId: string }
  | { type: 'call_rejected'; callId: string }
  | { type: 'call_declined'; callId: string }
  | { type: 'call_held'; callId: string }
  | { type: 'call_resumed'; callId: string };

/**
 * Runtime type guard for incoming data that may be a signaling message.
 * Validates both the structure and the type discriminant.
 */
export function isSignalingMessage(data: unknown): data is SignalingMessage {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.type === 'string' &&
    typeof record.callId === 'string' &&
    SIGNALING_MESSAGE_TYPES.has(record.type as any)
  );
}

export type SignalingHandler = (message: SignalingMessage, connectionId: string) => void;

export interface SignalingServiceConfig {
  getConnection: (remotePeerId: string) => { connectionId: string; send: (data: unknown) => void } | null;
  emit: (event: PeerEmittedEvent) => void;
  notifyChange: () => void;
}