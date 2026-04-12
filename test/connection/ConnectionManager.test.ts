import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionManager } from '../../src/connection/ConnectionManager';
import { MockPeer, MockDataConnection } from '../__mocks__/peerjs';

describe('ConnectionManager State Machine', () => {
  let mockCtx: any;
  let mockSignaling: any;
  let mockPeer: MockPeer;

  beforeEach(() => {
    mockCtx = {
      emit: vi.fn(),
      notifyChange: vi.fn(),
      bumpVersion: vi.fn(),
    };
    mockSignaling = {
      handleMessage: vi.fn(),
    };
    mockPeer = new MockPeer('local-peer');
  });

  it('initializes with no connections', () => {
    const manager = new ConnectionManager(mockCtx, mockSignaling);
    expect(Array.from(manager.getAll()).length).toBe(0);
  });

  it('spawns a connection machine upon connect()', () => {
    const manager = new ConnectionManager(mockCtx, mockSignaling);
    
    manager.connect(mockPeer as any, 'remote-peer-1');
    
    const connections = Array.from(manager.getAll());
    expect(connections.length).toBe(1);
    
    const connState = connections[0].getState();
    expect(connState._tag).toBe('connecting');
    expect(connState.remotePeerId).toBe('remote-peer-1');
  });

  it('handles incoming connections correctly', () => {
    const manager = new ConnectionManager(mockCtx, mockSignaling);
    const incomingMock = new MockDataConnection('remote-peer-2');
    
    manager.handleIncoming(incomingMock as any);
    
    const connections = Array.from(manager.getAll());
    expect(connections.length).toBe(1);
    
    const connState = connections[0].getState();
    expect(connState._tag).toBe('connecting');
  });
  
  it('does not spawn duplicate connections to same peer', () => {
    const manager = new ConnectionManager(mockCtx, mockSignaling);
    
    manager.connect(mockPeer as any, 'remote-peer-1');
    manager.connect(mockPeer as any, 'remote-peer-1'); // Duplicate
    
    const connections = Array.from(manager.getAll());
    expect(connections.length).toBe(1);
  });

  it('cleans up connections on destroy', () => {
    const manager = new ConnectionManager(mockCtx, mockSignaling);
    manager.connect(mockPeer as any, 'remote-peer-1');
    
    expect(Array.from(manager.getAll()).length).toBe(1);
    
    manager.destroy();
    
    expect(Array.from(manager.getAll()).length).toBe(0);
  });
});
