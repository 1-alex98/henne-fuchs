import {Component, effect, inject, signal, Signal} from '@angular/core';
import { Router } from '@angular/router';
import {Cell} from './cell';
import {Board, JumpOption, Player, Point, State} from './board';
import {Overlay} from './overlay';
import { ToastService } from '../shared/toast/toast.service';
import { GameSettingsService } from './game-settings.service';
import { BoardMatrixService } from './ai/board-matrix.service';

@Component({
  selector: 'app-play',
  imports: [
    Cell,
    Overlay
  ],
  templateUrl: './play.html',
  styleUrl: './play.css',
})
export class Play {

  boardService = inject(Board)
  private readonly toast = inject(ToastService)
  private readonly router = inject(Router);
  private readonly settings = inject(GameSettingsService);
  private readonly boardMatrix = inject(BoardMatrixService);

  selectedPiece = signal<Point | undefined>(undefined)
  moves = signal<Point[]>([])
  jumps = signal<JumpOption[]>([])
  allJumps = signal<JumpOption[]>([])
  allMoves = signal<Point[]>([])

  private aiInProgress = false;

  constructor() {
    // If the user hits /play/game directly, send them to the selection dialog.
    effect(() => {
      if (!this.settings.settings()) {
        void this.router.navigateByUrl('/play/select');
      }
    });

    // One-player mode: auto-play the AI side.
    effect(() => {
      const s = this.settings.settings();
      if (!s || s.mode !== 'one-player') return;
      if (this.boardService.winingReason()) return;

      const human = s.humanPlaysAs ?? Player.CHICKEN;
      const aiPlayer = human === Player.CHICKEN ? Player.FOX : Player.CHICKEN;
      const isAiTurn = this.boardService.playersTurn() === aiPlayer;

      if (!isAiTurn || this.aiInProgress) return;

      this.aiInProgress = true;
      queueMicrotask(() => {
        try {
          const move = this.boardMatrix.calculateNextMove(this.boardService, 3, aiPlayer);
          const result = this.boardService.attemptMove(
            move.from,
            move.to,
            this.boardService.getMoves(move.from),
            this.boardService.getJumps(move.from),
            this.boardService.getAllJumps(),
          );

          if (result.message) {
            this.toast.show(result.message, { variant: 'warning' });
          }

          // Clear any selection after AI move.
          this.selectedPiece.set(undefined);
          this.moves.set([]);
          this.jumps.set([]);
          this.allJumps.set([]);
          this.allMoves.set([]);
        } finally {
          this.aiInProgress = false;
        }
      });
    });
  }

  private isHumanTurn(): boolean {
    const s = this.settings.settings();
    if (!s || s.mode !== 'one-player') return true;
    const human = s.humanPlaysAs ?? Player.CHICKEN;
    return this.boardService.playersTurn() === human;
  }

  public stateFor(x:number, y:number):Signal<State> {
    return this.boardService.stateFor(x, y);
  }

  protected clickedPiece(p: Point) {
    if (!this.isHumanTurn() || this.boardService.winingReason()) return;

    this.selectedPiece.set(p)
    this.moves.set(this.boardService.getMoves(p))
    this.jumps.set(this.boardService.getJumps(p))
    this.allJumps.set(this.boardService.getAllJumps())
    this.allMoves.set(this.boardService.getAllMoves())

    if (this.boardService.playersTurn() === Player.FOX && this.allMoves().length === 0 && this.allJumps().length === 0) {
      this.boardService.winingReason.set("No moves for foxes! Chickens win!")
    }
  }

  protected styleClassFor(x: number, y: number) {
    if(this.jumps().find(option => option.end.x == x && option.end.y == y) != undefined) {
      return "jumpable";
    }
    return this.moves().find(p => p.x == x && p.y == y) != undefined? "clickable" : "" ;
  }

  protected clickedMove(x: number, y: number) {
    if (!this.isHumanTurn() || this.boardService.winingReason()) return;

    const result = this.boardService.attemptMove(this.selectedPiece(), new Point(x, y), this.moves(), this.jumps(), this.allJumps());

    if (result.message) {
      this.toast.show(result.message, { variant: 'warning' });
    }

    if (result.outcome === 'ignored') {
      return;
    }

    this.selectedPiece.set(undefined)
    this.moves.set([])
    this.jumps.set([])
    this.allJumps.set([])
  }

  onReset() {
    this.boardService.reset();
    this.selectedPiece.set(undefined)
    this.moves.set([]);
    this.jumps.set([]);
    this.allJumps.set([]);
  }

  onPlayAgain() {
    this.onReset();
    this.settings.clear();
    void this.router.navigateByUrl('/play/select');
  }

  protected readonly Player = Player;
}
