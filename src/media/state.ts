import type { MachineContext } from '../core';
import type { MediaEmittedEvent } from './types';

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
}

// ── Base ──────────────────────────────────────────────────────────────────────

export interface BaseMediaState {
  readonly _tag: 'idle' | 'checkingPermissions' | 'requesting' | 'active' | 'switching' | 'recovering' | 'denied';
  permissions: MediaPermissions;
  destroy(): void;
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
  ) { }

  public request(constraints: MediaStreamConstraints) {
    this.destroy();
    const next = new MediaRequestingState('user', constraints, {}, this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public requestScreen(constraints: DisplayMediaStreamOptions = {}) {
    this.destroy();
    const next = new MediaRequestingState('screen', { audio: true, video: true }, constraints, this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public checkPermissions() {
    this.destroy();
    const next = new MediaCheckingPermissionsState(this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public destroy() { }
}

// ── MediaCheckingPermissionsState ────────────────────────────────────────────

export class MediaCheckingPermissionsState implements BaseMediaState {
  public readonly _tag = 'checkingPermissions';
  private aborted = false;

  constructor(
    public permissions: MediaPermissions,
    private ctx: MediaContext,
  ) {
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

      if (this.aborted) return;

      const permissions: MediaPermissions = {
        camera: cam?.state ?? 'unknown',
        microphone: mic?.state ?? 'unknown',
      };

      this.destroy();
      const next = new MediaIdleState(permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.permission.status', permissions });
    } catch {
      if (this.aborted) return;
      this.destroy();
      const next = new MediaIdleState(this.permissions, this.ctx);
      this.ctx.transition(next);
    }
  }

  public destroy() {
    this.aborted = true;
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
    this.acquire();
  }

  private async acquire() {
    try {
      const stream = this.mode === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia(this.screenConstraints)
        : await navigator.mediaDevices.getUserMedia(this.constraints);

      if (this.controller.signal.aborted) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();

      if (this.controller.signal.aborted) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      this.destroy();
      const next = new MediaActiveState(stream, devices, this.mode, this.constraints, this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.stream.ready', stream, mode: this.mode });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.destroy();

      if (isPermissionDenied(error)) {
        const next = new MediaDeniedState(this.permissions, this.ctx);
        this.ctx.transition(next);
        this.ctx.emit({ type: 'media.permission.denied' });
      } else {
        const next = new MediaIdleState(this.permissions, this.ctx);
        this.ctx.transition(next);
        this.ctx.emit({ type: 'media.stream.error', error: toError(error) });
      }
    }
  }

  public stop() {
    this.destroy();
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public destroy() {
    this.controller.abort();
  }
}

// ── MediaActiveState ─────────────────────────────────────────────────────────

export class MediaActiveState implements BaseMediaState {
  public readonly _tag = 'active';
  private trackHandlers: Array<{ track: MediaStreamTrack; handler: () => void }> = [];
  private deviceChangeHandler: (() => void) | null = null;

  constructor(
    public readonly stream: MediaStream,
    public readonly devices: MediaDeviceInfo[],
    public readonly mode: MediaMode,
    public readonly constraints: MediaStreamConstraints,
    public permissions: MediaPermissions,
    private ctx: MediaContext,
  ) {
    this.startMonitoring();
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
        (this as { devices: MediaDeviceInfo[] }).devices = devices;
        this.ctx.emit({ type: 'media.devices.updated', devices });
      });
    };
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
  }

  private onTrackEnded(kind: 'audio' | 'video') {
    if (this.mode === 'user') {
      // Unexpected track end — attempt recovery
      this.destroy();
      const next = new MediaRecoveringState(this.stream, this.mode, this.constraints, this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.track.ended', kind });
      this.ctx.emit({ type: 'media.recovering' });
    } else {
      // Screen mode — user intentionally stopped sharing
      this.destroy();
      this.stream.getTracks().forEach(t => t.stop());
      const next = new MediaIdleState(this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.stream.stopped' });
    }
  }

  public switchDevice(kind: 'audio' | 'video', deviceId: string) {
    if (this.mode !== 'user') return;
    this.destroy();
    const next = new MediaSwitchingState(this.stream, this.devices, this.mode, this.constraints, kind, deviceId, this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public stop() {
    this.destroy();
    this.stream.getTracks().forEach(t => t.stop());
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
    this.ctx.emit({ type: 'media.stream.stopped' });
  }

  public destroy() {
    this.trackHandlers.forEach(({ track, handler }) => track.removeEventListener('ended', handler));
    this.trackHandlers = [];
    if (this.deviceChangeHandler) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
      this.deviceChangeHandler = null;
    }
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
  ) {
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

      this.destroy();
      const next = new MediaActiveState(this.stream, this.devices, this.mode, this.constraints, this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.device.switched', kind: this.kind, stream: this.stream });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.destroy();
      // Return to active with existing stream
      const next = new MediaActiveState(this.stream, this.devices, this.mode, this.constraints, this.permissions, this.ctx);
      this.ctx.transition(next);
      this.ctx.emit({ type: 'media.device.switch.failed', kind: this.kind, error: toError(error) });
    }
  }

  public stop() {
    this.destroy();
    this.stream.getTracks().forEach(t => t.stop());
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
    this.ctx.emit({ type: 'media.stream.stopped' });
  }

  public destroy() {
    this.controller.abort();
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
        const next = new MediaDeniedState(this.permissions, this.ctx);
        this.ctx.transition(next);
        this.ctx.emit({ type: 'media.permission.denied' });
      } else {
        const next = new MediaIdleState(this.permissions, this.ctx);
        this.ctx.transition(next);
        this.ctx.emit({ type: 'media.stream.error', error: toError(error) });
      }
    }
  }

  public stop() {
    this.destroy();
    this.oldStream.getTracks().forEach(t => t.stop());
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
    this.ctx.emit({ type: 'media.stream.stopped' });
  }

  public destroy() {
    this.controller.abort();
  }
}

// ── MediaDeniedState ─────────────────────────────────────────────────────────

export class MediaDeniedState implements BaseMediaState {
  public readonly _tag = 'denied';

  constructor(
    public permissions: MediaPermissions,
    private ctx: MediaContext,
  ) { }

  public retry() {
    this.destroy();
    const next = new MediaIdleState(this.permissions, this.ctx);
    this.ctx.transition(next);
  }

  public destroy() { }
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
