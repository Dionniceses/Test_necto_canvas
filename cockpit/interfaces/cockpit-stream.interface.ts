import type { CockpitDestinationSidebarData } from './cockpit-destination-sidebar.interface';
import type {
  CockpitRangeMeta,
  CockpitSnapshotResult,
  CockpitTimelineCursor,
  CockpitTimelineRange,
} from './cockpit-timeline.interface';

export interface CockpitMockStreamEvent {
  id: string | number;
  ts?: number;
  destination?: string;
  flow?: string;
  flow_execution_id?: string;
  trigger_ua?: string;
  trigger_ip?: string;
  payload_size?: number;
  'ttfb-hint'?: number;
  ttfb_hint?: number;
  ttfb?: number;
  response_size?: number;
  response_code?: number;
  [key: string]: unknown;
}

export const COCKPIT_MOCK_STREAM_PATH = '/mock/cockpit/stream';

export enum CockpitWorkerIncomingMessageType {
  IngestNdjsonLine = 'ingest-ndjson-line',
  StartNdjson = 'start-ndjson',
  Stop = 'stop',
  UpdateBudgetState = 'update-budget-state',
  SubscribeDestination = 'subscribe-destination',
  UnsubscribeDestination = 'unsubscribe-destination',
  GetRequestDetails = 'get-request-details',
  ReleaseRequestDetails = 'release-request-details',
  SyncPlayheadTime = 'sync-playhead-time',
  ResetSession = 'reset-session',
}

export enum CockpitWorkerOutgoingMessageType {
  Event = 'event',
  BatchUpdate = 'BATCH_UPDATE',
  Status = 'status',
  DestinationUpdate = 'destination-update',
  RequestDetails = 'request-details',
  SnapshotEvent = 'snapshot-event',
  SnapshotComplete = 'snapshot-complete',
  RangeMeta = 'range-meta',
}
export type CockpitStreamEventSource = 'live' | 'snapshot';

export interface CockpitStreamedEvent {
  event: CockpitMockStreamEvent;
  source: CockpitStreamEventSource;
  snapshotId?: string;
}

export interface CockpitStreamWorkerIngestNdjsonLineMessage {
  type: 'ingest-ndjson-line';
  line: string;
}

export interface CockpitStreamWorkerStartNdjsonMessage {
  type: 'start-ndjson';
  url: string;
  headers?: Record<string, string>;
}

export interface CockpitStreamWorkerStartSnapshotMessage {
  type: 'start-snapshot';
  snapshotId: string;
  url: string;
  range: CockpitTimelineRange;
  limit?: number;
  cursorBefore?: CockpitTimelineCursor;
  cursorAfter?: CockpitTimelineCursor;
}

export interface CockpitStreamWorkerStopMessage {
  type: 'stop';
}

export interface CockpitStreamWorkerUpdateBudgetStateMessage {
  type: 'update-budget-state';
  state: 'optimal' | 'degraded' | 'critical';
  tickRateMs: number;
  deferHintEvents: boolean;
}

export interface CockpitStreamWorkerSubscribeDestinationMessage {
  type: 'subscribe-destination';
  destinationName: string;
}

export interface CockpitStreamWorkerUnsubscribeDestinationMessage {
  type: 'unsubscribe-destination';
  destinationName: string;
}

export interface CockpitStreamWorkerGetRequestDetailsMessage {
  type: 'get-request-details';
  requestId: string;
}

export interface CockpitStreamWorkerReleaseRequestDetailsMessage {
  type: 'release-request-details';
  requestId: string;
}

export interface CockpitStreamWorkerSyncPlayheadTimeMessage {
  type: CockpitWorkerIncomingMessageType.SyncPlayheadTime;
  playheadTs: number;
  isLiveMode: boolean;
}

export interface CockpitStreamWorkerResetSessionMessage {
  type: CockpitWorkerIncomingMessageType.ResetSession;
  playheadTs: number;
  isLiveMode: boolean;
}

export interface CockpitStreamWorkerIngestSnapshotEventMessage {
  type: 'ingest-snapshot-event';
  event: CockpitMockStreamEvent;
}

export type CockpitStreamWorkerIncomingMessage =
  | CockpitStreamWorkerIngestNdjsonLineMessage
  | CockpitStreamWorkerStartNdjsonMessage
  | CockpitStreamWorkerStartSnapshotMessage
  | CockpitStreamWorkerStopMessage
  | CockpitStreamWorkerUpdateBudgetStateMessage
  | CockpitStreamWorkerSubscribeDestinationMessage
  | CockpitStreamWorkerUnsubscribeDestinationMessage
  | CockpitStreamWorkerGetRequestDetailsMessage
  | CockpitStreamWorkerReleaseRequestDetailsMessage
  | CockpitStreamWorkerSyncPlayheadTimeMessage
  | CockpitStreamWorkerResetSessionMessage
  | CockpitStreamWorkerIngestSnapshotEventMessage;

export interface CockpitStreamWorkerEventMessage {
  type: 'event';
  event: CockpitMockStreamEvent;
}

export interface CockpitStreamWorkerSnapshotEventMessage {
  type: 'snapshot-event';
  snapshotId: string;
  event: CockpitMockStreamEvent;
}

export interface CockpitStreamWorkerSnapshotCompleteMessage {
  type: 'snapshot-complete';
  result: CockpitSnapshotResult;
}

export interface CockpitStreamWorkerRangeMetaMessage {
  type: 'range-meta';
  meta: CockpitRangeMeta;
}

export interface CockpitStreamWorkerBatchUpdateMessage {
  type: 'BATCH_UPDATE';
  data: { event: CockpitMockStreamEvent; ageMs: number }[];
}

export interface CockpitStreamWorkerStatusMessage {
  type: 'status';
  status: 'started' | 'stopped' | 'error';
  detail?: string;
}

export interface CockpitStreamWorkerDestinationUpdateMessage {
  type: 'destination-update';
  destinationName: string;
  data: CockpitDestinationSidebarData;
}

export interface CockpitStreamWorkerRequestDetailsMessage {
  type: 'request-details';
  requestId: string;
  details: CockpitMockStreamEvent | null;
}

export type CockpitStreamWorkerOutgoingMessage =
  | CockpitStreamWorkerEventMessage
  | CockpitStreamWorkerSnapshotEventMessage
  | CockpitStreamWorkerSnapshotCompleteMessage
  | CockpitStreamWorkerRangeMetaMessage
  | CockpitStreamWorkerBatchUpdateMessage
  | CockpitStreamWorkerStatusMessage
  | CockpitStreamWorkerDestinationUpdateMessage
  | CockpitStreamWorkerRequestDetailsMessage;

export interface DestinationRecentRequest {
  requestId: string;
  timestampMs: number;
  responseCode: number | null;
  flow: string | null;
  details: CockpitMockStreamEvent;
}

export interface DestinationMetricContribution {
  destinationKey: string;
  timestampMs: number;
  responseCode: number;
}

export interface DestinationKeyReference {
  destinationKey: string;
  timestampMs: number;
}

export interface DestinationAggregateState {
  destinationName: string;
  processedResponsesLastWindow: number;
  errorResponsesLastWindow: number;
  recentEvents: DestinationRecentRequest[];
  recentErrors: DestinationRecentRequest[];
  dirty: boolean;
}
