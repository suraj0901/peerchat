import { createMachine, type Machine } from '../core';
import { transition, initialEffects } from './transitions';
import { initialMediaState, type MediaState, type MediaEvent, type MediaEmittedEvent } from './types';

// ── MediaManager ──────────────────────────────────────────────────────────────

export type MediaMachine = Machine<MediaState, MediaEvent, MediaEmittedEvent>;

/**
 * Creates a media device state machine — manages local stream acquisition,
 * track health, device switching, recovery, and permissions.
 *
 * Returns a running machine instance with `send()`, `subscribe()`, `on()`,
 * `getState()`, and `destroy()`.
 */
export function createMediaManager(): MediaMachine {
  return createMachine<MediaState, MediaEvent, MediaEmittedEvent>(
    transition,
    initialMediaState(),
    initialEffects(),
  );
}
