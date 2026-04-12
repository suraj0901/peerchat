import { isState, type MachineContext } from '../core';
import { createLogger } from '../core/logger';
import type { MediaEmittedEvent } from './types';

const log = createLogger('media');

// ── Value Types ───────────────────────────────────────────────────────────────

export type MediaMode = 'user' | 'screen';
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export type MediaPermissions = {
  camera: PermissionState;
  microphone: PermissionState;
};

// ── Context ───────────────────────────────────────────────────────────────────

export interface MediaContext extends MachineContext<MediaState> {
  emit: (event: MediaEmittedEvent) => void;
  notifySubscribers: () => void;
}

// ── Base ──────────────────────────────────────────────────────────────────────

export interface BaseMediaState {
  readonly _tag: 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied';
  permissions: MediaPermissions;
  /** Update permissions in-place. Used by the permission monitor. */
  updatePermissions(permissions: MediaPermissions): void;
  destroy(): void;
  is<T extends 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'>(tag: T): this is Extract<MediaState, { _tag: T }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const isPermissionDenied = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');

// ── MediaIdleState ───────────────────────────────────────────────────────────

export class MediaIdleState implements BaseMediaState {
  public readonly _tag = 'idle';

  constructor(
    public permissions: MediaPermissions,
    private ctx: MediaContext,
  ) {
    log.info('💤 MediaIdleState created', permissions);
  }

  public request(constraints: MediaStreamConstraints) {
    log.info('🎤 request() called', constraints);
    this.destroy();
    const next = new MediaRequestingState('user', constraints, {}, this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public requestScreen(constraints: DisplayMediaStreamOptions = {}) {
    log.info('🖥 requestScreen() called', constraints);
    this.destroy();
    const next = new MediaRequestingState('screen', { audio: true, video: true }, constraints, this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public checkPermissions() {
    log.info('🔑 checkPermissions() called');
    this.destroy();
    const next = new MediaCheckingPermissionsState(this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public updatePermissions(permissions: MediaPermissions) { this.permissions = permissions; }

  public destroy() { }

  public is<T extends 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'>(tag: T): this is Extract<MediaState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── MediaCheckingPermissionsState ────────────────────────────────────────────

export class MediaCheckingPermissionsState implements BaseMediaState {
  public readonly _tag = 'checkingPermissions';
  private aborted = false;

  constructor(
    public permissions: MediaPermissions,
    private ctx: MediaContext,
  ) {
    log.info('🔑 MediaCheckingPermissionsState — querying Permissions API');
    this.check();
  }

  private async check() {
    try {
      if (!navigator.permissions?.query) {
        throw new Error('Permissions API not available');
      }

      const [cam, mic] = await Promise.all([
        navigator.permissions.query({ name: 'camera' as PermissionName }).catch(() => null),
        navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null),
      ]);

      if (this.aborted) {
        log.debug('  permission check aborted — ignoring results');
        return;
      }

      const permissions: MediaPermissions = {
        camera: cam?.state ?? 'unknown',
        microphone: mic?.state ?? 'unknown',
      };

      log.info('  permission check complete', permissions);
      this.destroy();
      const next = new MediaIdleState(permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.permission.status', permissions });
    } catch (error) {
      if (this.aborted) return;
      log.warn('  permission check failed', error);
      this.destroy();
      const next = new MediaIdleState(this.permissions, this.ctx);
      this.ctx.transition(next);
    }
  }

  public updatePermissions(permissions: MediaPermissions) { this.permissions = permissions; }

  public destroy() {
    this.aborted = true;
  }

  public is<T extends 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'>(tag: T): this is Extract<MediaState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── MediaRequestingState ─────────────────────────────────────────────────────

export class MediaRequestingState implements BaseMediaState {
  public readonly _tag = 'requesting';
  private controller = new AbortController();

  constructor(
    public readonly mode: MediaMode,
    public readonly constraints: MediaStreamConstraints,
    public readonly screenConstraints: DisplayMediaStreamOptions,
    public permissions: MediaPermissions,
    private ctx: MediaContext,
  ) {
    log.info(`📡 MediaRequestingState — mode: ${mode}`);
    this.acquire();
  }

  private async acquire() {
    try {
      log.debug(`  acquiring ${this.mode} media...`);
      const stream = this.mode === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia(this.screenConstraints)
        : await navigator.mediaDevices.getUserMedia(this.constraints);

      if (this.controller.signal.aborted) {
        log.debug('  aborted after stream acquired — stopping tracks');
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      log.info(`  ✅ stream acquired — ${stream.getTracks().length} track(s): ${stream.getTracks().map(t => `${t.kind}:${t.readyState}`).join(', ')}`);

      const devices = await navigator.mediaDevices.enumerateDevices();

      if (this.controller.signal.aborted) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      log.debug(`  ${devices.length} devices enumerated`);
      this.destroy();
      const next = new MediaActiveState(stream, devices, this.mode, this.constraints, this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.stream.ready', stream, mode: this.mode });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.destroy();

      if (isPermissionDenied(error)) {
        log.warn('  ⛔ permission denied');
        const next = new MediaDeniedState(this.permissions, this.ctx);
        this.ctx.transition(next);
        this.ctx.emit({ type: 'media.permission.denied' });
      } else {
        log.error('  ❌ stream acquisition failed', error);
        const next = new MediaIdleState(this.permissions, this.ctx);
        this.ctx.transition(next);
        this.ctx.emit({ type: 'media.stream.error', error: toError(error) });
      }
    }
  }

  public stop() {
    log.info('  stop() called while requesting');
    this.destroy();
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public updatePermissions(permissions: MediaPermissions) { this.permissions = permissions; }

  public destroy() {
    this.controller.abort();
  }

  public is<T extends 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'>(tag: T): this is Extract<MediaState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── MediaActiveState ─────────────────────────────────────────────────────────

export class MediaActiveState implements BaseMediaState {
  public readonly _tag = 'active';
  public audioMuted: boolean;
  public videoMuted: boolean;
  private trackHandlers: Array<{ track: MediaStreamTrack; handler: () => void }> = [];
  private deviceChangeHandler: (() => void) | null = null;
  private _devices: MediaDeviceInfo[];

  constructor(
    public readonly stream: MediaStream,
    devices: MediaDeviceInfo[],
    public readonly mode: MediaMode,
    public readonly constraints: MediaStreamConstraints,
    public permissions: MediaPermissions,
    private ctx: MediaContext,
    audioMuted = false,
    videoMuted = false,
  ) {
    this._devices = devices;
    this.audioMuted = audioMuted;
    this.videoMuted = videoMuted;
    // Apply mute state to tracks (important after device switch / recovery)
    stream.getAudioTracks().forEach(t => (t.enabled = !audioMuted));
    stream.getVideoTracks().forEach(t => (t.enabled = !videoMuted));
    log.info(`🟢 MediaActiveState — mode: ${mode}, audioMuted: ${audioMuted}, videoMuted: ${videoMuted}, tracks: ${stream.getTracks().map(t => `${t.kind}:${t.label}`).join(', ')}`);
    this.startMonitoring();
  }

  /** @deprecated Use the getter `getDevices()` instead. The public `devices` property will be removed in a future version. */
  public get devices(): readonly MediaDeviceInfo[] {
    return this._devices;
  }

  private startMonitoring() {
    const watchTrack = (track: MediaStreamTrack, kind: 'audio' | 'video') => {
      const handler = () => this.onTrackEnded(kind);
      track.addEventListener('ended', handler);
      this.trackHandlers.push({ track, handler });
    };

    this.stream.getAudioTracks().forEach(t => watchTrack(t, 'audio'));
    this.stream.getVideoTracks().forEach(t => watchTrack(t, 'video'));

    this.deviceChangeHandler = () => {
      void navigator.mediaDevices.enumerateDevices().then(devices => {
        log.debug(`  device change detected — ${devices.length} devices`);
        this._devices = devices;
        this.ctx.emit({ type: 'media.devices.updated', devices });
      });
    };
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
  }

  private onTrackEnded(kind: 'audio' | 'video') {
    log.warn(`  ⚠️ ${kind} track ended unexpectedly (mode: ${this.mode})`);
    if (this.mode === 'user') {
      // Unexpected track end — attempt recovery
      this.destroy();
      const next = new MediaRecoveringState(this.stream, this.mode, this.constraints, this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.track.ended', kind });
      this.ctx.emit({ type: 'media.recovering' });
    } else {
      // Screen mode — user intentionally stopped sharing
      log.info('  screen share ended by user');
      this.destroy();
      this.stream.getTracks().forEach(t => t.stop());
      const next = new MediaIdleState(this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.stream.stopped' });
    }
  }

  public toggleAudio = () => {
    this.audioMuted = !this.audioMuted;
    this.stream.getAudioTracks().forEach(t => (t.enabled = !this.audioMuted));
    log.info(`  🔇 toggleAudio → ${this.audioMuted ? 'muted' : 'unmuted'}`);
    this.ctx.emit({ type: 'media.audio.toggled', muted: this.audioMuted });
    this.ctx.notifySubscribers()
  }

  public toggleVideo = () => {
    this.videoMuted = !this.videoMuted;
    this.stream.getVideoTracks().forEach(t => (t.enabled = !this.videoMuted));
    log.info(`  📷 toggleVideo → ${this.videoMuted ? 'off' : 'on'}`);
    this.ctx.emit({ type: 'media.video.toggled', muted: this.videoMuted });
    this.ctx.notifySubscribers()
  }

  public switchDevice(kind: 'audio' | 'video', deviceId: string) {
    if (this.mode !== 'user') {
      log.warn(`  switchDevice() ignored — mode is "${this.mode}"`);
      return;
    }
    log.info(`  🔀 switchDevice(${kind}, "${deviceId}")`);
    this.destroy();
    const next = new MediaSwitchingState(this.stream, [...this._devices], this.mode, this.constraints, kind, deviceId, this.permissions, this.ctx, this.audioMuted, this.videoMuted);
    this.ctx.transition(next);
  }

  public stop() {
    log.info('  stop() — stopping all tracks');
    this.destroy();
    this.stream.getTracks().forEach(t => t.stop());
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
    this.ctx.emit({ type: 'media.stream.stopped' });
  }

  public updatePermissions(permissions: MediaPermissions) { this.permissions = permissions; }

  public destroy() {
    this.trackHandlers.forEach(({ track, handler }) => track.removeEventListener('ended', handler));
    this.trackHandlers = [];
    if (this.deviceChangeHandler) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
      this.deviceChangeHandler = null;
    }
  }

  public is<T extends 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'>(tag: T): this is Extract<MediaState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── MediaSwitchingState ──────────────────────────────────────────────────────

export class MediaSwitchingState implements BaseMediaState {
  public readonly _tag = 'switching';
  private controller = new AbortController();

  constructor(
    public readonly stream: MediaStream,
    public readonly devices: MediaDeviceInfo[],
    public readonly mode: MediaMode,
    public readonly constraints: MediaStreamConstraints,
    public readonly kind: 'audio' | 'video',
    public readonly deviceId: string,
    public permissions: MediaPermissions,
    private ctx: MediaContext,
    private readonly audioMuted: boolean = false,
    private readonly videoMuted: boolean = false,
  ) {
    log.info(`🔀 MediaSwitchingState — switching ${kind} to device "${deviceId}"`);
    this.performSwitch();
  }

  private async performSwitch() {
    try {
      const switchConstraints: MediaStreamConstraints =
        this.kind === 'audio'
          ? { audio: { deviceId: { exact: this.deviceId } } }
          : { video: { deviceId: { exact: this.deviceId } } };

      const newStream = await navigator.mediaDevices.getUserMedia(switchConstraints);
      const newTrack = this.kind === 'audio' ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];

      if (!newTrack) throw new Error(`No ${this.kind} track returned for deviceId "${this.deviceId}"`);

      if (this.controller.signal.aborted) {
        newTrack.stop();
        return;
      }

      const oldTracks = this.kind === 'audio' ? this.stream.getAudioTracks() : this.stream.getVideoTracks();
      oldTracks.forEach(t => {
        this.stream.removeTrack(t);
        t.stop();
      });
      this.stream.addTrack(newTrack);

      log.info(`  ✅ ${this.kind} device switched successfully`);
      this.destroy();
      const next = new MediaActiveState(this.stream, this.devices, this.mode, this.constraints, this.permissions, this.ctx, this.audioMuted, this.videoMuted);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.device.switched', kind: this.kind, stream: this.stream });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      log.error(`  ❌ ${this.kind} device switch failed`, error);
      this.destroy();
      // Return to active with existing stream
      const next = new MediaActiveState(this.stream, this.devices, this.mode, this.constraints, this.permissions, this.ctx, this.audioMuted, this.videoMuted);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.device.switch.failed', kind: this.kind, error: toError(error) });
    }
  }

  public stop() {
    log.info('  stop() called while switching');
    this.destroy();
    this.stream.getTracks().forEach(t => t.stop());
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
    this.ctx.emit({ type: 'media.stream.stopped' });
  }

  public updatePermissions(permissions: MediaPermissions) { this.permissions = permissions; }

  public destroy() {
    this.controller.abort();
  }

  public is<T extends 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'>(tag: T): this is Extract<MediaState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── MediaRecoveringState ─────────────────────────────────────────────────────

export class MediaRecoveringState implements BaseMediaState {
  public readonly _tag = 'recovering';
  private controller = new AbortController();

  constructor(
    public readonly oldStream: MediaStream,
    public readonly mode: MediaMode,
    public readonly constraints: MediaStreamConstraints,
    public permissions: MediaPermissions,
    private ctx: MediaContext,
  ) {
    log.info('🔄 MediaRecoveringState — attempting to re-acquire media');
    this.acquire();
  }

  private async acquire() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(this.constraints);

      if (this.controller.signal.aborted) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();

      if (this.controller.signal.aborted) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      log.info('  ✅ media recovered successfully');
      this.destroy();
      this.oldStream.getTracks().forEach(t => t.stop());
      const next = new MediaActiveState(stream, devices, this.mode, this.constraints, this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.stream.ready', stream, mode: this.mode });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.destroy();
      this.oldStream.getTracks().forEach(t => t.stop());

      if (isPermissionDenied(error)) {
        log.warn('  ⛔ recovery failed — permission denied');
        const next = new MediaDeniedState(this.permissions, this.ctx);
        this.ctx.transition(next);
        this.ctx.emit({ type: 'media.permission.denied' });
      } else {
        log.error('  ❌ recovery failed', error);
        const next = new MediaIdleState(this.permissions, this.ctx);
        this.ctx.transition(next);
        this.ctx.emit({ type: 'media.stream.error', error: toError(error) });
      }
    }
  }

  public stop() {
    log.info('  stop() called while recovering');
    this.destroy();
    this.oldStream.getTracks().forEach(t => t.stop());
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
    this.ctx.emit({ type: 'media.stream.stopped' });
  }

  public updatePermissions(permissions: MediaPermissions) { this.permissions = permissions; }

  public destroy() {
    this.controller.abort();
  }

  public is<T extends 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'>(tag: T): this is Extract<MediaState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── MediaDeniedState ─────────────────────────────────────────────────────────

export class MediaDeniedState implements BaseMediaState {
  public readonly _tag = 'denied';

  constructor(
    public permissions: MediaPermissions,
    private ctx: MediaContext,
  ) {
    log.warn('⛔ MediaDeniedState — user denied media permissions');
  }

  public retry() {
    log.info('  retry() — returning to idle');
    this.destroy();
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public updatePermissions(permissions: MediaPermissions) { this.permissions = permissions; }

  public destroy() { }

  public is<T extends 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied'>(tag: T): this is Extract<MediaState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── Union ────────────────────────────────────────────────────────────────────

export type MediaState =
  | MediaIdleState
  | MediaCheckingPermissionsState
  | MediaRequestingState
  | MediaActiveState
  | MediaSwitchingState
  | MediaRecoveringState
  | MediaDeniedState;
