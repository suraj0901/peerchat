import { type MachineDefinition, type MachineEvent } from "nano-statechart";

export type MediaDeviceEvent =
  | { type: "TOGGLE_AUDIO" }
  | { type: "MUTE_AUDIO" }
  | { type: "UNMUTE_AUDIO" }
  | { type: "TOGGLE_VIDEO" }
  | { type: "TURN_VIDEO_ON" }
  | { type: "TURN_VIDEO_OFF" }
  | { type: "TOGGLE_SCREEN_SHARE" }
  | { type: "START_SCREEN_SHARE" }
  | { type: "SCREEN_SHARE_STARTED" }
  | { type: "STOP_SCREEN_SHARE" }
  | { type: "SCREEN_SHARE_ERROR"; error: string }
  | { type: "RESET_MEDIA" };

// --- Audio Region ---
export type AudioState = "unmuted" | "muted";
export type MediaDeviceEffect =
  | { type: "FX_MUTE_AUDIO" }
  | { type: "FX_UNMUTE_AUDIO" }
  | { type: "FX_TURN_VIDEO_OFF" }
  | { type: "FX_TURN_VIDEO_ON" }
  | { type: "FX_REQUEST_SCREEN_SHARE" }
  | { type: "FX_STOP_SCREEN_SHARE" };

export const audioMachine: MachineDefinition<AudioState, MediaDeviceEvent, MediaDeviceEffect> = {
  initial: "unmuted",
  context: undefined,
  states: {
    unmuted: {
      on: {
        MUTE_AUDIO: { target: "muted", effects: [{ type: "FX_MUTE_AUDIO" }] },
        TOGGLE_AUDIO: { target: "muted", effects: [{ type: "FX_MUTE_AUDIO" }] },
        RESET_MEDIA: { target: "unmuted" }, // Already unmuted
      },
    },
    muted: {
      on: {
        UNMUTE_AUDIO: { target: "unmuted", effects: [{ type: "FX_UNMUTE_AUDIO" }] },
        TOGGLE_AUDIO: { target: "unmuted", effects: [{ type: "FX_UNMUTE_AUDIO" }] },
        RESET_MEDIA: { target: "unmuted", effects: [{ type: "FX_UNMUTE_AUDIO" }] },
      },
    },
  },
};

// --- Video Region ---
export type VideoState = "on" | "off";

export const videoMachine: MachineDefinition<VideoState, MediaDeviceEvent, MediaDeviceEffect> = {
  initial: "on",
  context: undefined,
  states: {
    on: {
      on: {
        TURN_VIDEO_OFF: { target: "off", effects: [{ type: "FX_TURN_VIDEO_OFF" }] },
        TOGGLE_VIDEO: { target: "off", effects: [{ type: "FX_TURN_VIDEO_OFF" }] },
        RESET_MEDIA: { target: "on" }, // Already on
      },
    },
    off: {
      on: {
        TURN_VIDEO_ON: { target: "on", effects: [{ type: "FX_TURN_VIDEO_ON" }] },
        TOGGLE_VIDEO: { target: "on", effects: [{ type: "FX_TURN_VIDEO_ON" }] },
        RESET_MEDIA: { target: "on", effects: [{ type: "FX_TURN_VIDEO_ON" }] },
      },
    },
  },
};

// --- Screen Share Region ---
export type ScreenShareState = "idle" | "requesting" | "active";
export type ScreenShareContext = { error?: string };

export const screenShareMachine: MachineDefinition<
  ScreenShareState,
  MediaDeviceEvent,
  MediaDeviceEffect,
  ScreenShareContext
> = {
  initial: "idle",
  context: {},
  states: {
    idle: {
      on: {
        START_SCREEN_SHARE: { target: "requesting", effects: [{ type: "FX_REQUEST_SCREEN_SHARE" }] },
        TOGGLE_SCREEN_SHARE: { target: "requesting", effects: [{ type: "FX_REQUEST_SCREEN_SHARE" }] },
        RESET_MEDIA: { target: "idle" },
      },
    },
    requesting: {
      on: {
        SCREEN_SHARE_STARTED: { target: "active", reduce: (ctx) => ({ ...ctx, error: undefined }) },
        SCREEN_SHARE_ERROR: { target: "idle", reduce: (ctx, e) => ({ ...ctx, error: e.error }) },
        STOP_SCREEN_SHARE: { target: "idle" }, // Cancelled or stopped
        TOGGLE_SCREEN_SHARE: { target: "idle" },
        RESET_MEDIA: { target: "idle" },
      },
    },
    active: {
      on: {
        STOP_SCREEN_SHARE: { target: "idle", effects: [{ type: "FX_STOP_SCREEN_SHARE" }] },
        TOGGLE_SCREEN_SHARE: { target: "idle", effects: [{ type: "FX_STOP_SCREEN_SHARE" }] },
        SCREEN_SHARE_ERROR: { target: "idle", effects: [{ type: "FX_STOP_SCREEN_SHARE" }] },
        RESET_MEDIA: { target: "idle", effects: [{ type: "FX_STOP_SCREEN_SHARE" }] },
      },
    },
  },
};

// --- Parallel Service Wrapper ---
import { executeParallel, getInitialState, type ParallelRegion, type EffectHandler } from "nano-statechart";

export type MediaDeviceSnapshot = {
  audio: AudioState;
  video: VideoState;
  screenShare: ScreenShareState;
  screenShareContext: ScreenShareContext;
};

export class MediaDeviceService {
  private regions: [
    ParallelRegion<MediaDeviceEvent, MediaDeviceEffect>,
    ParallelRegion<MediaDeviceEvent, MediaDeviceEffect>,
    ParallelRegion<MediaDeviceEvent, MediaDeviceEffect>
  ];
  private listeners = new Set<() => void>();
  private effectHandler?: EffectHandler<MediaDeviceEffect>;

  constructor(effectHandler?: EffectHandler<MediaDeviceEffect>) {
    this.regions = [
      { definition: audioMachine, state: getInitialState(audioMachine), context: audioMachine.context },
      { definition: videoMachine, state: getInitialState(videoMachine), context: videoMachine.context },
      { definition: screenShareMachine, state: getInitialState(screenShareMachine), context: screenShareMachine.context },
    ];
    this.effectHandler = effectHandler;
  }

  public send(event: MediaDeviceEvent) {
    const result = executeParallel(this.regions, event);
    
    const r0 = result.results[0]!;
    const r1 = result.results[1]!;
    const r2 = result.results[2]!;
    
    // Update regions with new state/context/history
    this.regions[0] = { ...this.regions[0], state: r0.next, context: r0.context, history: r0.history };
    this.regions[1] = { ...this.regions[1], state: r1.next, context: r1.context, history: r1.history };
    this.regions[2] = { ...this.regions[2], state: r2.next, context: r2.context, history: r2.history };

    // Fire effects
    if (this.effectHandler) {
      for (const effect of result.effects) {
        this.effectHandler(effect);
      }
    }

    this.notify();
  }

  public getSnapshot(): MediaDeviceSnapshot {
    return {
      audio: this.regions[0].state as AudioState,
      video: this.regions[1].state as VideoState,
      screenShare: this.regions[2].state as ScreenShareState,
      screenShareContext: this.regions[2].context as ScreenShareContext,
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
