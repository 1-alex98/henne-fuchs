import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Player } from '../board';
import { GameSettingsService } from '../game-settings.service';

type SelectStep = 'mode' | 'side';

@Component({
  selector: 'app-select-mode',
  imports: [],
  templateUrl: './select-mode.html',
  styleUrl: './select-mode.css',
})
export class SelectMode {
  private readonly router = inject(Router);
  private readonly settings = inject(GameSettingsService);

  protected readonly Player = Player;

  step = signal<SelectStep>('mode');
  /** Default the side selection to chickens (more common). */
  selectedSide = signal<Player>(Player.CHICKEN);

  chooseTwoPlayers() {
    this.settings.setTwoPlayers();
    void this.router.navigateByUrl('/play/game');
  }

  chooseOnePlayer() {
    this.step.set('side');
  }

  setSide(side: Player) {
    this.selectedSide.set(side);
  }

  startOnePlayer() {
    this.settings.setOnePlayer(this.selectedSide());
    void this.router.navigateByUrl('/play/game');
  }

  back() {
    this.step.set('mode');
  }
}
