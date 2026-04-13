import type { DataConnection, MediaConnection, Peer, PeerError } from "peerjs";
import { isState, type MachineContext } from "../core";
import { createLogger } from "../core/logger";
import { isFatalError, type PeerEmittedEvent } from "./types";

const log = createLogger("peer");

// ── Context ───────────────────────────────────────────────────────────────────

import type { CallManager } from '../call/CallManager';
import type { ConnectionManager } from '../connection/ConnectionManager';

export interface PeerContext extends MachineContext<PeerState> {
  emit: (event: PeerEmittedEvent) => void;
  notifyChange: () => void;
  bumpVersion: () => void;
  connectionManager: ConnectionManager;
  callManager: CallManager;
}

// ── Base ──────────────────────────────────────────────────────────────────────

export type PeerStateTag =
  | "initializing"
  | "ready"
  | "disconnected"
  | "error"
  | "destroyed";

export interface BasePeerState {
  readonly _tag: PeerStateTag;
  destroy(): void;
  is<T extends PeerStateTag>(tag: T): this is Extract<PeerState, { _tag: T }>;
}

// ── PeerInitializingState ────────────────────────────────────────────────────

export class PeerInitializingState implements BasePeerState {
  public readonly _tag = "initializing";

  constructor(
    public readonly peer: Peer,
    public readonly maxRetries: number,
    public readonly baseRetryDelay: number,
    private ctx: PeerContext,
  ) {
    log.info(
      '🚀 PeerInitializingState created — waiting for PeerJS "open" event',
    );
    log.debug(
      "  peer.id =",
      peer.id,
      "| peer.open =",
      peer.open,
      "| peer.destroyed =",
      peer.destroyed,
    );
    this.peer.on("open", this.onOpen);
    this.peer.on("error", this.onError);
    this.peer.on("close", this.onClose);
    this.peer.on("disconnected", this.onDisconnected);
  }

  private onOpen = (id: string) => {
    log.info(`✅ PeerJS "open" fired — peerId: ${id}`);
    this.destroy();
    const next = new PeerReadyState(
      this.peer,
      id,
      this.maxRetries,
      this.baseRetryDelay,
      this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: "peer.ready", peerId: id });
  };

  private onError = (error: PeerError<string>) => {
    log.error(
      '❌ PeerJS "error" during initialization',
      error.type,
      error.message,
    );
    if (isFatalError(error)) {
      log.warn("  → fatal error — transitioning to error state");
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: "peer.error", error });
  };

  private onClose = () => {
    log.warn('⚠️ PeerJS "close" during initialization — destroying peer');
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  private onDisconnected = () => {
    log.warn('⚠️ PeerJS "disconnected" during initialization');
    this.destroy();
    const next = new PeerDisconnectedState(
      this.peer,
      "",
      0,
      this.maxRetries,
      this.baseRetryDelay,
      this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: "peer.disconnected" });
  };

  public destroy() {
    log.debug(
      "  PeerInitializingState.destroy() — unregistering PeerJS listeners",
    );
    this.peer.off("open", this.onOpen);
    this.peer.off("error", this.onError);
    this.peer.off("close", this.onClose);
    this.peer.off("disconnected", this.onDisconnected);
  }

  public is<T extends PeerStateTag>(tag: T): this is Extract<PeerState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── PeerReadyState ───────────────────────────────────────────────────────────

export class PeerReadyState implements BasePeerState {
  public readonly _tag = "ready";

  constructor(
    public readonly peer: Peer,
    public readonly peerId: string,
    public readonly maxRetries: number,
    public readonly baseRetryDelay: number,
    private ctx: PeerContext,
  ) {
    log.info(`✅ PeerReadyState created — peerId: ${peerId}`);

    this.peer.on("connection", this.onConnection);
    this.peer.on("call", this.onIncomingCall);
    this.peer.on("disconnected", this.onDisconnected);
    this.peer.on("error", this.onError);
    this.peer.on("close", this.onClose);
  }

  // ── PeerJS callbacks ─────────────────────────────────────────────────────

  private onConnection = (connection: DataConnection) => {
    this.ctx.connectionManager.handleIncoming(connection);
  };

  private onIncomingCall = (call: MediaConnection) => {
    this.ctx.callManager.handleIncoming(call);
  };

  private onDisconnected = () => {
    log.warn('⚠️ PeerJS "disconnected" — peer lost connection to signaling server');
    this.destroy();
    const next = new PeerDisconnectedState(
      this.peer,
      this.peerId,
      0,
      this.maxRetries,
      this.baseRetryDelay,
      this.ctx,
    );
    this.ctx.transition(next);
    this.ctx.emit({ type: "peer.disconnected" });
  };

  private onError = (error: PeerError<string>) => {
    log.error('❌ PeerJS "error" in ready state', error.type, error.message);
    if (isFatalError(error)) {
      log.warn("  → fatal error — cleaning up children and transitioning to error state");
      this.ctx.connectionManager.cleanupAll();
      this.ctx.callManager.cleanupAll();
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: "peer.error", error });
  };

  private onClose = () => {
    log.warn('⚠️ PeerJS "close" in ready state — destroying peer');
    this.ctx.connectionManager.cleanupAll();
    this.ctx.callManager.cleanupAll();
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  public destroy() {
    log.debug("  PeerReadyState.destroy() — unregistering PeerJS listeners");
    this.peer.off("connection", this.onConnection);
    this.peer.off("call", this.onIncomingCall);
    this.peer.off("disconnected", this.onDisconnected);
    this.peer.off("error", this.onError);
    this.peer.off("close", this.onClose);
  }

  public is<T extends PeerStateTag>(tag: T): this is Extract<PeerState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── PeerDisconnectedState ────────────────────────────────────────────────────

export class PeerDisconnectedState implements BasePeerState {
  public readonly _tag = "disconnected";
  private retryCount: number;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    public readonly peer: Peer,
    public readonly peerId: string,
    initialRetryCount: number,
    public readonly maxRetries: number,
    public readonly baseRetryDelay: number,
    private ctx: PeerContext,
  ) {
    this.retryCount = initialRetryCount;
    log.warn(
      `⚠️ PeerDisconnectedState created — retryCount: ${this.retryCount}/${this.maxRetries}`,
    );

    this.peer.on("error", this.onError);
    this.peer.on("close", this.onClose);

    // Auto-reconnect
    if (this.retryCount < this.maxRetries) {
      const delay = Math.min(
        this.baseRetryDelay * 2 ** this.retryCount,
        30_000,
      );
      this.retryCount++;
      log.info(
        `  🔄 scheduling auto-reconnect in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`,
      );
      this.reconnectTimer = setTimeout(() => {
        this.reconnect();
      }, delay);
    } else {
      log.warn("  → max retries exhausted — no auto-reconnect");
    }
  }

  public reconnect() {
    log.info("🔄 reconnect() — cleaning up children and re-initializing");
    this.cleanupChildren();
    this.destroy();
    const next = new PeerInitializingState(
      this.peer,
      this.maxRetries,
      this.baseRetryDelay,
      this.ctx,
    );
    this.ctx.transition(next);
    this.peer.reconnect();
  }

  private onError = (error: PeerError<string>) => {
    log.error(
      '❌ PeerJS "error" while disconnected',
      error.type,
      error.message,
    );
    if (isFatalError(error)) {
      log.warn("  → fatal error — transitioning to error state");
      this.cleanupChildren();
      this.destroy();
      const next = new PeerErrorState(error);
      this.ctx.transition(next);
    }
    this.ctx.emit({ type: "peer.error", error });
  };

  private onClose = () => {
    log.warn('⚠️ PeerJS "close" while disconnected — destroying');
    this.cleanupChildren();
    this.destroy();
    this.peer.destroy();
    const next = new PeerDestroyedState();
    this.ctx.transition(next);
  };

  private cleanupChildren() {
    this.ctx.connectionManager.cleanupAll();
    this.ctx.callManager.cleanupAll();
  }

  public destroy() {
    log.debug("  PeerDisconnectedState.destroy()");
    clearTimeout(this.reconnectTimer);
    this.peer.off("error", this.onError);
    this.peer.off("close", this.onClose);
  }

  public is<T extends PeerStateTag>(tag: T): this is Extract<PeerState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── Terminal States ──────────────────────────────────────────────────────────

export class PeerErrorState implements BasePeerState {
  public readonly _tag = "error";
  constructor(public readonly lastError: PeerError<string>) {
    log.error("💀 PeerErrorState created", lastError.type, lastError.message);
  }
  public destroy() { }
  public is<T extends PeerStateTag>(tag: T): this is Extract<PeerState, { _tag: T }> {
    return isState(this, tag);
  }
}

export class PeerDestroyedState implements BasePeerState {
  public readonly _tag = "destroyed";
  constructor() {
    log.info("💀 PeerDestroyedState created");
  }
  public destroy() { }
  public is<T extends PeerStateTag>(tag: T): this is Extract<PeerState, { _tag: T }> {
    return isState(this, tag);
  }
}

// ── Union ────────────────────────────────────────────────────────────────────

export type PeerState =
  | PeerInitializingState
  | PeerReadyState
  | PeerDisconnectedState
  | PeerErrorState
  | PeerDestroyedState;
