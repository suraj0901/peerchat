import { ResultAsync } from "neverthrow";
import { MediaDeviceError } from "./errors";
import type { Branded } from "./util";

export type MicrophoneId = Branded<string, "MicrophoneId">;
export type CameraId = Branded<string, "CameraId">;
export type SpeakerId = Branded<string, "SpeakerId">;

export enum MediaDeviceKind {
  Microphone = "audioinput",
  Speaker = "audiooutput",
  Camera = "videoinput",
}

export type Microphone = {
  deviceId: MicrophoneId;
  label: string;
  kind: MediaDeviceKind.Microphone;
  groupId: string;
};

export type Camera = {
  deviceId: CameraId;
  label: string;
  kind: MediaDeviceKind.Camera;
  groupId: string;
};

export type Speaker = {
  deviceId: SpeakerId;
  label: string;
  kind: MediaDeviceKind.Speaker;
  groupId: string;
};

type DeviceId<T extends MediaDeviceKind> = T extends MediaDeviceKind.Microphone
  ? MicrophoneId
  : T extends MediaDeviceKind.Camera
    ? CameraId
    : T extends MediaDeviceKind.Speaker
      ? SpeakerId
      : never;

export function getDevices() {
  return ResultAsync.fromPromise(
    navigator.mediaDevices.enumerateDevices(),
    (error) => new MediaDeviceError(error),
  );
}

export function getMicrophones() {
  return getDevices().map((devices) =>
    devices
      .filter((device) => device.kind === MediaDeviceKind.Microphone)
      .map((device) => createDeviceInfo(device, MediaDeviceKind.Microphone)),
  );
}

export function getSpeakers() {
  return getDevices().map((devices) =>
    devices
      .filter((device) => device.kind === MediaDeviceKind.Speaker)
      .map((device) => createDeviceInfo(device, MediaDeviceKind.Speaker)),
  );
}

export function getCameras() {
  return getDevices().map((devices) =>
    devices
      .filter((device) => device.kind === MediaDeviceKind.Camera)
      .map((device) => createDeviceInfo(device, MediaDeviceKind.Camera)),
  );
}

function createDeviceInfo(
  device: MediaDeviceInfo,
  kind: MediaDeviceKind.Microphone,
): Microphone;
function createDeviceInfo(
  device: MediaDeviceInfo,
  kind: MediaDeviceKind.Speaker,
): Speaker;
function createDeviceInfo(
  device: MediaDeviceInfo,
  kind: MediaDeviceKind.Camera,
): Camera;
function createDeviceInfo<T extends MediaDeviceKind>(
  device: MediaDeviceInfo,
  kind: T,
) {
  return {
    deviceId: device.deviceId as DeviceId<T>,
    label: device.label,
    kind,
    groupId: device.groupId,
  };
}
