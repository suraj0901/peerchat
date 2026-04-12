import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { PeerProvider, usePeerContext } from '../../example-react/src/context/peer-context';
import { MockPeer } from '../__mocks__/peerjs';

// We need to inject our PeerManager or mock it.
// The PeerProvider uses `PeerManager` from `peerchat`. Let's mock `peerchat` module:
vi.mock('../../src/index', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    createPeer: vi.fn().mockReturnValue({
      getState: () => ({ _tag: 'ready', peerId: 'test-peer-id' }),
      subscribe: vi.fn().mockImplementation((cb) => {
        // immediately call it for sync
        return { unsubscribe: vi.fn() };
      }),
      getVersion: () => 1,
      getSnapshot: () => ({ state: { _tag: 'ready', peerId: 'test-peer-id' }, version: 1 }),
      get peer() { return new MockPeer('test-peer-id'); },
    }),
  };
});

describe('PeerProvider & hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TestComponent = () => {
    const { peerState } = usePeerContext();
    return <div data-testid="peer-tag" data-peerid={peerState.peerId || ''}>{peerState._tag}</div>;
  };

  it('renders children with peer context', async () => {
    render(
      <PeerProvider peerId="test-peer-id">
        <TestComponent />
      </PeerProvider>
    );
    
    expect(screen.getByTestId('peer-tag').textContent).toBe('ready');
    expect(screen.getByTestId('peer-tag').getAttribute('data-peerid')).toBe('test-peer-id');
  });
});
