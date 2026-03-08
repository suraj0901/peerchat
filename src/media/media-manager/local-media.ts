// local-media.ts
export class LocalMedia {
  constructor(private stream: MediaStream) {}

  getStream(): MediaStream {
    return this.stream;
  }

  isMuted(): boolean {
    return this.stream.getAudioTracks().every(track => !track.enabled);
  }

  isCameraOn(): boolean {
    return this.stream.getVideoTracks().every(track => track.enabled);
  }

  mute(): void {
    this.stream.getAudioTracks().forEach(track => (track.enabled = false));
  }

  unmute(): void {
    this.stream.getAudioTracks().forEach(track => (track.enabled = true));
  }

  toggleMute(): void {
    this.stream.getAudioTracks().forEach(track => (track.enabled = !track.enabled));
  }

  cameraOff(): void {
    this.stream.getVideoTracks().forEach(track => (track.enabled = false));
  }

  cameraOn(): void {
    this.stream.getVideoTracks().forEach(track => (track.enabled = true));
  }

  toggleCamera(): void {
    this.stream.getVideoTracks().forEach(track => (track.enabled = !track.enabled));
  }

  stop(): void {
    this.stream.getTracks().forEach(track => track.stop());
  }

  // For internal use by DeviceInputController – updates the stream after replaceTrack
  replaceVideoTrack(newTrack: MediaStreamTrack): void {
    this.replaceTracks('video', newTrack);
  }

  replaceAudioTrack(newTrack: MediaStreamTrack): void {
    this.replaceTracks('audio', newTrack);
  }

  private replaceTracks(kind: 'video' | 'audio', newTrack: MediaStreamTrack): void {
    const oldTracks = this.stream.getTracks().filter(t => t.kind === kind);
    oldTracks.forEach(t => {
      this.stream.removeTrack(t);
      t.stop(); // release the hardware
    });
    this.stream.addTrack(newTrack);
  }
}