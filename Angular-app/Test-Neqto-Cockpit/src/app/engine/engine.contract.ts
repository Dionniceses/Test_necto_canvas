import { HudStats, Selection } from './engine.types';

export interface EngineInitElements {
  wrapper: HTMLElement;
  canvas: HTMLCanvasElement;
}

export interface EngineCounts {
  batches: number;
  boxes: number;
}

export interface EngineEvents {
  onSelectionChange?: (selection: Selection) => void;
  onHudUpdate?: (stats: HudStats) => void;
  onZoomChange?: (zoomPercent: number) => void;
  onRendererError?: (error: Error) => void;
}

export interface EngineInitOptions {
  initialCounts?: Partial<EngineCounts>;
  events?: EngineEvents;
  uncapFps?: boolean;
}

export interface EngineApi {
  init(elements: EngineInitElements, options?: EngineInitOptions): void;
  start(): void;
  stop(): void;
  resize(): void;
  setPaused(value: boolean): void;
  setCounts(counts: EngineCounts): void;
  clearSelection(): void;
  dispose(): void;
}