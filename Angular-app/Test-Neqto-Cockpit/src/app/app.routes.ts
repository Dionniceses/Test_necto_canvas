import { Routes } from '@angular/router';
import { MenuComponent } from './menu.component';
import { WebGLComponent } from './webgl.component';
import { Canvas2dComponent } from './canvas2d.component';
import { PixiComponent } from './pixi.component';

export const routes: Routes = [
  { path: '', component: MenuComponent },
  { path: 'webgl', component: WebGLComponent },
  { path: 'canvas2d', component: Canvas2dComponent },
  { path: 'pixi', component: PixiComponent },
  {
    path: 'cockpit',
    loadChildren: () => import('./cockpit/routes').then((m) => m.routes),
  },
];
