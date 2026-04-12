export const PeerEvents = {
  READY: 'peer.ready',
  DISCONNECTED: 'peer.disconnected',
  ERROR: 'peer.error',
} as const;

export const CallEvents = {
  INCOMING: 'call.incoming',
  ACTIVE: 'call.active',
  ENDED: 'call.ended',
  ERROR: 'call.error',
  REJECTED: 'call.rejected',
  DECLINED: 'call.declined',
  HELD: 'call.held',
  RESUMED: 'call.resumed',
  REMOTE_HELD: 'call.remoteHeld',
  REMOTE_RESUMED: 'call.remoteResumed',
} as const;

export const ConnectionEvents = {
  OPENED: 'connection.opened',
  CLOSED: 'connection.closed',
  ERROR: 'connection.error',
  DATA: 'connection.data',
} as const;

export const MediaEvents = {
  STREAM_READY: 'media.stream.ready',
  STREAM_STOPPED: 'media.stream.stopped',
  STREAM_ERROR: 'media.stream.error',
  PERMISSION_DENIED: 'media.permission.denied',
  PERMISSION_STATUS: 'media.permission.status',
  TRACK_ENDED: 'media.track.ended',
  RECOVERING: 'media.recovering',
  DEVICE_SWITCHED: 'media.device.switched',
  DEVICE_SWITCH_FAILED: 'media.device.switch.failed',
  DEVICES_UPDATED: 'media.devices.updated',
  AUDIO_TOGGLED: 'media.audio.toggled',
  VIDEO_TOGGLED: 'media.video.toggled',
} as const;