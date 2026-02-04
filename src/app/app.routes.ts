import { Routes } from '@angular/router';
import {Play} from './play/play';
import {Explain} from './explain/explain';
import { SelectMode } from './play/select-mode/select-mode';

export const routes: Routes = [
  {
    path: 'play',
    redirectTo: 'play/select',
    pathMatch: 'full',
  },
  {
    path: 'play/select',
    component: SelectMode,
  },
  {
    path: 'play/game',
    component: Play
  },
  {
    path: '',
    component: Explain
  }
];
