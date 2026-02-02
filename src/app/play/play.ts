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
  moves = signal<Point[]>([])
  jumps = signal<JumpOption[]>([])
  allJumps = signal<JumpOption[]>([])
  allMoves = signal<Point[]>([])

  public stateFor(x:number, y:number):Signal<State> {
    return this.boardService.stateFor(x, y);
  }

  protected clickedPiece(p: Point) {
    this.boardService.setSelectedPiece(p)
    this.moves.set(this.boardService.getMoves(p.x, p.y))
    this.jumps.set(this.boardService.getJumps(p.x, p.y))
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
    let validMove = this.moves().find(p => p.x == x && p.y == y);
    let jumpOption = this.jumps().find(option => option.end.x == x && option.end.y == y);
    if(validMove && this.allJumps().length == 0) {
      this.boardService.moveTo(x, y)
    } else if(validMove && this.allJumps().length != 0) {
      this.toast.show('Nice try — jumping is mandatory when available.', { variant: 'warning' })
      this.boardService.punishForNotJumping(this.allJumps())
    }else if(jumpOption && jumpOption.good) {
      this.boardService.jumpTo(jumpOption)
    } else if(jumpOption && !jumpOption.good) {
      this.toast.show('You must keep jumping until the move is finished.', { variant: 'warning' })
      this.boardService.punishForJump(jumpOption)
    } else {
      return
    }
    this.moves.set([])
    this.jumps.set([])
    this.allJumps.set([])
  }

  onPlayAgain() {
    this.boardService.reset();
    this.moves.set([]);
    this.jumps.set([]);
    this.allJumps.set([]);
  }

  protected readonly Player = Player;
}
