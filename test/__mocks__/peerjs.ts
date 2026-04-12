import { vi } from 'vitest';
import EventEmitter from 'events';
import type { Peer, MediaConnection, DataConnection } from 'peerjs';

export class MockDataConnection extends EventEmitter {
  connectionId: string;
  peer: string;
  open = false;
  metadata: any;
  reliable: boolean;
  serialization: string;
  type = 'data' as const;
  bufferSize = 0;
  dataChannel: any = {};
  peerConnection: any = {};
  provider: any;

  constructor(peerId: string) {
    super();
    this.peer = peerId;
    this.connectionId = 'dc_' + Math.random().toString(36).substring(7);
    this.metadata = {};
    this.reliable = true;
    this.serialization = 'json';
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.open = false;
    this.emit('close');
  });

  // Helper for tests to simulate incoming data
  _simulateOpen() {
    this.open = true;
    this.emit('open');
  }

  _simulateData(data: any) {
    this.emit('data', data);
  }
}

export class MockMediaConnection extends EventEmitter {
  connectionId: string;
  peer: string;
  open = false;
  metadata: any;
  type = 'media' as const;
  peerConnection: any = {
    getSenders: vi.fn(() => []),
  };
  provider: any;

  constructor(peerId: string, public localStream?: MediaStream) {
    super();
    this.peer = peerId;
    this.connectionId = 'mc_' + Math.random().toString(36).substring(7);
  }

  answer = vi.fn((stream?: MediaStream) => {
    this.localStream = stream;
    this.open = true;
  });

  close = vi.fn(() => {
    this.open = false;
    this.emit('close');
  });

  // Helper to simulate remote stream arrival
  _simulateStream(stream: MediaStream) {
    this.open = true;
    this.emit('stream', stream);
  }
}

export class MockPeer extends EventEmitter {
  id: string;
  options: any = {};
  open = false;
  destroyed = false;
  disconnected = false;

  constructor(id: string = 'mock-peer-id') {
    super();
    this.id = id;
  }

  connect = vi.fn((remotePeerId: string, options?: any) => {
    const conn = new MockDataConnection(remotePeerId);
    // In real PeerJS, the connection is returned and eventually fires 'open' if successful
    return conn as unknown as DataConnection;
  });

  call = vi.fn((remotePeerId: string, localStream: MediaStream, options?: any) => {
    const conn = new MockMediaConnection(remotePeerId, localStream);
    return conn as unknown as MediaConnection;
  });

  disconnect = vi.fn(() => {
    this.disconnected = true;
    this.emit('disconnected');
  });

  reconnect = vi.fn(() => {
    this.disconnected = false;
    // Real peerjs fires a new 'open' event or 'error' if it fails
  });

  destroy = vi.fn(() => {
    this.destroyed = true;
    this.emit('close');
  });

  // Test helpers
  _simulateOpen() {
    this.open = true;
    this.emit('open', this.id);
  }
  
  _simulateIncomingConnection(remotePeerId: string) {
    const conn = new MockDataConnection(remotePeerId);
    this.emit('connection', conn as unknown as DataConnection);
    return conn;
  }

  _simulateIncomingCall(remotePeerId: string) {
    const call = new MockMediaConnection(remotePeerId);
    this.emit('call', call as unknown as MediaConnection);
    return call;
  }
}
