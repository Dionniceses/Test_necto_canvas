export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
  rgb: [number, number, number];
  connections: number[];
}

export interface Batch {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startTime: number;
  duration: number;
  rgb: [number, number, number];
  fromIdx: number;
  toIdx: number;
}

export interface ErrorEntry {
  id: number;
  message: string;
  severity: string;
  timestamp: number;
  fromIdx: number;
  toIdx: number;
}

export interface BoxErrors {
  x: number;
  y: number;
  boxIdx: number;
  entries: ErrorEntry[];
}

export interface BoxSelection {
  kind: 'box';
  box: Box;
}

export interface LineSelection {
  kind: 'line';
  from: Box;
  to: Box;
}

export interface BatchSelection {
  kind: 'batch';
  batch: Batch;
  from: Box;
  to: Box;
}

export interface ErrorSelection {
  kind: 'error';
  errors: BoxErrors;
}

export interface EmptySelection {
  kind: 'none';
}

export type Selection =
  | BoxSelection
  | LineSelection
  | BatchSelection
  | ErrorSelection
  | EmptySelection;

export interface HudStats {
  fps: number;
  totalBatches: number;
  visibleBatches: number;
  zoomPercent: number;
  boxCount: number;
  totalErrors: number;
  paused: boolean;
}