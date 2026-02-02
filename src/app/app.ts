import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {Nav} from './nav/nav';
import { Toast } from './shared/toast/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Nav, Toast],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
}
