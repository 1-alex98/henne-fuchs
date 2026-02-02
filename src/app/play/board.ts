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
    if((x%2 == 0 && y%2 == 0) || (x%2 != 0 && y%2 != 0) && !onlyChicken) {
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

@Injectable({
  providedIn: 'root',
})
export class Board {

  private board: Map<String, Cell> = new Map();
  public playersTurn = signal(Player.CHICKEN)
  public selectedPiece = signal<Point|undefined>(undefined)
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
    this.selectedPiece.set(undefined);
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

  setSelectedPiece(point: Point|undefined) {
    this.selectedPiece.set(point)
  }

  getMoves(x: number, y: number) {
    let point = new Point(x,y);
    let connectedCells = this.board.get(point.toString())!.getConnectedCells(this.board, this.playersTurn() == Player.CHICKEN);
    return connectedCells.filter(value => this.board.get(value.toString())!.getState()() === State.EMPTY)
  }

  getJumps(x: number, y: number) {
    let point = new Point(x,y);
    this.selectedPiece.set(point)
    return this.board.get(point.toString())!.getJumpsCells(this.board, [], undefined);
  }

  moveTo(x: number, y: number) {
    let point = new Point(x, y);
    if(this.selectedPiece() == undefined) {
      return;
    }
    this.board.get((this.selectedPiece() as Point).toString())?.getWritableState().set(State.EMPTY);
    this.board.get(point.toString())?.getWritableState().set(
      this.playersTurn() == Player.CHICKEN ? State.CHICKEN : State.FOX
    );
    this.changePlayer();
    if (this.chickensInStall() >= 9) {
      this.winingReason.set("All chickens are in the stall! Chickens win!");
    }
  }

  private changePlayer() {
    this.selectedPiece.set(undefined);
    this.playersTurn.set(
      this.playersTurn() == Player.CHICKEN ? Player.FOX : Player.CHICKEN
    );
  }

  jumpTo(jumpOption: JumpOption) {
    jumpOption.toBeRemovedChickens
      .forEach(point => {
        this.board.get(point.toString())?.getWritableState().set(State.EMPTY);
      })
    this.board.get((this.selectedPiece() as Point).toString())!.getWritableState().set(State.EMPTY);
    this.board.get(jumpOption.end.toString())!.getWritableState().set(State.FOX);
    this.changePlayer();

    //Check whether to add back a fox
    if (this.chickens() < 9) {
      this.winingReason.set("Too many chickens died! Chickens lose!");
    }
  }

  punishForJump(jumpOption: JumpOption) {
    console.log('Punish for jump:', jumpOption);
    this.punish(this.selectedPiece()!);
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

      moves.push(...this.getMoves(cell.point.x, cell.point.y))
    }

    return moves;
  }
}
