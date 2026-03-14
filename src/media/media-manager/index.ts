import { AudioOutputController } from "./audio-output-controller";
import { DeviceInputController } from "./device-input-controller";
import { LocalMedia } from "./local-media";
import { ScreenShareController } from "./screen-share-controller";

export class MediaManager {
  public localMedia: LocalMedia;
  private deviceInput: DeviceInputController;
  private audioOutput: AudioOutputController;
  private screenShareController: ScreenShareController;

  constructor(
    localStream: MediaStream,
    getVideoSender: () => RTCRtpSender | undefined,
    getAudioSender: () => RTCRtpSender | undefined,
  ) {
    this.localMedia = new LocalMedia(localStream);
    this.deviceInput = new DeviceInputController(
      this.localMedia,
      getVideoSender,
      getAudioSender,
    );
    this.screenShareController = new ScreenShareController(
      this.localMedia,
      getVideoSender,
    );
    this.audioOutput = new AudioOutputController();
  }

  // Delegate methods for convenience
  getStream() {
    return this.localMedia.getStream();
  }

  isMuted() {
    return this.localMedia.isMuted();
  }

  isCameraOn() {
    return this.localMedia.isCameraOn();
  }

  isScreenSharing() {
    return this.screenShareController.isScreenSharing();
  }

  mute() {
    this.localMedia.mute();
  }

  unmute() {
    this.localMedia.unmute();
  }

  toggleMute() {
    this.localMedia.toggleMute();
  }

  cameraOff() {
    this.localMedia.cameraOff();
  }

  cameraOn() {
    this.localMedia.cameraOn();
  }

  toggleCamera() {
    this.localMedia.toggleCamera();
  }

  stop() {
    this.localMedia.stop();
  }

  // Device switching
  switchCamera(deviceId: string) {
    return this.deviceInput.changeVideoInput(deviceId);
  }

  switchMicrophone(deviceId: string) {
    return this.deviceInput.changeAudioInput(deviceId);
  }

  switchSpeaker(deviceId: string, audioElement: HTMLAudioElement) {
    return this.audioOutput.changeAudioOutput(deviceId, audioElement);
  }

  startScreenShare(displayConstraints?: DisplayMediaStreamOptions) {
    return this.screenShareController.startScreenShare(displayConstraints);
  }

  stopScreenShare() {
    return this.screenShareController.stopScreenShare();
  }

  toggleScreenShare(displayConstraints?: DisplayMediaStreamOptions) {
    return this.screenShareController.toggleScreenShare(displayConstraints);
  }
}
