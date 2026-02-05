import {Component, effect, inject, signal} from '@angular/core';
import { Router } from '@angular/router';
import {Board, JumpOption, Player, Point, State} from './board';
import {Overlay} from './overlay/overlay';
import { ToastService } from '../shared/toast/toast.service';
import { GameSettingsService } from './game-settings.service';
import { BoardMatrixService } from './ai/board-matrix.service';
import { Cell } from './cell/cell';

@Component({
  selector: 'app-play',
  imports: [
    Overlay,
    Cell,
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

  /** Animated UI model: one sprite per piece. */
  uiPieces = signal<{ key: string; state: State; x: number; y: number }[]>([]);
  private uiLocked = false;
  private readonly moveAnimMs = 220;

  private aiInProgress = false;

  /**
   * We only want to reset the board once the user has finished the select-mode flow
   * (i.e. GameSettings exist). This flag prevents repeated resets if settings change
   * while staying on /play/game.
   */
  private hasInitializedGame = false;

  /**
   * Keep the last couple chicken-result board fingerprints to avoid chicken oscillations
   * (e.g. left then immediately right). Only used when the AI plays chickens.
   */
  private chickenHistory: string[] = [];

  private fingerprintBoardForHistory(): string {
    // Use the same fingerprinting logic as BoardMatrixService (states only).
    const snap = this.boardMatrix.createSnapshot(this.boardService);
    return Array.from(snap.states).join(',');
  }

  constructor() {
    // Do NOT reset immediately on component creation.
    // If the user navigates directly to /play/game without selecting a mode yet,
    // we redirect them to /play/select and should not touch game state.

    // If the user hits /play/game directly, send them to the selection dialog.
    effect(() => {
      const s = this.settings.settings();
      if (!s) {
        this.hasInitializedGame = false;
        void this.router.navigateByUrl('/play/select');
        return;
      }

      // Select-mode is done -> start a fresh game exactly once.
      if (!this.hasInitializedGame) {
        this.onReset();
        this.hasInitializedGame = true;
      }
    });

    // Keep UI sprites in sync with board state when not animating.
    effect(() => {
      // Depend on these signals so the effect reruns after moves.
      this.boardService.playersTurn();
      this.boardService.winingReason();
      // Also depend on piece states.
      for (let x = 0; x < 7; x++) {
        for (let y = 0; y < 7; y++) {
          try {
            this.boardService.stateFor(x, y)();
          } catch {
            // Some coordinates are not part of the cross-shaped board.
          }
        }
      }
      if (!this.uiLocked) {
        this.resyncUiPiecesFromBoard();
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

      if (!isAiTurn || this.aiInProgress || this.uiLocked) return;

      this.aiInProgress = true;
      queueMicrotask(async () => {
        try {
          const move = this.boardMatrix.calculateNextMove(
            this.boardService,
            this.settings.settings()!.numberOfDepth ?? 3,
            aiPlayer,
            aiPlayer === Player.CHICKEN ? this.chickenHistory : [],
          );

          const result = await this.animateThenAttemptMove(move.from, move.to);

          // After a successful AI chicken move, record the resulting board state.
          if (aiPlayer === Player.CHICKEN && result.outcome !== 'ignored') {
            this.chickenHistory = [this.fingerprintBoardForHistory(), ...this.chickenHistory].slice(0, 2);
          }

          this.clearSelection();
        } finally {
          this.aiInProgress = false;
        }
      });
    });
  }

  private clearSelection() {
    this.selectedPiece.set(undefined);
    this.moves.set([]);
    this.jumps.set([]);
    this.allJumps.set([]);
    this.allMoves.set([]);
  }

  private resyncUiPiecesFromBoard() {
    const pieces = this.boardService.getPieces().map(p => ({
      key: `${p.state}-${p.point.x}-${p.point.y}`,
      state: p.state,
      x: p.point.x,
      y: p.point.y,
    }));
    this.uiPieces.set(pieces);
  }

  private async animateThenAttemptMove(from: Point, to: Point) {
    this.uiLocked = true;

    // Optimistically animate the sprite.
    const updated = this.uiPieces().map(p => (p.x === from.x && p.y === from.y ? { ...p, x: to.x, y: to.y } : p));
    this.uiPieces.set(updated);

    await new Promise(resolve => setTimeout(resolve, this.moveAnimMs));

    const result = this.boardService.attemptMove(
      from,
      to,
      this.boardService.getMoves(from),
      this.boardService.getJumps(from),
      this.boardService.getAllJumps(),
    );

    if (result.message) {
      this.toast.show(result.message, { variant: 'warning' });
    }

    this.uiLocked = false;
    // Final sync (handles captures/punishments etc.).
    this.resyncUiPiecesFromBoard();

    return result;
  }

  private isHumanTurn(): boolean {
    const s = this.settings.settings();
    if (!s || s.mode !== 'one-player') return true;
    const human = s.humanPlaysAs ?? Player.CHICKEN;
    return this.boardService.playersTurn() === human;
  }

  /** Template helper: build a proper Point instance for click handlers. */
  protected point(x: number, y: number): Point {
    return new Point(x, y);
  }

  protected clickedPiece(p: Point) {
    if (!this.isHumanTurn() || this.boardService.winingReason() || this.uiLocked) return;

    this.selectedPiece.set(p)
    this.moves.set(this.boardService.getMoves(p))
    this.jumps.set(this.boardService.getJumps(p))
    this.allJumps.set(this.boardService.getAllJumps())
    this.allMoves.set(this.boardService.getAllMoves())

    if (this.boardService.playersTurn() === Player.FOX && this.allMoves().length === 0 && this.allJumps().length === 0) {
      this.boardService.winingReason.set("No moves for foxes! Chickens win!")
    }
  }

  protected clickedMove(x: number, y: number) {
    if (!this.isHumanTurn() || this.boardService.winingReason() || this.uiLocked) return;

    const from = this.selectedPiece();
    if (!from) return;

    void this.animateThenAttemptMove(from, new Point(x, y)).then(result => {
      if (result.outcome === 'ignored') return;
      this.selectedPiece.set(undefined)
      this.moves.set([])
      this.jumps.set([])
      this.allJumps.set([])
    });
  }

  onReset() {
    this.boardService.reset();
    this.chickenHistory = [];

    this.clearSelection();
    this.resyncUiPiecesFromBoard();
  }

  onPlayAgain() {
    this.onReset();
    this.settings.clear();
    void this.router.navigateByUrl('/play/select');
  }

  protected readonly Player = Player;
  protected readonly State = State;

  protected styleClassFor(x: number, y: number) {
    if (this.jumps().find(option => option.end.x == x && option.end.y == y) != undefined) {
      return 'jumpable';
    }
    return this.moves().find(p => p.x == x && p.y == y) != undefined ? 'clickable' : '';
  }
}
