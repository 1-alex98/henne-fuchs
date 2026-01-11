import {Component, inject, signal, Signal} from '@angular/core';
import {Cell} from './cell/cell';
import {Board, Point, State} from './board';

@Component({
  selector: 'app-play',
  imports: [
    Cell
  ],
  templateUrl: './play.html',
  styleUrl: './play.css',
})
export class Play {

  boardService = inject(Board)
  moves = signal<Point[]>([])

  public stateFor(x:number, y:number):Signal<State> {
    return this.boardService.stateFor(x, y);
  }

  protected clickedPiece(p: Point) {
    this.moves.set(this.boardService.getMoves(p.x, p.y))
  }

  protected styleClassFor(x: number, y: number) {
    return this.moves().find(p => p.x == x && p.y == y) != undefined? "clickable" : "" ;
  }

  protected clickedMove(x: number, y: number) {

  }
}
