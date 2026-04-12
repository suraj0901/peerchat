// Minimal polyfills for JSDOM
import { vi } from 'vitest';

class MockMediaStreamTrack {
  kind: string;
  readyState = 'live';
  enabled = true;
  constructor(kind = 'video') {
    this.kind = kind;
  }
  stop() {
    this.readyState = 'ended';
  }
}

class MockMediaStream {
  id: string;
  private tracks: MockMediaStreamTrack[];

  constructor(tracks?: MockMediaStreamTrack[]) {
    this.id = Math.random().toString(36).substring(7);
    this.tracks = tracks || [];
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter(t => t.kind === 'video');
  }
  addTrack(track: MockMediaStreamTrack) {
    this.tracks.push(track);
  }
  removeTrack(track: MockMediaStreamTrack) {
    this.tracks = this.tracks.filter(t => t !== track);
  }
  clone() {
    return new MockMediaStream([...this.tracks]);
  }
}

Object.defineProperty(window, 'MediaStream', {
  writable: true,
  value: MockMediaStream,
});

Object.defineProperty(window, 'MediaStreamTrack', {
  writable: true,
  value: MockMediaStreamTrack,
});

Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockImplementation(() => Promise.resolve(new MockMediaStream())),
    enumerateDevices: vi.fn().mockImplementation(() => Promise.resolve([])),
  },
});
