import { BoardMatrixService } from './board-matrix.service';
import { Board, Player, Point, State } from '../board';

type WritableSignalLike<T> = { set(v: T): void };

function trySet(board: Board, x: number, y: number, state: State) {
  try {
    // Board.stateFor returns a read-only Signal; we must reach into the internal board map in tests.
    const cell = (board as any).board?.get(new Point(x, y).toString());
    const ws = cell?.getWritableState?.() as WritableSignalLike<State> | undefined;
    ws?.set(state);
  } catch {
    // ignore invalid cells
  }
}

function clearBoard(board: Board) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      trySet(board, x, y, State.EMPTY);
    }
  }
}

function placeFillersNineChickensIncluding(board: Board, required: Point[]) {
  for (const p of required) trySet(board, p.x, p.y, State.CHICKEN);

  const filler: Point[] = [
    new Point(2, 5), new Point(3, 5), new Point(4, 5),
    new Point(2, 4), new Point(3, 4), new Point(4, 4),
    new Point(2, 3), new Point(4, 3),
    new Point(3, 6), // valid because x=3, y=6
  ];

  for (const p of filler) {
    trySet(board, p.x, p.y, State.CHICKEN);
  }
}

describe('BoardMatrixService.calculateNextMove', () => {
  it('fox always jumps if any jump exists (mandatory jump rule)', () => {
    const board = new Board();
    clearBoard(board);

    // fox at (3,3)
    trySet(board, 3, 3, State.FOX);

    // chicken adjacent at (3,2) with landing (3,1) empty
    trySet(board, 3, 2, State.CHICKEN);
    trySet(board, 3, 1, State.EMPTY);

    // Ensure we still have >= 9 chickens alive
    placeFillersNineChickensIncluding(board, [new Point(3, 2)]);

    const svc = new BoardMatrixService();
    const move = svc.calculateNextMove(board, 2, Player.FOX);

    expect(move.from).toEqual(new Point(3, 3));
    expect(move.to).toEqual(new Point(3, 1));
  });

  it('chickens move into the stall if possible', () => {
    const board = new Board();
    clearBoard(board);

    // Chicken just outside stall at (3,2) can move up into stall (3,1)
    trySet(board, 3, 2, State.CHICKEN);
    trySet(board, 3, 1, State.EMPTY);

    // Keep >=9 chickens alive
    placeFillersNineChickensIncluding(board, [new Point(3, 2)]);

    // Put foxes far away (not interacting)
    trySet(board, 2, 2, State.FOX);
    trySet(board, 4, 2, State.FOX);

    const svc = new BoardMatrixService();
    const move = svc.calculateNextMove(board, 2, Player.CHICKEN);

    expect(move).toEqual({ from: new Point(3, 2), to: new Point(3, 1) });
  });

  it('chickens avoid moves that allow an immediate fox jump', () => {
    const board = new Board();
    clearBoard(board);

    // Fox positioned so that if chicken moves to (3,2), fox can jump over it to (3,1).
    trySet(board, 3, 3, State.FOX);

    // Chicken at (2,2) has two plausible moves: to (3,2) (danger) or to (2,1) (safe)
    trySet(board, 2, 2, State.CHICKEN);

    // landing square for the fox jump must be empty
    trySet(board, 3, 1, State.EMPTY);

    // Ensure >=9 chickens alive
    placeFillersNineChickensIncluding(board, [new Point(2, 2)]);

    // Add second fox somewhere irrelevant
    trySet(board, 4, 2, State.FOX);

    const svc = new BoardMatrixService();
    const move = svc.calculateNextMove(board, 3, Player.CHICKEN);

    expect(move).toEqual({ from: new Point(2, 2), to: new Point(2, 1) });
  });

  it('chickens do not repeat recent board states (avoid immediate backtracking)', () => {
    const board = new Board();
    clearBoard(board);

    // Only one movable chicken at (3,2).
    trySet(board, 3, 2, State.CHICKEN);

    // Block the "stall" move so the only options are left/right.
    trySet(board, 3, 1, State.FOX);

    // Ensure left/right landings are empty.
    trySet(board, 2, 2, State.EMPTY);
    trySet(board, 4, 2, State.EMPTY);

    // Add 8 more chickens that are completely immobile (surrounded by foxes / edges).
    // Placing them at the bottom and surrounding with foxes suffices for this test.
    const blockedChickens: Point[] = [
      new Point(0, 2), new Point(0, 3), new Point(0, 4),
      new Point(6, 2), new Point(6, 3), new Point(6, 4),
      new Point(3, 6), new Point(2, 6),
    ];
    for (const p of blockedChickens) trySet(board, p.x, p.y, State.CHICKEN);

    // Foxes used purely as blockers (they don't move on chicken turn).
    const blockers: Point[] = [
      new Point(1, 2), new Point(1, 3), new Point(1, 4),
      new Point(5, 2), new Point(5, 3), new Point(5, 4),
      new Point(2, 5), new Point(3, 5), new Point(4, 5),
      new Point(4, 6),
    ];
    for (const p of blockers) trySet(board, p.x, p.y, State.FOX);

    const svc = new BoardMatrixService();

    // Forbidden history = the board state we'd get by moving left to (2,2).
    const snap = svc.createSnapshot(board);
    const leftChild = (svc as any).applyStepMove(snap, { x: 3, y: 2 }, { x: 2, y: 2 });
    const forbiddenFp = Array.from(leftChild.states).join(',');

    const move = svc.calculateNextMove(board, 1, Player.CHICKEN, [forbiddenFp]);

    // With the left-result board forbidden, chicken should choose the other legal step (to the right).
    expect(move).toEqual({ from: new Point(3, 2), to: new Point(4, 2) });
  });
});
