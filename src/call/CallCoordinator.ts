import type { MediaConnection } from 'peerjs';
import { CallMachine } from './CallMachine';
import type { CallDirection, CallState } from './state';
import { SignalingService } from '../signaling';
import { ConnectionMachine } from '../connection/ConnectionMachine';
import { createLogger } from '../core/logger';

/** Factory interface for creating CallMachine instances (used for DI / testing). */
export interface CallMachineFactory {
  create(config: {
    call: MediaConnection;
    callId: string;
    remotePeerId: string;
    direction: CallDirection;
  }): CallMachine;
}

const log = createLogger('CallCoordinator');

export interface CallCoordinatorConfig {
  call: MediaConnection;
  callId: string;
  remotePeerId: string;
  direction: CallDirection;
  signalingService: SignalingService;
  onEnded: (callId: string, event: { type: 'call.ended' } | { type: 'call.error'; error: Error } | { type: 'call.rejected' } | { type: 'call.declined' }) => void;
  onActive: (callId: string, remoteStream: MediaStream) => void;
  onHeld: (callId: string) => void;
  onResumed: (callId: string, remoteStream: MediaStream) => void;
  getConnection: (remotePeerId: string) => ConnectionMachine | null;
  openConnection: (remotePeerId: string) => void;
  removeConnection: (connectionId: string) => void;
  notifyChange: () => void;
}

export class CallCoordinator {
  public readonly callMachine: CallMachine;
  private connection: ConnectionMachine | null = null;
  private callId: string;
  private remotePeerId: string;
  private readonly config: CallCoordinatorConfig;

  constructor(
    config: CallCoordinatorConfig,
    callMachineFactory?: CallMachineFactory,
  ) {
    this.config = config;
    this.callId = config.callId;
    this.remotePeerId = config.remotePeerId;
    log.info(`🔧 CallCoordinator created — ${config.direction} call "${this.callId}" with "${this.remotePeerId}"`);

    const defaultFactory: CallMachineFactory = {
      create: (cfg) => new CallMachine(
        cfg.call,
        cfg.callId,
        cfg.remotePeerId,
        cfg.direction,
        (reason, callId) => {
          if (reason === 'rejected') {
            config.signalingService.sendCallRejected(callId, this.remotePeerId);
          } else {
            config.signalingService.sendCallDeclined(callId, this.remotePeerId);
          }
        },
      ),
    };

    const factory = callMachineFactory ?? defaultFactory;
    this.callMachine = factory.create({
      call: config.call,
      callId: config.callId,
      remotePeerId: config.remotePeerId,
      direction: config.direction,
    });

    this.setupParallelConnection();
    this.setupTransitionHandler();
  }

  private setupParallelConnection() {
    const existingConnection = this.config.getConnection(this.remotePeerId);

    const handleSignalingMessage = (message: { type: string; callId: string }, connectionId: string) => {
      if (message.type === 'remote_close') {
        log.info(`  CallCoordinator[${this.callId}] received remote_close — closing call`);
        this.config.onEnded(this.callId, { type: 'call.ended' });
        return;
      }
      if (message.type === 'call_rejected') {
        log.info(`  CallCoordinator[${this.callId}] received call_rejected`);
        this.config.onEnded(this.callId, { type: 'call.rejected' });
        return;
      }
      if (message.type === 'call_declined') {
        log.info(`  CallCoordinator[${this.callId}] received call_declined`);
        this.config.onEnded(this.callId, { type: 'call.declined' });
        return;
      }
      if (message.type === 'call_held') {
        log.info(`  CallCoordinator[${this.callId}] received call_held — remote put us on hold`);
        const callState = this.callMachine.getState();
        if (callState._tag === 'live') {
          callState.remoteHeld();
        } else {
          log.warn(`  → ignoring call_held — call state is "${callState._tag}", not "live"`);
        }
        return;
      }
      if (message.type === 'call_resumed') {
        log.info(`  CallCoordinator[${this.callId}] received call_resumed — remote resumed`);
        const callState = this.callMachine.getState();
        if (callState._tag === 'remoteHeld') {
          callState.remoteResumed();
        } else {
          log.warn(`  → ignoring call_resumed — call state is "${callState._tag}", not "remoteHeld"`);
        }
        return;
      }
    };

    this.config.signalingService.registerHandler(this.callId, handleSignalingMessage);

    if (!existingConnection) {
      log.debug(`  no existing connection to "${this.remotePeerId}" — opening parallel connection`);
      this.config.openConnection(this.remotePeerId);
      this.callMachine.onTransition((state) => {
        if (state._tag === 'ended' || state._tag === 'error') {
          this.config.signalingService.unregisterHandler(this.callId);
          this.cleanupAfterCall();
        }
      });
    } else {
      this.connection = existingConnection;
      this.callMachine.onTransition((state) => {
        if (state._tag === 'ended' || state._tag === 'error') {
          this.config.signalingService.unregisterHandler(this.callId);
          this.cleanupAfterCall();
        }
      });
    }
  }

  private setupTransitionHandler() {
    this.callMachine.onTransition((next, prev) => {
      log.info(`  CallCoordinator[${this.callId}] call transition: ${prev._tag} → ${next._tag}`);

      // Live call established
      if (next._tag === 'live' && prev._tag === 'connecting') {
        this.config.onActive(this.callId, next.remoteStream);
      }

      // Local hold: live → held
      if (next._tag === 'held' && prev._tag === 'live') {
        this.config.signalingService.sendCallHeld(this.callId, this.remotePeerId);
        this.config.onHeld(this.callId);
      }

      // Local resume: held → live
      if (next._tag === 'live' && prev._tag === 'held') {
        this.config.signalingService.sendCallResumed(this.callId, this.remotePeerId);
        this.config.onResumed(this.callId, next.remoteStream);
      }

      // Remote hold: live → remoteHeld (signaling handled in setupParallelConnection)
      // Remote resume: remoteHeld → live (signaling handled in setupParallelConnection)

      // Terminal states
      if (next._tag === 'ended') {
        this.config.onEnded(this.callId, { type: 'call.ended' });
        return;
      }
      if (next._tag === 'error') {
        this.config.onEnded(this.callId, { type: 'call.error', error: next.error });
        return;
      }

      this.config.notifyChange();
    });
  }

  private cleanupAfterCall() {
    if (this.connection) {
      const connId = this.connection.getState().connectionId;
      this.config.removeConnection(connId);
      this.connection = null;
    }
  }

  public destroy() {
    log.info(`💀 CallCoordinator[${this.callId}].destroy()`);
    this.config.signalingService.unregisterHandler(this.callId);
    this.cleanupAfterCall();
    this.callMachine.destroy();
  }
}