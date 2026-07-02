import type { CockpitMockStreamEvent, CockpitStreamEventSource } from './cockpit-stream.interface';

export interface CockpitTimelineRange {
  fromTs: number;
  toTs: number;
}

export type CockpitTimelineMode = 'live' | 'paused' | 'scrubbing' | 'replay';

export interface CockpitTimelineCursor {
  ts: number;
  id?: string | number;
}

export type CockpitSnapshotDirection = 'before' | 'after' | 'range';

export interface CockpitPendingSnapshot {
  key: string;
  direction: CockpitSnapshotDirection;
  fromTs: number;
  toTs: number;
  limit: number;
  requestedAtTs: number;
  cursor?: CockpitTimelineCursor;
}

export interface CockpitRangeMeta {
  dateKey: string;
  serverNowTs: number;
  availableRange: CockpitTimelineRange;
  downloadedRanges?: CockpitTimelineRange[];
}

export interface CockpitSnapshotResult {
  snapshotId: string;
  range: CockpitTimelineRange;
  count: number;
  truncated: boolean;
  cursorBefore?: CockpitTimelineCursor;
  cursorAfter?: CockpitTimelineCursor;
  error?: boolean;
}

export interface CockpitTimelineVisualEvent {
  event: CockpitMockStreamEvent;
  source: CockpitStreamEventSource;
  eventTs: number;
  animationEvent: CockpitMockStreamEvent;
  animationTs: number;
  visualDurationMultiplier: number;
}

export interface CockpitCachedSnapshotEvent {
  requestId: string;
  snapshotId: string;
  event: CockpitMockStreamEvent;
  eventTs: number;
  sequence: number;
}
