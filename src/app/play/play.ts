import {Component, inject, signal, Signal} from '@angular/core';
import {Cell} from './cell/cell';
import {Board, Player, Point, State} from './board';
import {Overlay} from './overlay/overlay';

@Component({
  selector: 'app-play',
  imports: [
    Cell,
    Overlay
  ],
  templateUrl: './play.html',
  styleUrl: './play.css',
})
export class Play {

  boardService = inject(Board)
  moves = signal<Point[]>([])
  jumps = signal<Point[]>([])

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
    let validMove = this.moves().find(p => p.x == x && p.y == y);
    let validJumps = this.jumps().find(p => p.x == x && p.y == y);
    if(validMove) {
      this.boardService.moveTo(x, y)
    } else if(validMove) {
      this.boardService.jumpTo(x, y)
    } else {
      return
    }
    this.moves.set([])
    this.jumps.set([])
  }

  protected readonly Player = Player;
}
