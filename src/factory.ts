/**
 * Factory functions for creating PeerManager and MediaMachine instances.
 * These are the recommended entry points for most users.
 */

import Peer from 'peerjs';
import type { PeerOptions as PeerJsOptions } from 'peerjs';
import { PeerManager } from './peer/PeerManager';
import { MediaMachine } from './media/MediaManager';

// ── Options ───────────────────────────────────────────────────────────────────

export interface CreatePeerOptions {
  /**
   * Optional peer ID. If not provided, PeerJS will generate one.
   */
  peerId?: string;

  /**
   * Options forwarded to the PeerJS constructor.
   */
  peerJsOptions?: PeerJsOptions;

  /**
   * Enable or disable internal logging.
   * @default false
   */
  logging?: boolean;

  /**
   * Maximum number of reconnection attempts.
   * @default 5
   */
  maxRetries?: number;

  /**
   * Base delay (ms) for exponential backoff on reconnection.
   * @default 1000
   */
  baseRetryDelay?: number;
}

export interface CreateMediaOptions {
  /**
   * Automatically check media permissions on creation.
   * @default true
   */
  autoPermissions?: boolean;
}

// ── Factory Functions ─────────────────────────────────────────────────────────

/**
 * Create a PeerManager instance with sensible defaults.
 * This is the recommended way to create a peer connection.
 *
 * @example
 * ```ts
 * // Auto-generated peer ID
 * const peer = createPeer();
 *
 * // Custom peer ID
 * const peer = createPeer({ peerId: 'my-unique-id' });
 *
 * // With custom signaling server
 * const peer = createPeer({
 *   peerJsOptions: {
 *     host: 'my-server.com',
 *     port: 443,
 *     secure: true,
 *   },
 * });
 * ```
 */
export function createPeer(options: CreatePeerOptions = {}): PeerManager {
  const {
    peerId,
    peerJsOptions = {},
    logging = false,
    maxRetries = 5,
    baseRetryDelay = 1000,
  } = options;

  if (logging) {
    // Import and enable logging if requested
    import('./core/logger').then(({ setLogging }) => setLogging(true));
  }

  const peerJsConfig: PeerJsOptions = {
    ...peerJsOptions,
  };

  const peer = peerId ? new Peer(peerId, peerJsConfig) : new Peer(peerJsConfig);

  return new PeerManager({
    peer,
    maxRetries,
    baseRetryDelay,
  });
}

/**
 * Create a MediaMachine instance for managing local media streams.
 * This is the recommended way to handle camera/microphone access.
 *
 * @example
 * ```ts
 * const media = createMedia();
 *
 * // Request camera and microphone
 * media.getState(); // MediaIdleState
 * // media.getState().request({ audio: true, video: true });
 *
 * // Or check permissions first
 * // media.getState().checkPermissions();
 * ```
 */
export function createMedia(options: CreateMediaOptions = {}): MediaMachine {
  const { autoPermissions = true } = options;

  const media = new MediaMachine();

  if (autoPermissions) {
    // Start checking permissions immediately
    const state = media.getState();
    if (state._tag === 'idle') {
      state.checkPermissions();
    }
  }

  return media;
}
