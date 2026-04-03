import { AbstractMachine } from '../core';
import {
  MediaIdleState,
  type MediaContext,
  type MediaState,
  type MediaPermissions,
} from './state';
import type { MediaEmittedEvent } from './types';

// ── MediaManager ──────────────────────────────────────────────────────────────

export class MediaMachine extends AbstractMachine<MediaState, MediaEmittedEvent> {
  private permissionCleanup?: () => void;

  constructor() {
    super();

    const ctx = this.createContext<MediaContext>({
      emit: (event) => this.emit(event),
    });

    this.currentState = new MediaIdleState(
      { camera: 'unknown', microphone: 'unknown' },
      ctx,
    );

    this.permissionCleanup = this.startPermissionMonitor();
  }

  // ── Permission Monitor ──────────────────────────────────────────────────────

  private startPermissionMonitor(): () => void {
    if (!navigator.permissions?.query) return () => {};

    let camStatus: globalThis.PermissionStatus | null = null;
    let micStatus: globalThis.PermissionStatus | null = null;

    const requery = () => {
      const permissions: MediaPermissions = {
        camera: camStatus?.state ?? 'unknown',
        microphone: micStatus?.state ?? 'unknown',
      };
      this.currentState.permissions = permissions;
      this.notifySubscribers();
      this.emit({ type: 'media.permission.status', permissions });
    };

    void (async () => {
      [camStatus, micStatus] = await Promise.all([
        navigator.permissions.query({ name: 'camera' as PermissionName }).catch(() => null),
        navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null),
      ]);

      if (camStatus) camStatus.onchange = requery;
      if (micStatus) micStatus.onchange = requery;
    })();

    return () => {
      if (camStatus) camStatus.onchange = null;
      if (micStatus) micStatus.onchange = null;
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  public override destroy() {
    this.permissionCleanup?.();
    super.destroy();
  }
}
