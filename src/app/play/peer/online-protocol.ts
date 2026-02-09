import { Player } from '../board';

export type OnlineProtocolVersion = 1;

export interface OnlinePoint {
  x: number;
  y: number;
}

export type OnlineMessage = OnlineHelloMessage | OnlineMoveMessage | OnlineResetMessage;

export interface OnlineHelloMessage {
  type: 'hello';
  v: OnlineProtocolVersion;
  gameId: string;
  hostPlaysAs: Player;
}

export interface OnlineMoveMessage {
  type: 'move';
  v: OnlineProtocolVersion;
  gameId: string;
  /** Sender-local sequence number to dedupe messages. */
  seq: number;
  from: OnlinePoint;
  to: OnlinePoint;
}

export interface OnlineResetMessage {
  type: 'reset';
  v: OnlineProtocolVersion;
  gameId: string;
  reason: 'manual' | 'desync' | 'disconnect';
}

export function isOnlineMessage(v: unknown): v is OnlineMessage {
  if (!v || typeof v !== 'object') return false;
  const any = v as any;
  if (any.v !== 1 || typeof any.type !== 'string') return false;

  if (any.type === 'hello') {
    return typeof any.gameId === 'string' && typeof any.hostPlaysAs === 'number';
  }

  if (any.type === 'move') {
    return (
      typeof any.gameId === 'string' &&
      typeof any.seq === 'number' &&
      any.from &&
      typeof any.from.x === 'number' &&
      typeof any.from.y === 'number' &&
      any.to &&
      typeof any.to.x === 'number' &&
      typeof any.to.y === 'number'
    );
  }

  if (any.type === 'reset') {
    return typeof any.gameId === 'string' && typeof any.reason === 'string';
  }

  return false;
}

