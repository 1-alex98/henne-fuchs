import {Component, input, output} from '@angular/core';

@Component({
  selector: 'app-overlay',
  imports: [],
  templateUrl: './overlay.html',
  styleUrl: './overlay.css',
})
export class Overlay {
  text = input.required<String|undefined>()
  playAgain = output<void>();

  onPlayAgain() {
    this.playAgain.emit();
  }
}
