import type { MediaConnection } from 'peerjs';
import { CallMachine } from './CallMachine';
import type { CallDirection, CallState, CallStateTag } from './state';
import type { CallInfo } from './types';
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
  private readonly callMachine: CallMachine;
  private connection: ConnectionMachine | null = null;
  private readonly _callId: string;
  private readonly _remotePeerId: string;
  private readonly config: CallCoordinatorConfig;

  constructor(
    config: CallCoordinatorConfig,
    callMachineFactory?: CallMachineFactory,
  ) {
    this.config = config;
    this._callId = config.callId;
    this._remotePeerId = config.remotePeerId;
    log.info(`🔧 CallCoordinator created — ${config.direction} call "${this._callId}" with "${this._remotePeerId}"`);

    const defaultFactory: CallMachineFactory = {
      create: (cfg) => new CallMachine(
        cfg.call,
        cfg.callId,
        cfg.remotePeerId,
        cfg.direction,
        (reason, callId) => {
          if (reason === 'rejected') {
            config.signalingService.sendCallRejected(callId, this._remotePeerId);
          } else {
            config.signalingService.sendCallDeclined(callId, this._remotePeerId);
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

  // ── Proxy Methods ───────────────────────────────────────────────────────────

  /** Get the current call state tag (e.g., 'ringing', 'live', 'held'). */
  public getStateTag(): CallStateTag {
    return this.callMachine.getState()._tag;
  }

  /** Check if the call is in one of the given states. */
  public isInState(...tags: CallStateTag[]): boolean {
    return tags.includes(this.callMachine.getState()._tag);
  }

  /** Get an immutable snapshot of the call's essential information. */
  public getCallInfo(): CallInfo {
    const state = this.callMachine.getState();
    let direction: 'inbound' | 'outbound' = 'outbound';
    if (state._tag === 'ringing') {
      direction = 'inbound';
    } else if ('direction' in state) {
      direction = (state as { direction: 'inbound' | 'outbound' }).direction;
    }
    return {
      callId: state.callId,
      remotePeerId: state.remotePeerId,
      state: state._tag,
      direction,
    };
  }

  /** Get the call ID. */
  public getCallId(): string {
    return this._callId;
  }

  /** Get the remote peer ID. */
  public getRemotePeerId(): string {
    return this._remotePeerId;
  }

  /** Hold this call if it is currently live. No-op otherwise. */
  public holdIfLive(): void {
    const state = this.callMachine.getState();
    if (state.is('live')) {
      state.hold();
    }
  }

  /** Get the current call state. Use for advanced/React consumers. */
  public getState(): CallState {
    return this.callMachine.getState();
  }

  /** Subscribe to state changes on the underlying machine. */
  public subscribe(cb: () => void): { unsubscribe: () => void } {
    return this.callMachine.subscribe(cb);
  }

  /** Register a transition listener. */
  public onTransition(listener: (next: CallState, prev: CallState) => void) {
    return this.callMachine.onTransition(listener);
  }

  private setupParallelConnection() {
    const existingConnection = this.config.getConnection(this._remotePeerId);

    // ── Signaling Handler Map (OCP-compliant) ───────────────────────────────
    // New message types = new map entries, no modification to dispatch logic.
    const signalingHandlers: Record<string, () => void> = {
      remote_close: () => {
        log.info(`  CallCoordinator[${this._callId}] received remote_close — closing call`);
        this.config.onEnded(this._callId, { type: 'call.ended' });
      },
      call_rejected: () => {
        log.info(`  CallCoordinator[${this._callId}] received call_rejected`);
        this.config.onEnded(this._callId, { type: 'call.rejected' });
      },
      call_declined: () => {
        log.info(`  CallCoordinator[${this._callId}] received call_declined`);
        this.config.onEnded(this._callId, { type: 'call.declined' });
      },
      call_held: () => {
        log.info(`  CallCoordinator[${this._callId}] received call_held — remote put us on hold`);
        const callState = this.callMachine.getState();
        if (callState._tag === 'live') {
          callState.remoteHeld();
        } else {
          log.warn(`  → ignoring call_held — call state is "${callState._tag}", not "live"`);
        }
      },
      call_resumed: () => {
        log.info(`  CallCoordinator[${this._callId}] received call_resumed — remote resumed`);
        const callState = this.callMachine.getState();
        if (callState._tag === 'remoteHeld') {
          callState.remoteResumed();
        } else {
          log.warn(`  → ignoring call_resumed — call state is "${callState._tag}", not "remoteHeld"`);
        }
      },
    };

    const handleSignalingMessage = (message: { type: string; callId: string }, connectionId: string) => {
      const handler = signalingHandlers[message.type];
      if (handler) {
        handler();
      } else {
        log.warn(`  CallCoordinator[${this._callId}] unknown signaling message type: "${message.type}"`);
      }
    };

    this.config.signalingService.registerHandler(this._callId, handleSignalingMessage);

    const onTerminalTransition = (state: CallState) => {
      if (state._tag === 'ended' || state._tag === 'error') {
        this.config.signalingService.unregisterHandler(this._callId);
        this.cleanupAfterCall();
      }
    };

    if (!existingConnection) {
      log.debug(`  no existing connection to "${this._remotePeerId}" — opening parallel connection`);
      this.config.openConnection(this._remotePeerId);
      this.callMachine.onTransition(onTerminalTransition);
    } else {
      this.connection = existingConnection;
      this.callMachine.onTransition(onTerminalTransition);
    }
  }

  private setupTransitionHandler() {
    this.callMachine.onTransition((next, prev) => {
      log.info(`  CallCoordinator[${this._callId}] call transition: ${prev._tag} → ${next._tag}`);

      // Live call established
      if (next._tag === 'live' && prev._tag === 'connecting') {
        this.config.onActive(this._callId, next.remoteStream);
      }

      // Local hold: live → held
      if (next._tag === 'held' && prev._tag === 'live') {
        this.config.signalingService.sendCallHeld(this._callId, this._remotePeerId);
        this.config.onHeld(this._callId);
      }

      // Local resume: held → live
      if (next._tag === 'live' && prev._tag === 'held') {
        this.config.signalingService.sendCallResumed(this._callId, this._remotePeerId);
        this.config.onResumed(this._callId, next.remoteStream);
      }

      // Remote hold: live → remoteHeld (signaling handled in setupParallelConnection)
      // Remote resume: remoteHeld → live (signaling handled in setupParallelConnection)

      // Terminal states
      if (next._tag === 'ended') {
        this.config.onEnded(this._callId, { type: 'call.ended' });
        return;
      }
      if (next._tag === 'error') {
        this.config.onEnded(this._callId, { type: 'call.error', error: next.error });
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
    log.info(`💀 CallCoordinator[${this._callId}].destroy()`);
    this.config.signalingService.unregisterHandler(this._callId);
    this.cleanupAfterCall();
    this.callMachine.destroy();
  }
}