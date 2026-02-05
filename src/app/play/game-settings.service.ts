import { Injectable, signal } from '@angular/core';
import { Player } from './board';

export type GameMode = 'one-player' | 'two-players';

export interface GameSettings {
  mode: GameMode;
  /** Only relevant for one-player mode. */
  humanPlaysAs?: Player;
  numberOfDepth?: number;
}

@Injectable({
  providedIn: 'root',
})
export class GameSettingsService {
  /** Undefined means the user hasn't selected a mode yet. */
  readonly settings = signal<GameSettings | undefined>(undefined);

  setTwoPlayers() {
    this.settings.set({ mode: 'two-players' });
  }

  setOnePlayer(humanPlaysAs: Player, difficulty: number) {
    this.settings.set({ mode: 'one-player', humanPlaysAs , numberOfDepth: difficulty});
  }

  clear() {
    this.settings.set(undefined);
  }
}
