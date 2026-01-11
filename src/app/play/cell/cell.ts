import {Component, computed, EventEmitter, input, Output} from '@angular/core';
import {Player, Point, State} from '../board';

@Component({
  selector: '[app-cell]',
  imports: [],
  templateUrl: './cell.html',
  styleUrl: './cell.css',
})
export class Cell {
  x = input.required<number>()
  playersTurn = input.required<Player>()
  selectedPiece = input.required<Point|undefined>()
  selectable = computed(() =>
    (this.playersTurn() == Player.FOX && this.state() == State.FOX) || (this.playersTurn() == Player.CHICKEN && this.state() == State.CHICKEN)
  );
  selected = computed(() => this.selectedPiece()?.x == this.x() && this.selectedPiece()?.y == this.y())
  y = input.required<number>()
  state = input.required<State>()
  id = computed(() => `${this.x().toString()} ${this.y().toString()}`)
  xCoordinate = computed(() => this.x() * 50  + 100 - 15)
  yCoordinate = computed(() => this.y() * 50  + 100 - 15)
  @Output() imageClicked = new EventEmitter<Point>();

  emitClick(event: MouseEvent) {
    this.imageClicked.emit(new Point(this.x(), this.y()));
  }

  protected readonly State = State;
}
