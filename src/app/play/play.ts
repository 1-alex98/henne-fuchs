import {Component, effect, inject, signal} from '@angular/core';
import { Router } from '@angular/router';
import {Board, JumpOption, Player, Point, State} from './board';
import {Overlay} from './overlay/overlay';
import { ToastService } from '../shared/toast/toast.service';
import { GameSettingsService } from './game-settings.service';
import { BoardMatrixService } from './ai/board-matrix.service';
import { Cell } from './cell/cell';
import { PeerConnectionService } from './peer/peer-connection.service';
import { isOnlineMessage, OnlineHelloMessage, OnlineMoveMessage, OnlineResetMessage } from './peer/online-protocol';

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
  private readonly peerConnection = inject(PeerConnectionService);

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

  /** Online: local/remote mapping + lightweight session data. */
  protected readonly isOnlineGame = signal<boolean>(false);
  protected readonly localPlaysAs = signal<Player | undefined>(undefined);
  private onlineGameId: string | undefined;
  private localSeq = 0;
  private lastRemoteSeq = -1;

  // Track whether we have already sent the host hello for the current session.
  private hostHelloPending: OnlineHelloMessage | undefined;
  private hostHelloSent = false;

  /** When true we show an overlay spinner and block input. */
  protected readonly onlineWaiting = signal<boolean>(false);
  protected readonly onlineWaitingText = signal<string>('');

  private disconnectToastShown = false;
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

    // Determine online mode role mapping.
    effect(() => {
      const s = this.settings.settings();
      if (!s || s.mode !== 'two-players' || !s.isOnline) {
        this.isOnlineGame.set(false);
        this.localPlaysAs.set(undefined);
        this.onlineGameId = undefined;
        this.localSeq = 0;
        this.lastRemoteSeq = -1;
        this.disconnectToastShown = false;
        this.onlineWaiting.set(false);
        this.hostHelloPending = undefined;
        this.hostHelloSent = false;
        return;
      }

      this.isOnlineGame.set(true);

      // Host always decides which side they play.
      const hostPlaysAs = s.onlineHostPlaysAs ?? Player.CHICKEN;
      const localSide = s.onlineRole === 'host' ? hostPlaysAs : hostPlaysAs === Player.CHICKEN ? Player.FOX : Player.CHICKEN;
      this.localPlaysAs.set(localSide);

      // Reset per-session sequencing.
      this.localSeq = 0;
      this.lastRemoteSeq = -1;

      // Host creates a fresh game id and informs joiner.
      if (s.onlineRole === 'host') {
        this.onlineGameId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        this.hostHelloPending = { type: 'hello', v: 1, gameId: this.onlineGameId, hostPlaysAs };
        this.hostHelloSent = false;
      } else {
        // Joiner waits for hello.
        this.onlineGameId = undefined;
        this.hostHelloPending = undefined;
        this.hostHelloSent = false;
      }

      this.disconnectToastShown = false;
    });

    // Send host hello once the data channel is actually connected.
    effect(() => {
      if (!this.isOnlineGame()) return;

      const s = this.settings.settings();
      if (!s || s.mode !== 'two-players' || !s.isOnline) return;
      if (s.onlineRole !== 'host') return;

      const status = this.peerConnection.state().status;
      if (status !== 'connected') return;
      if (!this.hostHelloPending || this.hostHelloSent) return;

      // Best-effort send; if it fails (rare race), retry a few times.
      const msg = this.hostHelloPending;
      const trySend = (attempt: number) => {
        if (this.hostHelloSent) return;
        if (this.peerConnection.state().status !== 'connected') return;
        const ok = this.peerConnection.send(msg);
        if (ok) {
          this.hostHelloSent = true;
          return;
        }
        if (attempt < 10) {
          setTimeout(() => trySend(attempt + 1), 250);
        }
      };

      trySend(0);
    });

    // Connection status -> waiting overlay + toasts.
    effect(() => {
      if (!this.isOnlineGame()) {
        this.onlineWaiting.set(false);
        this.onlineWaitingText.set('');
        return;
      }

      const state = this.peerConnection.state();
      const status = state.status;

      const waitingText =
        status === 'reconnecting' ? 'Reconnecting…' :
        status === 'connecting' ? 'Connecting…' :
        status === 'waiting-for-peer' ? 'Waiting for your friend…' :
        status === 'creating-peer' ? 'Creating connection…' :
        status === 'error' ? 'Disconnected.' : '';

      const shouldWait = status !== 'connected';
      this.onlineWaiting.set(shouldWait);
      this.onlineWaitingText.set(waitingText);

      // If we drop out of connected state mid-game, show a toast and restart.
      if ((status === 'reconnecting' || status === 'error') && !this.disconnectToastShown) {
        this.disconnectToastShown = true;
        this.toast.show('Connection lost. Restarting online game…', { variant: 'warning' });
        this.scheduleRestartToSelect('disconnect');
      }
    });

    // Consume incoming online messages.
    effect(() => {
      if (!this.isOnlineGame()) return;

      const raw = this.peerConnection.messages();
      if (!raw) return;
      if (!isOnlineMessage(raw)) return;

      if (raw.type === 'hello') {
        // Joiner learns gameId; host can ignore.
        if (!this.onlineGameId) {
          this.onlineGameId = raw.gameId;
        }
        return;
      }

      // Ignore messages for other games.
      if (this.onlineGameId && raw.gameId !== this.onlineGameId) return;

      if (raw.type === 'move') {
        void this.applyRemoteMove(raw);
        return;
      }

      if (raw.type === 'reset') {
        // Remote restarted -> tear down locally, too.
        this.restartToSelect('manual', 'Other player restarted the match.');
        return;
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

  myRoleInOnlineGame() {
    return this.settings.settings()?.onlineRole! === 'host' ? this.settings.settings()?.onlineHostPlaysAs! :
      this.settings.settings()?.onlineHostPlaysAs === Player.CHICKEN ? Player.FOX : Player.CHICKEN;
  }

  private restartToSelect(reason: OnlineResetMessage['reason'], showToast?: string) {
    // Prevent double navigation / double-disconnect.
    if (showToast) {
      this.toast.show(showToast, { variant: 'warning' });
    }

    // Best-effort inform the other peer (if still connected).
    if (this.isOnlineGame()) {
      const gameId = this.onlineGameId;
      if (gameId) {
        this.peerConnection.send({ type: 'reset', v: 1, gameId, reason } satisfies OnlineResetMessage);
      }
    }

    // Tear down connection first, then reset local state and go back to select.
    try {
      this.peerConnection.disconnect();
    } catch {
      // ignore
    }

    this.onReset();
    this.settings.clear();
    void this.router.navigateByUrl('/play/select');
  }

  private scheduleRestartToSelect(reason: OnlineResetMessage['reason'] = 'disconnect') {
    setTimeout(() => {
      // Fully reset connection + settings and return to the selection modal.
      this.restartToSelect(reason);
    }, 12000);
  }

  private async applyRemoteMove(msg: OnlineMoveMessage) {
    // Dedupe.
    if (msg.seq <= this.lastRemoteSeq) return;
    this.lastRemoteSeq = msg.seq;

    // In online mode, we should only ever receive opponent moves.
    // If we're currently animating, wait a moment to avoid interleaving.
    if (this.uiLocked) {
      await new Promise(resolve => setTimeout(resolve, this.moveAnimMs));
    }

    const from = new Point(msg.from.x, msg.from.y);
    const to = new Point(msg.to.x, msg.to.y);

    const result = await this.animateThenAttemptMove(from, to);

    if (result.outcome === 'ignored') {
      this.toast.show('Game got out of sync. Restarting…', { variant: 'warning' });
      this.scheduleRestartToSelect();
      return;
    }

    this.clearSelection();
  }

  private clearSelection() {
    this.selectedPiece.set(undefined);
    this.moves.set([]);
    this.jumps.set([]);
    this.allJumps.set([]);
    this.allMoves.set([]);
  }

  onReset() {
    this.boardService.reset();
    this.chickenHistory = [];

    this.clearSelection();
    this.resyncUiPiecesFromBoard();
  }

  onPlayAgain() {
    // In online mode, fully disconnect so the next game can start cleanly.
    if (this.isOnlineGame()) {
      this.restartToSelect('manual');
      return;
    }

    this.onReset();
    this.settings.clear();
    void this.router.navigateByUrl('/play/select');
  }

  protected readonly Player = Player;
  protected readonly State = State;

  private isLocalPlayersTurn(): boolean {
    if (!this.isOnlineGame()) return true;
    const side = this.localPlaysAs();
    if (side === undefined) return false;
    return this.boardService.playersTurn() === side;
  }

  private isHumanTurn(): boolean {
    // Online: local player is always a human.
    if (this.isOnlineGame()) return this.isLocalPlayersTurn();

    // Offline: one-player mode needs gating.
    const s = this.settings.settings();
    if (!s || s.mode !== 'one-player') return true;
    const human = s.humanPlaysAs ?? Player.CHICKEN;
    return this.boardService.playersTurn() === human;
  }

  protected opponentWaiting(): boolean {
    if (!this.isOnlineGame()) return false;
    // If it's not our turn and we're connected, we're waiting for the opponent.
    if (this.peerConnection.state().status !== 'connected') return false;
    return !this.isLocalPlayersTurn();
  }

  /** Template helper: build a proper Point instance for click handlers. */
  protected point(x: number, y: number): Point {
    return new Point(x, y);
  }

  protected clickedPiece(p: Point) {
    if (!this.isHumanTurn() || this.boardService.winingReason() || this.uiLocked || this.onlineWaiting()) return;

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
    if (!this.isHumanTurn() || this.boardService.winingReason() || this.uiLocked || this.onlineWaiting()) return;

    const from = this.selectedPiece();
    if (!from) return;

    const to = new Point(x, y);

    void this.animateThenAttemptMove(from, to).then(result => {
      if (result.outcome === 'ignored') return;

      // Online: send accepted move to the opponent.
      if (this.isOnlineGame()) {
        const gameId = this.onlineGameId;
        if (gameId) {
          const ok = this.peerConnection.send({
            type: 'move',
            v: 1,
            gameId,
            seq: ++this.localSeq,
            from: { x: from.x, y: from.y },
            to: { x: to.x, y: to.y },
          } satisfies OnlineMoveMessage);

          if (!ok) {
            this.toast.show('Could not send move. Restarting…', { variant: 'warning' });
            this.scheduleRestartToSelect();
            return;
          }
        }
      }

      this.clearSelection();
    });
  }

  protected styleClassFor(x: number, y: number) {
    if (this.jumps().find(option => option.end.x == x && option.end.y == y) != undefined) {
      return 'jumpable';
    }
    return this.moves().find(p => p.x == x && p.y == y) != undefined ? 'clickable' : '';
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
}
