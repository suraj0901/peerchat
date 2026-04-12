import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaMachine } from '../../src/media/MediaManager';

describe('MediaManager State Machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(new MediaStream());
  });

  const waitForState = async (manager: MediaMachine, tag: string) => {
    for (let i = 0; i < 50; i++) {
      if (manager.getState()._tag === tag) return;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`Timeout waiting for state ${tag}`);
  };

  it('starts in idle state', () => {
    const manager = new MediaMachine();
    expect(manager.getState()._tag).toBe('idle');
  });

  it('transitions from idle to active when stream requested successfully', async () => {
    const manager = new MediaMachine();
    
    // Simulate successful request
    const idleState = manager.getState();
    if (!idleState.is('idle')) throw new Error('not idle');
    
    idleState.request({ video: true, audio: true });
    expect(manager.getState()._tag).toBe('requesting');
    
    await waitForState(manager, 'active');
    
    const activeState = manager.getState();
    expect(activeState._tag).toBe('active');
    if (activeState.is('active')) {
      expect(activeState.stream).toBeDefined();
    }
  });

  it('transitions to denied if getUserMedia throws permission error', async () => {
    const manager = new MediaMachine();
    
    // Override global getUserMedia to reject
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError')
    );
    
    const idleState = manager.getState();
    if (!idleState.is('idle')) throw new Error('not idle');

    idleState.request({ video: true, audio: true });
    expect(manager.getState()._tag).toBe('requesting');
    
    await waitForState(manager, 'denied');
    
    expect(manager.getState()._tag).toBe('denied');
  });

  it('allows stopping an active stream', async () => {
    const manager = new MediaMachine();
    
    const idleState = manager.getState();
    if (!idleState.is('idle')) throw new Error('not idle');
    idleState.request({ video: true, audio: true });
    
    await waitForState(manager, 'active');
    
    const activeState = manager.getState();
    expect(activeState._tag).toBe('active');
    
    if (activeState.is('active')) {
      activeState.stop();
    }
    
    // Should go back to idle
    expect(manager.getState()._tag).toBe('idle');
  });

  it('transitions to switching if device id changes', async () => {
    const manager = new MediaMachine();
    const idleState = manager.getState();
    if (!idleState.is('idle')) throw new Error('not idle');
    idleState.request({ video: true, audio: true });
    
    await waitForState(manager, 'active');
    
    const activeState = manager.getState();
    expect(activeState._tag).toBe('active');

    if (activeState.is('active')) {
      activeState.switchDevice('video', 'new-cam');
      expect(manager.getState()._tag).toBe('switching');
      await waitForState(manager, 'active');
      expect(manager.getState()._tag).toBe('active');
    }
  });
});
