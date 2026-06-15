import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => {
      return import('./pages/cockpit-overview/cockpit-overview.component').then((m) => {
        return m.CockpitOverviewComponent;
      });
    },
  },
];
