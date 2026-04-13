import type { MediaConnection, Peer } from 'peerjs';
import { CallCoordinator, type CallCoordinatorConfig } from './CallCoordinator';
import { createLogger } from '../core/logger';
import type { SignalingService } from '../signaling';
import type { PeerContext } from '../peer/state';
import type { ConnectionManager } from '../connection/ConnectionManager';

const log = createLogger('CallManager');

export class CallManager {
  private readonly calls = new Map<string, CallCoordinator>();

  constructor(
    private readonly peer: Peer,
    private readonly ctx: PeerContext,
    private readonly signalingService: SignalingService,
    private readonly connectionManager: ConnectionManager
  ) { }

  /** Get an existing call coordinator by ID */
  public getCall(callId: string): CallCoordinator | undefined {
    return this.calls.get(callId);
  }

  /** Get all active call coordinators */
  public getAll(): IterableIterator<CallCoordinator> {
    return this.calls.values();
  }

  /** Check if there are any live calls */
  public hasLiveCall(): boolean {
    for (const coordinator of this.calls.values()) {
      if (coordinator.isInState('live')) {
        return true;
      }
    }
    return false;
  }

  /** Make an outbound call */
  public call(peer: Peer, remotePeerId: string, localStream: MediaStream): void {
    log.info(`📞 call("${remotePeerId}") called`);

    // Prevent duplicate
    for (const coordinator of this.calls.values()) {
      if (coordinator.isInState('ringing', 'connecting', 'live') && coordinator.getRemotePeerId() === remotePeerId) {
        log.warn(`  → duplicate call to "${remotePeerId}" — skipping (existing state: ${coordinator.getStateTag()})`);
        return;
      }
    }

    const mediaCall = peer.call(remotePeerId, localStream);
    log.debug(`  → PeerJS call created, callId: ${mediaCall.connectionId}`);

    this.addCall(mediaCall, mediaCall.connectionId, remotePeerId, 'outbound');
  }

  /** Handle an incoming call from the network */
  public handleIncoming(mediaCall: MediaConnection): void {
    log.info(`📥 incoming call from "${mediaCall.peer}", callId: ${mediaCall.connectionId}`);

    this.addCall(mediaCall, mediaCall.connectionId, mediaCall.peer, 'inbound');

    this.ctx.emit({
      type: 'call.incoming',
      callId: mediaCall.connectionId,
      remotePeerId: mediaCall.peer,
    });
  }

  /** Hold all currently live calls */
  public holdAllLiveCalls(): void {
    for (const [id, coordinator] of this.calls) {
      if (coordinator.isInState('live')) {
        log.info(`  auto-holding live call "${id}"`);
        coordinator.holdIfLive();
      }
    }
  }

  private addCall(mediaCall: MediaConnection, callId: string, remotePeerId: string, direction: 'inbound' | 'outbound'): void {
    const config: CallCoordinatorConfig = {
      call: mediaCall,
      callId,
      remotePeerId,
      direction,
      signalingService: this.signalingService,
      onEnded: (endedCallId, event) => {
        if (event.type === 'call.ended') {
          this.removeCall(endedCallId, { type: 'call.ended', callId: endedCallId });
        } else if (event.type === 'call.error') {
          this.removeCall(endedCallId, { type: 'call.error', callId: endedCallId, error: event.error });
        } else if (event.type === 'call.rejected') {
          this.removeCall(endedCallId, { type: 'call.rejected', callId: endedCallId, remotePeerId });
        } else if (event.type === 'call.declined') {
          this.removeCall(endedCallId, { type: 'call.declined', callId: endedCallId, remotePeerId });
        }
      },
      onActive: (activeCallId, remoteStream) => {
        this.ctx.emit({ type: 'call.active', callId: activeCallId, remotePeerId, remoteStream });
      },
      onHeld: (heldCallId) => {
        this.ctx.emit({ type: 'call.held', callId: heldCallId, remotePeerId });
      },
      onResumed: (resumedCallId) => {
        this.ctx.emit({ type: 'call.resumed', callId: resumedCallId, remotePeerId });
      },
      getConnection: (targetPeerId) => this.connectionManager.getOpenConnection(targetPeerId) as any,
      openConnection: (targetPeerId) => this.connectionManager.connect(this.peer, targetPeerId),
      removeConnection: (connectionId) => this.connectionManager.removeConnection(connectionId),
      notifyChange: () => this.ctx.notifyChange(),
    };

    const coordinator = new CallCoordinator(config);
    this.calls.set(callId, coordinator);
    this.ctx.bumpVersion();
  }

  private removeCall(callId: string, event?: any) {
    log.debug(`  removing call ${callId}`);
    const coordinator = this.calls.get(callId);
    if (coordinator) coordinator.destroy();
    this.calls.delete(callId);
    this.ctx.bumpVersion();
    if (event) this.ctx.emit(event);

    this.emitSelectionRequiredIfNeeded();
  }

  private emitSelectionRequiredIfNeeded() {
    let hasLive = false;
    const heldCallIds: string[] = [];

    for (const [id, coord] of this.calls) {
      const tag = coord.getStateTag();
      if (tag === 'live') hasLive = true;
      if (tag === 'held') heldCallIds.push(id);
    }

    if (!hasLive && heldCallIds.length > 0) {
      log.info(`  📋 selectionRequired — ${heldCallIds.length} held call(s), no live call`);
      this.ctx.emit({ type: 'call.selectionRequired', heldCallIds });
    }
  }

  public cleanupAll(): void {
    log.debug(`  cleaning up ${this.calls.size} call(s)`);
    for (const call of this.calls.values()) {
      try {
        call.destroy();
      } catch (e) {
        log.debug('  error during call cleanup:', e);
      }
    }
    this.calls.clear();
    this.ctx.bumpVersion();
  }

  public destroy(): void {
    this.cleanupAll();
  }
}
