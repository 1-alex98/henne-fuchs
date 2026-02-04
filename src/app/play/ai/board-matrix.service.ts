import { Injectable } from '@angular/core';
import {Board, Player, Point, State} from '../board';
import {
  BoardMatrixSnapshot,
  BOARD_H,
  BOARD_W,
  countChickensInStall,
  createEmptySnapshot,
  evaluate,
  getMovesForChicken,
  getMovesForFox,
  idx,
  isValidCell,
  MatrixJumpOption,
  MatrixPoint,
} from './board-matrix';

/**
 * Creates a fast, immutable snapshot of the current `Board` state.
 *
 * This doesn't access any private fields on `Board`; it only uses `stateFor()`.
 */
export interface Move {
  from: Point,
  to: Point,
}

@Injectable({
  providedIn: 'root',
})
export class BoardMatrixService {
  createSnapshot(board: Board): BoardMatrixSnapshot {
    const snap = createEmptySnapshot();

    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        if (!isValidCell(x, y)) continue;
        snap.states[idx(x, y)] = board.stateFor(x, y)();
      }
    }

    return snap;
  }

  private cloneSnapWithStates(snap: BoardMatrixSnapshot, states: Uint8Array): BoardMatrixSnapshot {
    return {
      width: snap.width,
      height: snap.height,
      validMask: snap.validMask,
      states,
    };
  }

  private applyStepMove(snap: BoardMatrixSnapshot, from: MatrixPoint, to: MatrixPoint): BoardMatrixSnapshot {
    const next = new Uint8Array(snap.states);
    const piece = next[idx(from.x, from.y)];
    next[idx(from.x, from.y)] = State.EMPTY;
    next[idx(to.x, to.y)] = piece;
    return this.cloneSnapWithStates(snap, next);
  }

  private applyFoxJump(snap: BoardMatrixSnapshot, jump: MatrixJumpOption): BoardMatrixSnapshot {
    const next = new Uint8Array(snap.states);
    next[idx(jump.from.x, jump.from.y)] = State.EMPTY;
    for (const p of jump.toBeRemovedChickens) {
      next[idx(p.x, p.y)] = State.EMPTY;
    }
    next[idx(jump.end.x, jump.end.y)] = State.FOX;
    return this.cloneSnapWithStates(snap, next);
  }

  private allFoxMoves(snap: BoardMatrixSnapshot): { stepMoves: Array<{ from: MatrixPoint; to: MatrixPoint }>; jumps: MatrixJumpOption[] } {
    const stepMoves: Array<{ from: MatrixPoint; to: MatrixPoint }> = [];
    const jumps: MatrixJumpOption[] = [];

    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        const i = idx(x, y);
        if (snap.validMask[i] !== 1) continue;
        if (snap.states[i] !== State.FOX) continue;

        const res = getMovesForFox(snap, x, y);
        for (const m of res.moves) {
          stepMoves.push({ from: { x, y }, to: m });
        }
        jumps.push(...res.jumps);
      }
    }

    return { stepMoves, jumps };
  }

  private allChickenMoves(snap: BoardMatrixSnapshot): Array<{ from: MatrixPoint; to: MatrixPoint }> {
    const moves: Array<{ from: MatrixPoint; to: MatrixPoint }> = [];

    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        const i = idx(x, y);
        if (snap.validMask[i] !== 1) continue;
        if (snap.states[i] !== State.CHICKEN) continue;

        const tos = getMovesForChicken(snap, x, y);
        for (const to of tos) {
          moves.push({ from: { x, y }, to });
        }
      }
    }

    return moves;
  }

  /**
   * Heuristic score where higher is better for chickens.
   *
   * We start from `evaluate()` (which already considers alive + stall) and add:
   * - small reward for progressing more chickens into the stall
   * - penalty if the fox has any jump available next (chickens are "in danger")
   */
  private scoreForChickens(snap: BoardMatrixSnapshot): number {
    let s = evaluate(snap);

    // If <9 chickens alive, evaluate() returns 0. Keep it but still add danger/stall terms.
    s += countChickensInStall(snap) * 0.5;

    const fox = this.allFoxMoves(snap);
    if (fox.jumps.length > 0) {
      // Being jumpable is really bad.
      s -= 5;
      // More possible jump sequences is worse.
      s -= Math.min(fox.jumps.length, 6);
    }

    return s;
  }

  private otherPlayer(p: Player): Player {
    return p === Player.CHICKEN ? Player.FOX : Player.CHICKEN;
  }

  private minimax(
    snap: BoardMatrixSnapshot,
    depth: number,
    playerToMove: Player,
    alpha: number,
    beta: number,
  ): number {
    if (depth <= 0) {
      return this.scoreForChickens(snap);
    }

    if (playerToMove === Player.FOX) {
      // Fox minimizes chicken score.
      const foxMoves = this.allFoxMoves(snap);
      const hasForcedJumps = foxMoves.jumps.length > 0;
      const candidates: Array<BoardMatrixSnapshot> = [];

      if (hasForcedJumps) {
        for (const j of foxMoves.jumps) candidates.push(this.applyFoxJump(snap, j));
      } else {
        for (const m of foxMoves.stepMoves) candidates.push(this.applyStepMove(snap, m.from, m.to));
      }

      if (candidates.length === 0) return this.scoreForChickens(snap);

      let value = Number.POSITIVE_INFINITY;
      for (const child of candidates) {
        value = Math.min(value, this.minimax(child, depth - 1, this.otherPlayer(playerToMove), alpha, beta));
        beta = Math.min(beta, value);
        if (beta <= alpha) break;
      }
      return value;
    }

    // Chicken maximizes chicken score.
    const chickenMoves = this.allChickenMoves(snap);
    if (chickenMoves.length === 0) return this.scoreForChickens(snap);

    let value = Number.NEGATIVE_INFINITY;
    for (const m of chickenMoves) {
      const child = this.applyStepMove(snap, m.from, m.to);
      value = Math.max(value, this.minimax(child, depth - 1, this.otherPlayer(playerToMove), alpha, beta));
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  }

  calculateNextMove(board: Board, depth: number, player: Player): Move {
    const snap = this.createSnapshot(board);

    // Generate root candidates and pick the best for the current player.
    if (player === Player.FOX) {
      const foxMoves = this.allFoxMoves(snap);
      const hasForcedJumps = foxMoves.jumps.length > 0;

      let bestValue = Number.POSITIVE_INFINITY;
      let best: { from: MatrixPoint; to: MatrixPoint } | undefined;

      if (hasForcedJumps) {
        for (const j of foxMoves.jumps) {
          const child = this.applyFoxJump(snap, j);
          const value = this.minimax(child, Math.max(0, depth - 1), Player.CHICKEN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
          if (value < bestValue || !best) {
            bestValue = value;
            best = { from: j.from, to: j.end };
          }
        }
      } else {
        for (const m of foxMoves.stepMoves) {
          const child = this.applyStepMove(snap, m.from, m.to);
          const value = this.minimax(child, Math.max(0, depth - 1), Player.CHICKEN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
          if (value < bestValue || !best) {
            bestValue = value;
            best = { from: m.from, to: m.to };
          }
        }
      }

      // Fallback (shouldn't happen in normal play)
      best ??= { from: { x: 2, y: 2 }, to: { x: 2, y: 2 } };

      return {
        from: new Point(best.from.x, best.from.y),
        to: new Point(best.to.x, best.to.y),
      };
    }

    // Chicken turn
    const chickenMoves = this.allChickenMoves(snap);
    let bestValue = Number.NEGATIVE_INFINITY;
    let best: { from: MatrixPoint; to: MatrixPoint } | undefined;

    for (const m of chickenMoves) {
      const child = this.applyStepMove(snap, m.from, m.to);
      const value = this.minimax(child, Math.max(0, depth - 1), Player.FOX, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
      if (value > bestValue || !best) {
        bestValue = value;
        best = m;
      }
    }

    best ??= { from: { x: 2, y: 3 }, to: { x: 2, y: 3 } };

    return {
      from: new Point(best.from.x, best.from.y),
      to: new Point(best.to.x, best.to.y),
    };
  }
}
