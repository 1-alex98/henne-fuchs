import {Injectable, Signal, signal, WritableSignal} from '@angular/core';
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

  public getState():Signal<State> {
    return this.state.asReadonly();
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
        this.board.set(point.toString(), new Cell(point, signal(state)));
      }
    }
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
    let connectedCells = this.board.get(point.toString())!.getConnectedCells(this.board, this.playersTurn() == Player.CHICKEN);
    return connectedCells.filter(value => this.board.get(value.toString())!.getState()() === State.EMPTY)
  }
}
