import { Component } from '@angular/core';
import { PixiCanvasComponent } from '@features/cockpit/components/pixi-canvas/pixi-canvas.component';

@Component({
  selector: 'app-cockpit-overview',
  imports: [PixiCanvasComponent],
  templateUrl: './cockpit-overview.component.html',
  styleUrl: './cockpit-overview.component.scss',
})
export class CockpitOverviewComponent {}
