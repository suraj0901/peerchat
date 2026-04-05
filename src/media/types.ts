// ── Emitted Events ────────────────────────────────────────────────────────────

/**
 * Observable events emitted by the media machine.
 * Subscribe via: machine.on('media.stream.ready', handler)
 */
export type MediaEmittedEvent =
  | { type: 'media.stream.ready'; stream: MediaStream; mode: 'user' | 'screen' }
  | { type: 'media.stream.stopped' }
  | { type: 'media.stream.error'; error: Error }
  | { type: 'media.permission.denied' }
  | { type: 'media.track.ended'; kind: 'audio' | 'video' }
  | { type: 'media.recovering' }
  | { type: 'media.audio.toggled'; muted: boolean }
  | { type: 'media.video.toggled'; muted: boolean }
  | { type: 'media.device.switched'; kind: 'audio' | 'video'; stream: MediaStream }
  | { type: 'media.device.switch.failed'; kind: 'audio' | 'video'; error: Error }
  | { type: 'media.devices.updated'; devices: MediaDeviceInfo[] }
  | { type: 'media.permission.status'; permissions: import('./state').MediaPermissions };
