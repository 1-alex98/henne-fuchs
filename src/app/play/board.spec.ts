import { Board, Player, Point, State } from './board';

describe('Board.attemptMove', () => {
  it('moves when a normal move is clicked and no jumps are available', () => {
    const board = new Board();

    // Create a simple chicken move: chicken at (2,3) -> (2,2)
    // (2,2) normally has a fox, so clear it for this test.
    board._setStateForTest(2, 2, State.EMPTY);
    board.playersTurn.set(Player.CHICKEN);

    const selected = new Point(2, 3);

    const moves = board.getMoves(selected);
    let move = new Point(2, 2);
    expect(moves).toContainEqual(move);

    const result = board.attemptMove(selected, move, moves, [], []);

    expect(result.outcome).toBe('moved');
    expect(board.playersTurn()).toBe(Player.FOX);
    expect(board.stateFor(2, 2)()).toBe(State.CHICKEN);
    expect(board.stateFor(2, 3)()).toBe(State.EMPTY);
  });

  it('punishes when a fox clicks a normal move while any jump exists (mandatory jump)', () => {
    const board = new Board();

    // Setup a guaranteed jump for fox at (2,2): chicken at (3,3), landing (4,4) empty.
    board._setStateForTest(4, 4, State.EMPTY);

    // Also ensure the other fox at (4,2) has a normal move: make (3,2) empty.
    board._setStateForTest(3, 2, State.EMPTY);

    board.playersTurn.set(Player.FOX);

    const allJumps = board.getAllJumps();
    expect(allJumps.length).toBeGreaterThan(0);

    // Attempt a normal (non-jump) move with the other fox.
    const selected = new Point(4, 2);
    const moves = board.getMoves(selected);
    let move = new Point(3, 2);
    expect(moves).toContainEqual(move);

    const result = board.attemptMove(selected, move, moves, [], allJumps);

    expect(result.outcome).toBe('punished');
    expect(result.message).toContain('jumping is mandatory');
  });
});
