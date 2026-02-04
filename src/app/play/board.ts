import {computed, Injectable, Signal, signal, WritableSignal} from '@angular/core';

export enum State {
  FOX,
  CHICKEN,
  EMPTY
}
export class Point{
  constructor(public x: number, public y: number) {}
  toString(): string {
    return `${this.x}-${this.y}`;
  }
}

export interface JumpOption {
  good: boolean;
  toBeRemovedChickens: Point[];
  from: Point;
  end: Point;
}

function deepCloneBoard(board: Map<String, Cell>): Map<String, Cell> {
  return new Map(
    Array.from(board.entries(), ([k, cell]) => {
      const pointCopy = new Point(cell.point.x, cell.point.y);
      const stateCopy = signal(cell.getState()()); // copies current signal value
      const cellCopy = new Cell(pointCopy, stateCopy);
      return [k, cellCopy] as [String, Cell];
    })
  );
}

export class Cell {
  constructor(public point: Point, private state: WritableSignal<State> = signal(State.EMPTY)) {
  }

  getConnectedCells(board: Map<String, Cell>, onlyChicken:boolean): Point[]{
    let points = [];
    let x = this.point.x;
    let y = this.point.y;
    points.push(new Point(x-1, y));
    points.push(new Point(x+1, y));
    points.push(new Point(x, y-1));
    if(!onlyChicken) {
      points.push(new Point(x, y+1));
    }
    if(((x%2 == 0 && y%2 == 0) || (x%2 != 0 && y%2 != 0)) && !onlyChicken) {
      points.push(new Point(x + 1, y + 1));
      points.push(new Point(x - 1, y + 1));
      points.push(new Point(x + 1, y - 1));
      points.push(new Point(x - 1, y - 1));
    }
    return points.filter(value => board.has(value.toString()))
  }

  getJumpsCells(board: Map<String, Cell>, toBeRemovedChickens: Point[], from: Point|undefined = undefined): JumpOption[]{
    const options: JumpOption[] = [];
    let points = this.getConnectedCells(board, false)
      .filter(value => board.get(value.toString())!.getState()() === State.CHICKEN)
    for(let connectedCell of points) {
      let deltaX = connectedCell.x - this.point.x;
      let deltaY = connectedCell.y - this.point.y;
      let jumpPoint = new Point(connectedCell.x + deltaX, connectedCell.y + deltaY);
      if(board.has(jumpPoint.toString()) && board.get(jumpPoint.toString())!.getState()() === State.EMPTY) {
        points.push(jumpPoint);
        let clonedBoard = deepCloneBoard(board);
        clonedBoard.get(connectedCell.toString())!.getWritableState().set(State.EMPTY)
        let jumpsCells = clonedBoard.get(jumpPoint.toString())!.getJumpsCells(clonedBoard, [connectedCell], from || this.point);
        if(jumpsCells.length > 0) {
          options.push({
            from: from || this.point,
            good: false,
            toBeRemovedChickens: [connectedCell, ...toBeRemovedChickens],
            end: jumpPoint,
          })
          options.push(...jumpsCells)
        } else {
          options.push({
            from: from || this.point,
            good: true,
            toBeRemovedChickens: [connectedCell, ...toBeRemovedChickens],
            end: jumpPoint,
          })
        }
      }
    }
    return options;
  }

  public getState():Signal<State> {
    return this.state.asReadonly();
  }
  public getWritableState():WritableSignal<State> {
    return this.state;
  }
}

export enum Player {
  CHICKEN,
  FOX
}

export interface MoveAttemptResult {
  outcome: 'moved' | 'jumped' | 'punished' | 'ignored';
  /** Optional message for the UI (e.g. toast). */
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class Board {

  private board: Map<String, Cell> = new Map();
  public playersTurn = signal(Player.CHICKEN)
  public chickens
  public foxes
  public chickensInStall
  public winingReason = signal<string|undefined>(undefined)

  constructor() {
    for (let x = 0; x < 7; x++) {
      for (let y = 0; y < 7; y++) {
        if(x<= 1 || x>= 5){
          if(y<= 1 || y >= 5){
            continue;
          }
        }
        let point = new Point(x,y);
        let state = this.startStateFor(point)
        let stateSignal = signal(state);
        this.board.set(point.toString(), new Cell(point, stateSignal));
      }
    }
    this.chickens = computed(() => {
      let chickenCount = 0;
      for(let cell of this.board.values()) {
        if(cell.getState()()== State.CHICKEN) chickenCount++;
      }
      return chickenCount;
    })
    this.foxes = computed(() => {
      let foxCount = 0;
      for(let cell of this.board.values()) {
        if(cell.getState()()== State.FOX) foxCount++;
      }
      return foxCount;
    })
    this.chickensInStall = computed(() => {
      let chickenCount = 0;
      for(let cell of this.board.values()) {
        if(cell.getState()() == State.CHICKEN
          && (cell.point.y <= 1 || (cell.point.y ==2 && cell.point.x >= 2 && cell.point.x <= 4))){
          chickenCount++;
        }
      }
      return chickenCount;
    })
  }

  /**
   * Resets the game back to the initial setup.
   * Keeps the same board instance so all consumers keep their references/signals.
   */
  reset() {
    for (const cell of this.board.values()) {
      cell.getWritableState().set(this.startStateFor(cell.point));
    }

    this.playersTurn.set(Player.CHICKEN);
    this.winingReason.set(undefined);
  }

  public stateFor(x:number, y:number):Signal<State> {
    return this.board.get(new Point(x, y).toString())!.getState()
  }

  private startStateFor(point: Point): State {
    if(point.y >= 3) return State.CHICKEN
    if(point.y == 2 && (point.x == 2 || point.x == 4)) return State.FOX;
    return State.EMPTY;
  }

  getMoves(point:Point) {
    let connectedCells = this.board.get(point.toString())!.getConnectedCells(this.board, this.playersTurn() == Player.CHICKEN);
    return connectedCells.filter(value => this.board.get(value.toString())!.getState()() === State.EMPTY)
  }

  getJumps(point: Point) {
    return this.board.get(point.toString())!.getJumpsCells(this.board, [], undefined);
  }

  moveTo(selectedPiece: Point | undefined, to:Point) {
    if (!selectedPiece) {
      return;
    }
    this.board.get(selectedPiece.toString())?.getWritableState().set(State.EMPTY);
    this.board.get(to.toString())?.getWritableState().set(
      this.playersTurn() == Player.CHICKEN ? State.CHICKEN : State.FOX
    );
    this.changePlayer();
    if (this.chickensInStall() >= 9) {
      this.winingReason.set("All chickens are in the stall! Chickens win!");
    }
  }

  private changePlayer() {
    this.playersTurn.set(
      this.playersTurn() == Player.CHICKEN ? Player.FOX : Player.CHICKEN
    );
  }

  jumpTo(selectedPiece: Point | undefined, jumpOption: JumpOption) {
    if (!selectedPiece) {
      return;
    }

    jumpOption.toBeRemovedChickens
      .forEach(point => {
        this.board.get(point.toString())?.getWritableState().set(State.EMPTY);
      })
    this.board.get(selectedPiece.toString())!.getWritableState().set(State.EMPTY);
    this.board.get(jumpOption.end.toString())!.getWritableState().set(State.FOX);
    this.changePlayer();

    //Check whether to add back a fox
    if (this.chickens() < 9) {
      this.winingReason.set("Too many chickens died! Chickens lose!");
    }
  }

  punishForJump(selectedPiece: Point | undefined, jumpOption: JumpOption) {
    console.log('Punish for jump:', jumpOption);
    if (!selectedPiece) return;
    this.punish(selectedPiece);
  }

  private punish(point: Point) {
    this.board.get(point.toString())?.getWritableState().set(State.EMPTY);
    this.changePlayer();
    if (this.foxes() < 1) {
      this.winingReason.set("No more foxes! Foxes lose!");
    }
  }

  punishForNotJumping(jumpOptions: JumpOption[]) {
    console.log('Punish for not jumping but moving to:', jumpOptions[0].end);
    this.punish(jumpOptions[0].from);
  }

  getAllJumps(): JumpOption[] {
    if(this.playersTurn() == Player.CHICKEN) {
      return [];
    }
    const jumpEnds: JumpOption[] = [];

    for (const cell of this.board.values()) {
      if (cell.getState()() !== State.FOX) continue;

      const options = cell.getJumpsCells(this.board, []);
      for (const opt of options) {
        jumpEnds.push(opt);
      }
    }

    return jumpEnds;
  }

  getAllMoves(): Point[] {
    if(this.playersTurn() == Player.CHICKEN) {
      return [];
    }
    const moves: Point[] = [];

    for (const cell of this.board.values()) {
      if (cell.getState()() !== State.FOX) continue;

      moves.push(...this.getMoves(cell.point))
    }

    return moves;
  }

  /**
   * Applies the game rules when a player clicks a destination cell.
   *
   * Contract:
   * - `availableMoves/jumps/allJumps` should be the options currently shown by the UI.
   * - Returns a result that the UI can use to show a toast.
   * - Performs side effects on the board (move/jump/punish) exactly like the old Play.clickedMove.
   */
  attemptMove(
    selectedPiece: Point | undefined,
    to:Point,
    availableMoves: Point[],
    availableJumps: JumpOption[],
    allJumps: JumpOption[],
  ): MoveAttemptResult {
    const validMove = availableMoves.find(p => p.x === to.x && p.y === to.y);
    const jumpOption = availableJumps.find(option => option.end.x === to.x && option.end.y === to.y);

    if (validMove && allJumps.length === 0) {
      this.moveTo(selectedPiece, to);
      return { outcome: 'moved' };
    }

    if (validMove && allJumps.length !== 0) {
      this.punishForNotJumping(allJumps);
      return {
        outcome: 'punished',
        message: 'Nice try — jumping is mandatory when available.',
      };
    }

    if (jumpOption && jumpOption.good) {
      this.jumpTo(selectedPiece, jumpOption);
      return { outcome: 'jumped' };
    }

    if (jumpOption && !jumpOption.good) {
      this.punishForJump(selectedPiece, jumpOption);
      return {
        outcome: 'punished',
        message: 'You must keep jumping until the move is finished.',
      };
    }

    return { outcome: 'ignored' };
  }

  /**
   * TEST-ONLY: set a cell's state directly.
   * This makes it possible to create deterministic board setups in unit tests.
   */
  /* @__TEST_ONLY__ */
  _setStateForTest(x: number, y: number, state: State) {
    const key = new Point(x, y).toString();
    const cell = this.board.get(key);
    if (!cell) return;
    cell.getWritableState().set(state);
  }
}
