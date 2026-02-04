import {Component, inject, signal, Signal} from '@angular/core';
import {Cell} from './cell/cell';
import {Board, JumpOption, Player, Point, State} from './board';
import {Overlay} from './overlay/overlay';
import { ToastService } from '../shared/toast/toast.service';

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
  private readonly toast = inject(ToastService)

  selectedPiece = signal<Point | undefined>(undefined)
  moves = signal<Point[]>([])
  jumps = signal<JumpOption[]>([])
  allJumps = signal<JumpOption[]>([])
  allMoves = signal<Point[]>([])

  public stateFor(x:number, y:number):Signal<State> {
    return this.boardService.stateFor(x, y);
  }

  protected clickedPiece(p: Point) {
    this.selectedPiece.set(p)
    this.moves.set(this.boardService.getMoves(p))
    this.jumps.set(this.boardService.getJumps(p))
    this.allJumps.set(this.boardService.getAllJumps())
    this.allMoves.set(this.boardService.getAllMoves())
    if(!this.allMoves() && !this.allJumps){
      this.boardService.winingReason.set("No moves for foxes! Chickens win!")
    }
  }

  protected styleClassFor(x: number, y: number) {
    if(this.jumps().find(option => option.end.x == x && option.end.y == y) != undefined) {
      return "jumpable";
    }
    return this.moves().find(p => p.x == x && p.y == y) != undefined? "clickable" : "" ;
  }

  protected clickedMove(x: number, y: number) {
    const result = this.boardService.attemptMove(this.selectedPiece(), new Point(x, y), this.moves(), this.jumps(), this.allJumps());

    if (result.message) {
      this.toast.show(result.message, { variant: 'warning' });
    }

    if (result.outcome === 'ignored') {
      return;
    }

    this.selectedPiece.set(undefined)
    this.moves.set([])
    this.jumps.set([])
    this.allJumps.set([])
  }

  onPlayAgain() {
    this.boardService.reset();
    this.selectedPiece.set(undefined)
    this.moves.set([]);
    this.jumps.set([]);
    this.allJumps.set([]);
  }

  protected readonly Player = Player;
}
