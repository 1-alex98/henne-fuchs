import { State } from '../board';

/**
 * Fast snapshot representation of the game board.
 *
 * - Uses a fixed 7x7 grid (49 indices) to keep indexing trivial.
 * - Corners that don't exist in the game board are marked via `validMask`.
 * - `states[i]` is meaningful only when `validMask[i] === 1`.
 */
export interface BoardMatrixSnapshot {
  readonly width: 7;
  readonly height: 7;

  /** 1 = valid board cell exists, 0 = invalid (cut out corner) */
  readonly validMask: Uint8Array;

  /** Encoded `State` values at each coordinate (length = 49). */
  readonly states: Uint8Array;
}

export const BOARD_W = 7 as const;
export const BOARD_H = 7 as const;

export function idx(x: number, y: number): number {
  return y * BOARD_W + x;
}

/** Same geometry rule as in `Board` constructor (board.ts). */
export function isValidCell(x: number, y: number): boolean {
  if (x < 0 || x >= BOARD_W || y < 0 || y >= BOARD_H) return false;
  return !((x <= 1 || x >= 5) && (y <= 1 || y >= 5));
}

export function createEmptySnapshot(): BoardMatrixSnapshot {
  const validMask = new Uint8Array(BOARD_W * BOARD_H);
  const states = new Uint8Array(BOARD_W * BOARD_H);

  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      const i = idx(x, y);
      const valid = isValidCell(x, y);
      validMask[i] = valid ? 1 : 0;
      states[i] = State.EMPTY;
    }
  }

  return {
    width: BOARD_W,
    height: BOARD_H,
    validMask,
    states,
  };
}

export interface MatrixPoint {
  x: number;
  y: number;
}

export interface MatrixJumpOption {
  /** true when this jump ends the sequence (no follow-up jumps possible) */
  toBeRemovedChickens: MatrixPoint[];
  from: MatrixPoint;
  end: MatrixPoint;
}

// --- Evaluation helpers (Chicken's turn) ---

/** Mirrors `Board.chickensInStall` geometry rule in `board.ts`. */
function isStallCell(x: number, y: number): boolean {
  return y <= 1 || (y === 2 && x >= 2 && x <= 4);
}

function countChickensAlive(snap: BoardMatrixSnapshot): number {
  let count = 0;
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      if (!inBoundsAndValid(snap, x, y)) continue;
      if (snap.states[idx(x, y)] === State.CHICKEN) count++;
    }
  }
  return count;
}

export function countChickensInStall(snap: BoardMatrixSnapshot): number {
  let count = 0;
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      if (!inBoundsAndValid(snap, x, y)) continue;
      if (!isStallCell(x, y)) continue;
      if (snap.states[idx(x, y)] === State.CHICKEN) count++;
    }
  }
  return count;
}

/**
 * Heuristic evaluation assuming it is Chicken's turn.
 *
 * Scoring:
 * - +2 points for every chicken alive (on the board)
 * - +3 points for every chicken in the stall
 */
export function evaluate(snap: BoardMatrixSnapshot): number {
  const alive = countChickensAlive(snap);
  if(alive < 9 ) return 0; // Chickens lost
  const inStall = countChickensInStall(snap);
  if(inStall === 9) return 1000; // Chickens won
  return alive * 2 + inStall * 3;
}

function inBoundsAndValid(snap: BoardMatrixSnapshot, x: number, y: number): boolean {
  if (x < 0 || x >= BOARD_W || y < 0 || y >= BOARD_H) return false;
  return snap.validMask[idx(x, y)] === 1;
}

function isEmpty(snap: BoardMatrixSnapshot, x: number, y: number): boolean {
  return snap.states[idx(x, y)] === State.EMPTY;
}

function getConnectedPoints(snap: BoardMatrixSnapshot, x: number, y: number, onlyChicken: boolean): MatrixPoint[] {
  const pts: MatrixPoint[] = [];

  pts.push({ x: x - 1, y });
  pts.push({ x: x + 1, y });
  pts.push({ x, y: y - 1 });

  if (!onlyChicken) {
    pts.push({ x, y: y + 1 });
  }

  const sameParity = (x % 2 === 0 && y % 2 === 0) || (x % 2 !== 0 && y % 2 !== 0);
  if (sameParity && !onlyChicken) {
    pts.push({ x: x + 1, y: y + 1 });
    pts.push({ x: x - 1, y: y + 1 });
    pts.push({ x: x + 1, y: y - 1 });
    pts.push({ x: x - 1, y: y - 1 });
  }

  return pts.filter(p => inBoundsAndValid(snap, p.x, p.y));
}

export function getMovesForChicken(snap: BoardMatrixSnapshot, fromX: number, fromY: number): MatrixPoint[] {
  if (!inBoundsAndValid(snap, fromX, fromY)) return [];
  if (snap.states[idx(fromX, fromY)] !== State.CHICKEN) return [];

  const connected = getConnectedPoints(snap, fromX, fromY, true);
  return connected.filter(p => isEmpty(snap, p.x, p.y));
}

function cloneStates(states: Uint8Array): Uint8Array {
  // Uint8Array#slice exists in modern runtimes, but `new Uint8Array(states)` is the safest copy.
  return new Uint8Array(states);
}

/**
 * Returns ONLY terminal (good) jump sequences for a fox from a given position.
 *
 * Contract:
 * - `from` is the original fox starting position for the entire chain.
 * - `capturedSoFar` is the list of already-captured chickens along the path.
 * - Each returned option represents a completed jump chain (no further jumps possible).
 */
function getFoxJumpsInternal(
  snap: BoardMatrixSnapshot,
  x: number,
  y: number,
  capturedSoFar: MatrixPoint[],
  from: MatrixPoint,
): MatrixJumpOption[] {
  const terminalOptions: MatrixJumpOption[] = [];

  // Adjacent chicken cells, per `Cell.getJumpsCells`
  const adjacentChickens = getConnectedPoints(snap, x, y, false).filter(
    p => snap.states[idx(p.x, p.y)] === State.CHICKEN,
  );

  for (const mid of adjacentChickens) {
    const dx = mid.x - x;
    const dy = mid.y - y;
    const landing = { x: mid.x + dx, y: mid.y + dy };

    if (!inBoundsAndValid(snap, landing.x, landing.y)) continue;
    if (!isEmpty(snap, landing.x, landing.y)) continue;

    // Build a child snapshot where the jumped chicken is removed, mirroring deepCloneBoard behavior.
    const childStates = cloneStates(snap.states);
    childStates[idx(mid.x, mid.y)] = State.EMPTY;
    const childSnap: BoardMatrixSnapshot = {
      width: snap.width,
      height: snap.height,
      validMask: snap.validMask,
      states: childStates,
    };

    const nextCaptured = [mid, ...capturedSoFar];
    const chain = getFoxJumpsInternal(childSnap, landing.x, landing.y, nextCaptured, from);

    if (chain.length > 0) {
      // Non-terminal: there are follow-up jumps; only return the leaf sequences.
      terminalOptions.push(...chain);
    } else {
      terminalOptions.push({
        from,
        toBeRemovedChickens: nextCaptured,
        end: landing,
      });
    }
  }

  return terminalOptions;
}

export function getMovesForFox(
  snap: BoardMatrixSnapshot,
  fromX: number,
  fromY: number,
): { moves: MatrixPoint[]; jumps: MatrixJumpOption[] } {
  if (!inBoundsAndValid(snap, fromX, fromY)) return { moves: [], jumps: [] };
  if (snap.states[idx(fromX, fromY)] !== State.FOX) return { moves: [], jumps: [] };

  const connected = getConnectedPoints(snap, fromX, fromY, false);
  const moves = connected.filter(p => isEmpty(snap, p.x, p.y));

  const from = { x: fromX, y: fromY };
  const jumps = getFoxJumpsInternal(snap, fromX, fromY, [], from);

  return { moves, jumps };
}
