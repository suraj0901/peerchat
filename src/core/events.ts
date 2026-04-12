export const PeerEvents = {
  READY: 'peer.ready',
  DISCONNECTED: 'peer.disconnected',
  ERROR: 'peer.error',
  DESTROYED: 'peer.destroyed',
  CONNECTION_OPENED: 'connection.opened',
  CONNECTION_CLOSED: 'connection.closed',
  CONNECTION_ERROR: 'connection.error',
  CONNECTION_DATA: 'connection.data',
  CALL_INCOMING: 'call.incoming',
  CALL_ACTIVE: 'call.active',
  CALL_ENDED: 'call.ended',
  CALL_ERROR: 'call.error',
  CALL_REJECTED: 'call.rejected',
  CALL_DECLINED: 'call.declined',
} as const;

export const CallEvents = {
  INCOMING: 'call.incoming',
  ACTIVE: 'call.active',
  ENDED: 'call.ended',
  ERROR: 'call.error',
  REJECTED: 'call.rejected',
  DECLINED: 'call.declined',
} as const;

export const ConnectionEvents = {
  OPENED: 'connection.opened',
  CLOSED: 'connection.closed',
  ERROR: 'connection.error',
  DATA: 'connection.data',
} as const;

export const MediaEvents = {
  ACTIVE: 'media.active',
  INACTIVE: 'media.inactive',
  PERMISSION_STATUS: 'media.permission.status',
  PERMISSION_ERROR: 'media.permission.error',
  DEVICE_CHANGED: 'media.device.changed',
  TRACK_ENDED: 'media.track.ended',
  TRACK_MUTED: 'media.track.muted',
  TRACK_UNMUTED: 'media.track.unmuted',
  STREAM_READY: 'media.stream.ready',
  STREAM_STOPPED: 'media.stream.stopped',
  STREAM_ERROR: 'media.stream.error',
  RECOVERING: 'media.recovering',
  RECOVERED: 'media.recovered',
  AUDIO_TOGGLED: 'media.audio.toggled',
  VIDEO_TOGGLED: 'media.video.toggled',
  DEVICE_SWITCHED: 'media.device.switched',
  DEVICE_SWITCH_FAILED: 'media.device.switch.failed',
  DEVICES_UPDATED: 'media.devices.updated',
  PERMISSION_DENIED: 'media.permission.denied',
} as const;