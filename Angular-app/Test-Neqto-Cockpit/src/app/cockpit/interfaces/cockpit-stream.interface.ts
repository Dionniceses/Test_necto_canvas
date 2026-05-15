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

export interface CockpitStreamWorkerIngestNdjsonLineMessage {
  type: 'ingest-ndjson-line';
  line: string;
}

export interface CockpitStreamWorkerStartNdjsonMessage {
  type: 'start-ndjson';
  url: string;
  headers?: Record<string, string>;
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

export type CockpitStreamWorkerIncomingMessage =
  | CockpitStreamWorkerIngestNdjsonLineMessage
  | CockpitStreamWorkerStartNdjsonMessage
  | CockpitStreamWorkerStopMessage
  | CockpitStreamWorkerUpdateBudgetStateMessage;

export interface CockpitStreamWorkerEventMessage {
  type: 'event';
  event: CockpitMockStreamEvent;
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

export type CockpitStreamWorkerOutgoingMessage =
  | CockpitStreamWorkerEventMessage
  | CockpitStreamWorkerBatchUpdateMessage
  | CockpitStreamWorkerStatusMessage;
