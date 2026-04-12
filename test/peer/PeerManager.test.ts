import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PeerManager } from '../../src/peer/PeerManager';
import { MockPeer } from '../__mocks__/peerjs';

describe('PeerManager State Machine', () => {
  let mockPeer: MockPeer;

  beforeEach(() => {
    mockPeer = new MockPeer('test-peer-123');
  });

  it('initializes in initializing state', () => {
    const manager = new PeerManager({ peer: mockPeer as any });
    expect(manager.getState()._tag).toBe('initializing');
  });

  it('transitions to ready when underlying peer opens', () => {
    const manager = new PeerManager({ peer: mockPeer as any });
    
    // Simulate peer open event
    mockPeer._simulateOpen();
    
    expect(manager.getState()._tag).toBe('ready');
  });

  it('transitions to disconnected when underlying peer disconnects', () => {
    const manager = new PeerManager({ peer: mockPeer as any, maxRetries: 0 }); // disable auto-reconnect for this test
    
    mockPeer._simulateOpen();
    expect(manager.getState()._tag).toBe('ready');

    mockPeer.disconnect();
    expect(manager.getState()._tag).toBe('disconnected');
  });

  it('auto-reconnects on disconnect if maxRetries is > 0', () => {
    vi.useFakeTimers();
    const manager = new PeerManager({ peer: mockPeer as any, maxRetries: 3, baseRetryDelay: 1000 });
    
    // Move to ready
    mockPeer._simulateOpen();
    
    // Trigger disconnect
    mockPeer.disconnect();
    expect(manager.getState()._tag).toBe('disconnected');

    // Wait for auto-reconnect timer
    vi.advanceTimersByTime(2000); // baseRetryDelay is 1000, but first retry uses exponential backoff or similar?
    // Actually baseRetryDelay * (2^0) = 1000. So after 2000ms it should have definitely fired
    
    expect(mockPeer.reconnect).toHaveBeenCalled();
    expect(manager.getState()._tag).toBe('initializing'); // reconnect() goes to initializing state
    
    vi.useRealTimers();
  });

  it('cleans up resources and transitions to destroyed when peer closes', () => {
    const manager = new PeerManager({ peer: mockPeer as any });
    mockPeer._simulateOpen();
    
    mockPeer.destroy();
    
    expect(manager.getState()._tag).toBe('destroyed');
  });
});
