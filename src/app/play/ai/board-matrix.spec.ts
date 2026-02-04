import { Board, State } from '../board';
import { BoardMatrixService } from './board-matrix.service';
import {
  createEmptySnapshot,
  evaluate,
  getMovesForChicken,
  getMovesForFox,
  idx,
  isValidCell,
} from './board-matrix';

describe('BoardMatrixService.fromBoard', () => {
  it('creates a 7x7 snapshot with correct geometry mask', () => {
    const board = new Board();
    const svc = new BoardMatrixService();

    const snap = svc.createSnapshot(board);

    expect(snap.width).toBe(7);
    expect(snap.height).toBe(7);
    expect(snap.validMask.length).toBe(49);
    expect(snap.states.length).toBe(49);

    // Corners should be invalid per Board constructor rule
    expect(isValidCell(0, 0)).toBe(false);
    expect(snap.validMask[idx(0, 0)]).toBe(0);

    expect(isValidCell(6, 6)).toBe(false);
    expect(snap.validMask[idx(6, 6)]).toBe(0);

    // A known central cell should be valid
    expect(isValidCell(3, 3)).toBe(true);
    expect(snap.validMask[idx(3, 3)]).toBe(1);
  });

  it('copies initial piece states from Board', () => {
    const board = new Board();
    const svc = new BoardMatrixService();

    const snap = svc.createSnapshot(board);

    // From Board.startStateFor:
    // - y>=3 => chicken
    // - y==2 and x==2 or 4 => fox
    expect(snap.states[idx(2, 3)]).toBe(State.CHICKEN);
    expect(snap.states[idx(4, 3)]).toBe(State.CHICKEN);

    expect(snap.states[idx(2, 2)]).toBe(State.FOX);
    expect(snap.states[idx(4, 2)]).toBe(State.FOX);

    expect(snap.states[idx(3, 0)]).toBe(State.EMPTY);
  });
});

describe('board-matrix move generation', () => {
  it('getMovesForChicken returns empty adjacent (left/right/up) squares', () => {
    const snap = createEmptySnapshot();
    snap.states[idx(3, 3)] = State.CHICKEN;

    const moves = getMovesForChicken(snap, 3, 3);

    // left/right/up from (3,3) are all valid and empty on an empty snapshot
    expect(moves).toEqual(
      expect.arrayContaining([
        { x: 2, y: 3 },
        { x: 4, y: 3 },
        { x: 3, y: 2 },
      ]),
    );

    // chickens can't move down
    expect(moves).not.toEqual(expect.arrayContaining([{ x: 3, y: 4 }]));
  });

  it('getMovesForFox returns step moves + jump options', () => {
    const snap = createEmptySnapshot();

    // Place fox at (3,3), chicken at (3,2), landing at (3,1) empty.
    snap.states[idx(3, 3)] = State.FOX;
    snap.states[idx(3, 2)] = State.CHICKEN;

    const { moves, jumps } = getMovesForFox(snap, 3, 3);

    // Step move: adjacent empty cell (2,3) should be available.
    expect(moves).toEqual(expect.arrayContaining([{ x: 2, y: 3 }]));

    // Jump over chicken at (3,2) to (3,1)
    expect(jumps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: { x: 3, y: 3 },
          end: { x: 3, y: 1 },
        }),
      ]),
    );

    const jump = jumps.find(j => j.end.x === 3 && j.end.y === 1);
    expect(jump?.toBeRemovedChickens).toEqual(expect.arrayContaining([{ x: 3, y: 2 }]));
  });
});

describe('board-matrix evaluation', () => {

  it('evaluate scores +2 per alive chicken and +3 per chicken in the stall', () => {
    const snap = createEmptySnapshot();

    // 3 alive total; all of them in stall
    snap.states[idx(3, 0)] = State.CHICKEN; // stall
    snap.states[idx(3, 1)] = State.CHICKEN; // stall
    snap.states[idx(3, 2)] = State.CHICKEN; // stall

    // <9 chickens alive => immediate loss marker
    expect(evaluate(snap)).toBe(0);

    snap.states[idx(2, 0)] = State.CHICKEN; // stall
    snap.states[idx(2, 1)] = State.CHICKEN; // stall
    snap.states[idx(2, 2)] = State.CHICKEN; // stall

    snap.states[idx(2, 3)] = State.CHICKEN; // not stall
    snap.states[idx(2, 4)] = State.CHICKEN; // not stall
    snap.states[idx(2, 5)] = State.CHICKEN; // not stall

    // In-stall cells here are (3,0)(3,1)(3,2)(2,0)(2,1)(2,2) => 6
    expect(evaluate(snap)).toBe(2 * 9 + 3 * 6); // 9 alive
  });
});
