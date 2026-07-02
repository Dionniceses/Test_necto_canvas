import type { Graphics, BitmapText } from 'pixi.js';

export interface CockpitCanvasNode {
  box: Graphics;
  label: BitmapText;
  width: number;
  height: number;
  nodeColor?: number;
}

export interface CockpitCanvasNodePosition {
  x: number;
  y: number;
}

export interface CockpitCanvasNodePositionResult {
  position: CockpitCanvasNodePosition;
  isNew: boolean;
}
