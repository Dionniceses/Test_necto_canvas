import { Injectable } from '@angular/core';

export interface Box {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

@Injectable({
  providedIn: 'root'
})
export class BoxLayoutService {
  private readonly BOX_WIDTH = 100;
  private readonly BOX_HEIGHT = 80;
  private readonly MARGIN = 150; // Distance from center

  calculateBoxPositions(canvasWidth: number, canvasHeight: number): Box[] {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    return [
      {
        label: 'Neqto',
        x: centerX - this.BOX_WIDTH / 2,
        y: centerY - this.BOX_HEIGHT / 2,
        width: this.BOX_WIDTH,
        height: this.BOX_HEIGHT
      },
      {
        label: 'bol.com',
        x: centerX - this.MARGIN - this.BOX_WIDTH / 2,
        y: centerY - this.BOX_HEIGHT / 2,
        width: this.BOX_WIDTH,
        height: this.BOX_HEIGHT
      },
      {
        label: 'google.com',
        x: centerX + this.MARGIN - this.BOX_WIDTH / 2,
        y: centerY - this.BOX_HEIGHT / 2,
        width: this.BOX_WIDTH,
        height: this.BOX_HEIGHT
      }
    ];
  }
}
