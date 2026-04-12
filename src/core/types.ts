type Brand<T, B> = T & { readonly __brand: B };

export type PeerId = string;
export type CallId = Brand<string, 'CallId'>;
export type ConnectionId = Brand<string, 'ConnectionId'>;

export type Result<T, E> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } => 
  result.ok === true;

export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } => 
  result.ok === false;

export interface State {
  readonly _tag: string;
}

export interface Event {
  readonly type: string;
}

export type Command =
  | { type: 'peer.connect'; remotePeerId: PeerId }
  | { type: 'peer.call'; remotePeerId: PeerId; localStream: MediaStream }
  | { type: 'call.answer'; callId: CallId; localStream: MediaStream }
  | { type: 'call.hangUp'; callId: CallId }
  | { type: 'call.reject'; callId: CallId }
  | { type: 'connection.send'; connectionId: ConnectionId; data: unknown }
  | { type: 'connection.close'; connectionId: ConnectionId }
  | { type: 'media.getUserMedia'; constraints: MediaStreamConstraints; requestId: string }
  | { type: 'media.getDisplayMedia'; constraints: DisplayMediaStreamOptions; requestId: string }
  | { type: 'media.stopTracks'; stream: MediaStream }
  | { type: 'schedule.timeout'; delayMs: number; event: Event; timerId: string }
  | { type: 'schedule.cancelTimeout'; timerId: string }
  | { type: 'emit'; event: Event };

export type CommandHandler<C extends Command = Command> = (
  command: C
) => Promise<Event[]> | Event[];

export type Reducer<S extends State, E extends Event> = (
  state: S,
  event: E
) => readonly [S, readonly Command[]];

export function assertNever(x: never): never {
  throw new Error(`Unexpected object: ${JSON.stringify(x)}`);
}

export function exhaustive(_: never): void {}