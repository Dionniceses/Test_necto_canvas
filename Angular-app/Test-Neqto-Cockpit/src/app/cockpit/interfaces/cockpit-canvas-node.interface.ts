import type { Graphics, Text } from 'pixi.js';

export interface CockpitCanvasNode {
  box: Graphics;
  label: Text;
  width: number;
  height: number;
}

export interface CockpitCanvasNodePosition {
  x: number;
  y: number;
}

export interface CockpitCanvasNodePositionResult {
  position: CockpitCanvasNodePosition;
  isNew: boolean;
}
