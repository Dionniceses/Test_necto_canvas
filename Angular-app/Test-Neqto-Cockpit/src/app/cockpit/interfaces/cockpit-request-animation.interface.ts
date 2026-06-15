export interface CockpitAnimationEndpoints {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

export interface CockpitAnimationFrame {
  requestId: string;
  destinationKey: string;
  x: number;
  y: number;
}

export interface CockpitAnimationTickResult {
  frames: CockpitAnimationFrame[];
  completedRequestIds: string[];
}

export interface CockpitRequestAnimationContext {
  destinationKey?: string;
  startedAtMs: number;
}

export interface CockpitRequestAnimation {
  requestId: string;
  destinationKey: string;
  originTimestampMs: number;
  durationMs: number;
  hasFinalTtfb: boolean;
  currentProgress: number;
}
