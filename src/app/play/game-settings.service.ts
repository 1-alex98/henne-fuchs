import { Injectable, signal } from '@angular/core';
import { Player } from './board';

export type GameMode = 'one-player' | 'two-players';
export type OnlineRole = 'host' | 'join';

export interface GameSettings {
  mode: GameMode;
  /** True if the match is established via an online connection (PeerJS). */
  isOnline?: boolean;
  /** Only relevant for one-player mode. */
  humanPlaysAs?: Player;
  numberOfDepth?: number;

  /** Only relevant for two-player online mode. */
  onlineRole?: OnlineRole;
  /** Which side the host will play. */
  onlineHostPlaysAs?: Player;
}

@Injectable({
  providedIn: 'root',
})
export class GameSettingsService {
  /** Undefined means the user hasn't selected a mode yet. */
  readonly settings = signal<GameSettings | undefined>(undefined);

  setTwoPlayers() {
    this.settings.set({ mode: 'two-players', isOnline: false });
  }

  setTwoPlayersOnline(params: { role: OnlineRole; hostPlaysAs: Player }) {
    this.settings.set({
      mode: 'two-players',
      isOnline: true,
      onlineRole: params.role,
      onlineHostPlaysAs: params.hostPlaysAs,
    });
  }

  setOnePlayer(humanPlaysAs: Player, difficulty: number) {
    this.settings.set({ mode: 'one-player', isOnline: false, humanPlaysAs, numberOfDepth: difficulty });
  }

  clear() {
    this.settings.set(undefined);
  }
}
