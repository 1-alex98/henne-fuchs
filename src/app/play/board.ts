import {computed, Injectable, Signal, signal, WritableSignal} from '@angular/core';
import {EMPTY} from 'rxjs';
import {Play} from './play';

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

export class Cell {
  constructor(public point: Point, private state: WritableSignal<State> = signal(State.EMPTY)) {
  }

  getConnectedEmptyCells(board: Map<String, Cell>, onlyChicken:boolean): Point[]{
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

  getJumpsCells(board: Map<String, Cell>): Point[]{
    let points = this.getConnectedEmptyCells(board, false)
      .filter(value => board.get(value.toString())!.getState()() === State.CHICKEN)
    for(let connectedCell of points) {
      let deltaX = connectedCell.x - this.point.x;
      let deltaY = connectedCell.y - this.point.y;
      let jumpPoint = new Point(connectedCell.x + deltaX, connectedCell.y + deltaY);
      if(board.has(jumpPoint.toString()) && board.get(jumpPoint.toString())!.getState()() === State.EMPTY) {
        points.push(jumpPoint);
      }
    }
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

  public stateFor(x:number, y:number):Signal<State> {
    return this.board.get(new Point(x, y).toString())!.getState()
  }

  private startStateFor(point: Point): State {
    if(point.y >= 3) return State.CHICKEN
    if(point.y == 2 && (point.x == 2 || point.x == 4)) return State.FOX;
    return State.EMPTY;
  }

  getMoves(x: number, y: number) {
    let point = new Point(x,y);
    this.selectedPiece.set(point)
    let connectedCells = this.board.get(point.toString())!.getConnectedEmptyCells(this.board, this.playersTurn() == Player.CHICKEN);
    return connectedCells.filter(value => this.board.get(value.toString())!.getState()() === State.EMPTY)
  }

  getJumps(x: number, y: number) {
    let point = new Point(x,y);
    this.selectedPiece.set(point)
    let connectedCells = this.board.get(point.toString())!.getConnectedEmptyCells(this.board, this.playersTurn() == Player.CHICKEN);
    return connectedCells.filter(value => this.board.get(value.toString())!.getState()() === State.EMPTY)
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
    this.selectedPiece.set(undefined);
    this.playersTurn.set(
      this.playersTurn() == Player.CHICKEN ? Player.FOX : Player.CHICKEN
    );
    if (this.chickensInStall() >= 9) {
      this.winingReason.set("All chickens are in the stall! Chickens win!");
    }
  }

  jumpTo(x: number, y: number) {
    let point = new Point(x, y);

    if (this.chickens() < 9) {
      this.winingReason.set("Too many chickens died! Chickens lose!");
    }
  }
}
