import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => {
      return import('./pages/cockpit/cockpit.page.component').then((m) => {
        return m.CockpitPageComponent;
      });
    },
  },
];
