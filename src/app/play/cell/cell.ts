import {Component, computed, EventEmitter, input, Output} from '@angular/core';
import {Player, Point, State} from '../board';

@Component({
  selector: '[app-cell]',
  imports: [],
  templateUrl: './cell.html',
  styleUrl: './cell.css',
})
export class Cell {
  cellX = input.required<number>()
  cellY = input.required<number>()
  playersTurn = input.required<Player>()
  selectedPiece = input.required<Point|undefined>()

  selectable = computed(() =>
    (this.playersTurn() == Player.FOX && this.state() == State.FOX) || (this.playersTurn() == Player.CHICKEN && this.state() == State.CHICKEN)
  );
  selected = computed(() => this.selectedPiece()?.x == this.cellX() && this.selectedPiece()?.y == this.cellY())

  state = input.required<State>()
  id = computed(() => `${this.cellX().toString()} ${this.cellY().toString()}`)

  // Render relative to the parent <g> transform (piece-sprite). The parent is responsible for positioning.
  xCoordinate = computed(() => 0)
  yCoordinate = computed(() => 0)

  @Output() imageClicked = new EventEmitter<Point>();

  emitClick() {
    if(!this.selectable()) {
      return;
    }
    this.imageClicked.emit(new Point(this.cellX(), this.cellY()));
  }

  protected readonly State = State;
}
