import { Routes } from '@angular/router';
import {Play} from './play/play';
import {Explain} from './explain/explain';

export const routes: Routes = [
  {
    path: 'play',
    component: Play
  },
  {
    path: '',
    component: Explain
  }
];
