/// <reference lib="webworker" />

import {
  CockpitDestinationSidebarData,
  CockpitDestinationSidebarListItem,
} from '../interfaces/cockpit-destination-sidebar.interface';
import type {
  CockpitRangeMeta,
  CockpitTimelineCursor,
  CockpitTimelineRange,
} from '../interfaces/cockpit-timeline.interface';
import {
  CockpitMockStreamEvent,
  CockpitStreamEventSource,
  CockpitStreamWorkerIncomingMessage,
  CockpitStreamWorkerOutgoingMessage,
  CockpitWorkerIncomingMessageType,
  DestinationRecentRequest,
  DestinationAggregateState,
  DestinationKeyReference,
} from '../interfaces/cockpit-stream.interface';

let streamAbortController: AbortController | null = null;

const eventStore = new Map<string, CockpitMockStreamEvent>();
const sendBuffer = new Set<string>();
const sendBufferTimestamps = new Map<string, number>();
let currentTickRate = 1_000;

export const MAX_STORED_EVENTS = 200_000;
let deferHintEvents = false;
let tickIntervalId: ReturnType<typeof setInterval> | null = null;

let isLiveMode = true;
let playheadTs = Date.now();
let sessionStartTs = Date.now();

const DESTINATION_MAX_EVENT_ITEMS = 50;
const DESTINATION_MAX_ERROR_ITEMS = 20;

const destinationStateByKey = new Map<string, DestinationAggregateState>();
const requestDestinationKeyById = new Map<string, DestinationKeyReference>();
const processedRequestIds = new Set<string>();
const heldRequestDetailsById = new Map<string, CockpitMockStreamEvent>();
const destinationSubscriptions = new Set<string>();

const isWorkerContext = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

if (isWorkerContext) {
  startTickLoop();

  addEventListener('message', ({ data }: MessageEvent<CockpitStreamWorkerIncomingMessage>) => {
    if (!data) {
      return;
    }

    switch (data.type) {
      case CockpitWorkerIncomingMessageType.IngestNdjsonLine:
        emitFromNdjsonLine(data.line);
        break;
      case CockpitWorkerIncomingMessageType.StartNdjson:
        void startNdjsonStream(data.url, data.headers);
        break;
      case 'start-snapshot':
        void startSnapshot(data.snapshotId, data.url, data.range, data.limit, data.cursorBefore, data.cursorAfter);
        break;
      case CockpitWorkerIncomingMessageType.Stop:
        stopNdjsonStream();
        postStatus('stopped');
        break;
      case CockpitWorkerIncomingMessageType.UpdateBudgetState:
        applyBudgetState(data.tickRateMs, data.deferHintEvents);
        break;
      case CockpitWorkerIncomingMessageType.SubscribeDestination:
        subscribeDestination(data.destinationName);
        break;
      case CockpitWorkerIncomingMessageType.UnsubscribeDestination:
        unsubscribeDestination(data.destinationName);
        break;
      case CockpitWorkerIncomingMessageType.GetRequestDetails:
        postRequestDetails(data.requestId);
        break;
      case CockpitWorkerIncomingMessageType.ReleaseRequestDetails:
        releaseRequestDetails(data.requestId);
        break;
      case CockpitWorkerIncomingMessageType.SyncPlayheadTime:
        syncPlayheadTime(data.playheadTs, data.isLiveMode);
        break;
      case CockpitWorkerIncomingMessageType.ResetSession:
        resetSession(data.playheadTs, data.isLiveMode);
        break;
      case 'ingest-snapshot-event':
        ingestDestinationAggregate(String(data.event.id), data.event, 'snapshot');
        break;
      default:
        break;
    }
  });
}

export function syncPlayheadTime(ts: number, live: boolean): void {
  playheadTs = ts;
  isLiveMode = live;
}

export function resetSession(ts: number, live: boolean): void {
  playheadTs = ts;
  sessionStartTs = ts;
  isLiveMode = live;

  // Wipe metrics to start fresh from the new point
  eventStore.clear();
  destinationStateByKey.clear();
  requestDestinationKeyById.clear();
  processedRequestIds.clear();

  // Ensure all currently subscribed destinations have an entry so the UI can show '0' instead of 'loading'
  for (const destinationKey of destinationSubscriptions) {
    getDestinationAggregateState(destinationKey, destinationKey);
  }

  for (const destinationKey of destinationSubscriptions) {
    postDestinationUpdate(destinationKey);
  }
}

async function startNdjsonStream(url: string, headers?: Record<string, string>): Promise<void> {
  stopNdjsonStream();
  streamAbortController = new AbortController();
  postStatus('started', 'ndjson');

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/x-ndjson, text/event-stream',
        ...(headers ?? {}),
      },
      signal: streamAbortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Unable to open NDJSON stream (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const responseContentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const isNdjsonStream = responseContentType.includes('application/x-ndjson');
    const isSseStream = !isNdjsonStream && responseContentType.includes('text/event-stream');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      if (isSseStream) {
        buffer = emitFromSseBuffer(buffer);
      } else {
        buffer = emitFromNdjsonBuffer(buffer);
      }
    }

    buffer += decoder.decode();

    if (isSseStream) {
      const remainingSseBuffer = emitFromSseBuffer(buffer).trim();

      if (remainingSseBuffer) {
        emitFromSseFrame(remainingSseBuffer);
      }
    } else {
      const remainingNdjson = buffer.trim();

      if (remainingNdjson) {
        emitFromNdjsonLine(remainingNdjson);
      }
    }

    postStatus('stopped', 'ndjson-complete');
  } catch (error) {
    if (streamAbortController?.signal.aborted) {
      return;
    }

    postStatus('error', error instanceof Error ? error.message : 'Unknown NDJSON stream worker error');
  } finally {
    streamAbortController = null;
  }
}

function stopNdjsonStream(): void {
  if (streamAbortController) {
    streamAbortController.abort();
    streamAbortController = null;
  }
}

function emitFromNdjsonBuffer(buffer: string): string {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';

  for (const line of lines) {
    emitFromNdjsonLine(line);
  }

  return remainder;
}

function emitFromSseBuffer(buffer: string): string {
  let normalizedBuffer = buffer.replace(/\r\n/g, '\n');
  let delimiterIndex = normalizedBuffer.indexOf('\n\n');

  while (delimiterIndex >= 0) {
    const frame = normalizedBuffer.slice(0, delimiterIndex);

    emitFromSseFrame(frame);

    normalizedBuffer = normalizedBuffer.slice(delimiterIndex + 2);
    delimiterIndex = normalizedBuffer.indexOf('\n\n');
  }

  return normalizedBuffer;
}

function emitFromSseFrame(frame: string): void {
  const trimmedFrame = frame.trim();

  if (!trimmedFrame) {
    return;
  }

  const dataLines: string[] = [];

  for (const rawLine of trimmedFrame.split('\n')) {
    const line = rawLine.trimEnd();

    if (!line || line.startsWith(':')) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  emitFromNdjsonLine(dataLines.join('\n'));
}

export function emitFromNdjsonLine(
  line: string,
  source: CockpitStreamEventSource = 'live',
  snapshotId?: string,
): CockpitMockStreamEvent | null {
  // Suppress live parsing if not in live mode to save CPU while viewing history.
  // We still maintain the stream connection at the startNdjsonStream level.
  if (source === 'live' && !isLiveMode) {
    return null;
  }

  const parsedEvent = parseNdjsonLine(line);
  const normalizedEvent = normalizeCockpitMockStreamEvent(parsedEvent);

  if (!normalizedEvent) {
    return null;
  }

  const id = String(normalizedEvent.id).trim();

  if (!id) {
    return null;
  }

  ingestNormalizedEvent(id, normalizedEvent, source, snapshotId);

  return normalizedEvent;
}

function ingestNormalizedEvent(
  id: string,
  normalizedEvent: CockpitMockStreamEvent,
  source: CockpitStreamEventSource,
  snapshotId?: string,
): void {
  const existingEvent = eventStore.get(id);

  if (existingEvent) {
    Object.assign(existingEvent, normalizedEvent, { id: existingEvent.id });
  } else {
    eventStore.set(id, normalizedEvent);
  }

  const storedEvent = eventStore.get(id) ?? normalizedEvent;

  if (source === 'live') {
    ingestDestinationAggregate(id, storedEvent, source);
  }

  if (source === 'snapshot') {
    postSnapshotEvent(snapshotId ?? 'snapshot', storedEvent);

    return;
  }

  const skipBuffer = deferHintEvents && isHintOnlyEvent(normalizedEvent);

  if (!skipBuffer) {
    if (!sendBuffer.has(id)) {
      sendBufferTimestamps.set(id, performance.now());
    }

    sendBuffer.add(id);
  }
}

function startTickLoop(): void {
  if (tickIntervalId !== null) {
    return;
  }

  tickIntervalId = setInterval(flushSendBuffer, currentTickRate);
}

function restartTickLoop(): void {
  if (tickIntervalId !== null) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }

  tickIntervalId = setInterval(flushSendBuffer, currentTickRate);
}

export function applyBudgetState(tickRateMs: number, deferHints: boolean): void {
  const normalizedTickRate = Math.max(100, tickRateMs);
  const didChangeTickRate = currentTickRate !== normalizedTickRate;

  currentTickRate = normalizedTickRate;
  deferHintEvents = deferHints;

  if (didChangeTickRate) {
    restartTickLoop();
  }
}

async function startSnapshot(
  snapshotId: string,
  url: string,
  range: CockpitTimelineRange,
  limit?: number,
  cursorBefore?: CockpitTimelineCursor,
  cursorAfter?: CockpitTimelineCursor,
): Promise<void> {
  let count = 0;
  let truncated = false;
  let hasError = false;
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch snapshot: ${response.status}`);
    }
    const rawNdjson = await response.text();
    const lines = rawNdjson.split('\n').filter((line) => line.trim().length > 0);

    truncated = limit !== undefined && limit > 0 && lines.length >= limit;

    for (const line of lines) {
      const event = emitFromNdjsonLine(line, 'snapshot', snapshotId);

      if (event) {
        count++;
        const ts = resolveEventTimestampMs(event);

        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
    }
  } catch (error) {
    hasError = true;
  }

  // Use the actual timestamps found in data to define the range,
  // falling back to requested range if no data was found or an error occurred.
  const resultRange: CockpitTimelineRange =
    count > 0 && Number.isFinite(minTs) && Number.isFinite(maxTs) ? { fromTs: minTs, toTs: maxTs } : range;

  const responseMsg: CockpitStreamWorkerOutgoingMessage = {
    type: 'snapshot-complete',
    result: {
      snapshotId,
      range: resultRange,
      count,
      truncated,
      cursorBefore,
      cursorAfter,
      error: hasError ? true : undefined,
    },
  };

  postMessage(responseMsg);
  flushDestinationUpdates();
}

function postSnapshotEvent(snapshotId: string, event: CockpitMockStreamEvent): void {
  const response: CockpitStreamWorkerOutgoingMessage = {
    type: 'snapshot-event',
    snapshotId,
    event,
  };

  postMessage(response);
}

export function postRangeMeta(meta: CockpitRangeMeta): void {
  const response: CockpitStreamWorkerOutgoingMessage = {
    type: 'range-meta',
    meta,
  };

  postMessage(response);
}

function deleteStoredEvent(requestId: string): void {
  eventStore.delete(requestId);
  sendBuffer.delete(requestId);
  sendBufferTimestamps.delete(requestId);
  heldRequestDetailsById.delete(requestId);

  pruneRequestDestinationReference(requestId);
}

function isHintOnlyEvent(event: CockpitMockStreamEvent): boolean {
  const hasHint = event['ttfb-hint'] !== undefined || event.ttfb_hint !== undefined;
  const hasResponse =
    event.response_size !== undefined || event.ttfb !== undefined || event.response_code !== undefined;

  return hasHint && !hasResponse;
}

function pruneEventStore(): void {
  if (eventStore.size <= MAX_STORED_EVENTS) {
    return;
  }

  const pruneCount = Math.ceil(eventStore.size * 0.3);
  const keys = eventStore.keys();

  for (let i = 0; i < pruneCount; i++) {
    const { value: key } = keys.next();

    if (key !== undefined) {
      deleteStoredEvent(key);
    }
  }
}

export function flushSendBuffer(): void {
  if (sendBuffer.size === 0) {
    flushDestinationUpdates();

    return;
  }

  const flushAt = performance.now();
  let maxTs: number | null = null;

  for (const id of sendBuffer) {
    const event = eventStore.get(id);

    if (event && typeof event.ts === 'number') {
      if (maxTs === null || event.ts > maxTs) {
        maxTs = event.ts;
      }
    }
  }

  const batchToSend: { event: CockpitMockStreamEvent; ageMs: number }[] = [];

  for (const id of sendBuffer) {
    const eventToSend = eventStore.get(id);

    if (eventToSend) {
      let ageMs: number;

      if (maxTs !== null && typeof eventToSend.ts === 'number') {
        ageMs = Math.max(0, maxTs - eventToSend.ts);
      } else {
        const firstSeenInBatch = sendBufferTimestamps.get(id) ?? flushAt;

        ageMs = Math.max(0, flushAt - firstSeenInBatch);
      }

      batchToSend.push({ event: eventToSend, ageMs });
    }
  }

  sendBuffer.clear();
  sendBufferTimestamps.clear();

  if (batchToSend.length === 0) {
    return;
  }

  const response: CockpitStreamWorkerOutgoingMessage = {
    type: 'BATCH_UPDATE',
    data: batchToSend,
  };

  postMessage(response);
  pruneEventStore();
  flushDestinationUpdates();
}

export function parseNdjsonLine(line: string): unknown {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function normalizeCockpitMockStreamEvent(value: unknown): CockpitMockStreamEvent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const eventCandidate = { ...(value as Record<string, unknown>) };
  const responseCodeCandidate =
    eventCandidate.response_code ?? eventCandidate.responseCode ?? eventCandidate.status_code ?? eventCandidate.status;

  if (responseCodeCandidate !== undefined) {
    eventCandidate.response_code = normalizeOptionalNumber(responseCodeCandidate);
  }

  return isCockpitMockStreamEvent(eventCandidate) ? eventCandidate : null;
}

function normalizeOptionalNumber(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : value;
}

export function isCockpitMockStreamEvent(value: unknown): value is CockpitMockStreamEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const event = value as Partial<CockpitMockStreamEvent>;

  if (typeof event.id !== 'string' && typeof event.id !== 'number') {
    return false;
  }

  if (event.ts !== undefined && typeof event.ts !== 'number') {
    return false;
  }

  if (event.destination !== undefined && typeof event.destination !== 'string') {
    return false;
  }

  if (event.flow !== undefined && typeof event.flow !== 'string') {
    return false;
  }

  if (event.flow_execution_id !== undefined && typeof event.flow_execution_id !== 'string') {
    return false;
  }

  if (event.trigger_ua !== undefined && typeof event.trigger_ua !== 'string') {
    return false;
  }

  if (event.trigger_ip !== undefined && typeof event.trigger_ip !== 'string') {
    return false;
  }

  if (event.payload_size !== undefined && typeof event.payload_size !== 'number') {
    return false;
  }

  if (event['ttfb-hint'] !== undefined && typeof event['ttfb-hint'] !== 'number') {
    return false;
  }

  if (event.ttfb_hint !== undefined && typeof event.ttfb_hint !== 'number') {
    return false;
  }

  if (event.ttfb !== undefined && typeof event.ttfb !== 'number') {
    return false;
  }

  if (event.response_size !== undefined && typeof event.response_size !== 'number') {
    return false;
  }

  if (event.response_code !== undefined && typeof event.response_code !== 'number') {
    return false;
  }

  return true;
}

function postStatus(status: 'started' | 'stopped' | 'error', detail?: string): void {
  const response: CockpitStreamWorkerOutgoingMessage = {
    type: 'status',
    status,
    detail,
  };

  postMessage(response);
}

export function resetWorkerState(): void {
  // Exported for worker unit tests; runtime resets happen through worker messages.
  eventStore.clear();
  sendBuffer.clear();
  sendBufferTimestamps.clear();
  destinationStateByKey.clear();
  requestDestinationKeyById.clear();
  processedRequestIds.clear();
  heldRequestDetailsById.clear();
  destinationSubscriptions.clear();
  currentTickRate = 1_000;
  deferHintEvents = false;
  isLiveMode = true;
  playheadTs = Date.now();
  sessionStartTs = Date.now();
}

function normalizeDestinationKey(destinationName: string | null | undefined): string | null {
  if (typeof destinationName !== 'string') {
    return null;
  }

  const normalized = destinationName.trim().toLowerCase();

  return normalized ? normalized : null;
}

function resolveEventTimestampMs(event: CockpitMockStreamEvent): number {
  if (typeof event.ts !== 'number' || !Number.isFinite(event.ts)) {
    return Date.now();
  }

  if (event.ts > 1_000_000_000_000) {
    return event.ts;
  }

  return event.ts * 1_000;
}

function resolveResponseCode(event: CockpitMockStreamEvent): number | null {
  const value = event.response_code;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

function resolveFlow(event: CockpitMockStreamEvent): string | null {
  if (typeof event.flow !== 'string') {
    return null;
  }

  const trimmed = event.flow.trim();

  return trimmed ? trimmed : null;
}

function resolveHintTtfbMs(event: CockpitMockStreamEvent): number | null {
  if (typeof event['ttfb-hint'] === 'number') {
    return event['ttfb-hint'];
  }

  if (typeof event.ttfb_hint === 'number') {
    return event.ttfb_hint;
  }

  return null;
}

export function ingestDestinationAggregate(
  requestId: string,
  event: CockpitMockStreamEvent,
  source: CockpitStreamEventSource = 'live',
): void {
  // Suppress live data in sidebar if not in live mode
  if (source === 'live' && !isLiveMode) {
    return;
  }

  const destinationName = typeof event.destination === 'string' ? event.destination.trim() : '';
  let destinationKey = normalizeDestinationKey(destinationName);
  const timestampMs = resolveEventTimestampMs(event);

  if (destinationKey) {
    requestDestinationKeyById.set(requestId, { destinationKey, timestampMs });
  } else {
    destinationKey = requestDestinationKeyById.get(requestId)?.destinationKey ?? null;
  }

  if (!destinationKey) {
    return;
  }

  const state = getDestinationAggregateState(destinationKey, destinationName);

  if (destinationName) {
    state.destinationName = destinationName;
  }

  const responseCode = resolveResponseCode(event);

  const recentRequest: DestinationRecentRequest = {
    requestId,
    timestampMs,
    responseCode,
    flow: resolveFlow(event),
    details: normalizeRequestDetails(requestId, event),
  };

  upsertRecentRequest(state.recentEvents, recentRequest, DESTINATION_MAX_EVENT_ITEMS);

  if (responseCode !== null) {
    upsertMetricContribution(requestId, destinationKey, timestampMs, responseCode);

    if (responseCode > 399) {
      upsertRecentRequest(state.recentErrors, recentRequest, DESTINATION_MAX_ERROR_ITEMS);
    } else {
      removeRecentRequest(state.recentErrors, requestId);
    }

    requestDestinationKeyById.delete(requestId);
  }

  state.dirty = true;
}

export function subscribeDestination(destinationName: string): void {
  const destinationKey = normalizeDestinationKey(destinationName);

  if (!destinationKey) {
    return;
  }

  destinationSubscriptions.add(destinationKey);

  const state = destinationStateByKey.get(destinationKey);

  if (state) {
    state.dirty = true;
  }

  postDestinationUpdate(destinationKey);
}

function unsubscribeDestination(destinationName: string): void {
  const destinationKey = normalizeDestinationKey(destinationName);

  if (!destinationKey) {
    return;
  }

  destinationSubscriptions.delete(destinationKey);
}

export function flushDestinationUpdates(): void {
  if (destinationSubscriptions.size === 0) {
    return;
  }

  for (const destinationKey of destinationSubscriptions) {
    const state = destinationStateByKey.get(destinationKey);

    if (!state || !state.dirty) {
      continue;
    }

    postDestinationUpdate(destinationKey);
    state.dirty = false;
  }
}

function postDestinationUpdate(destinationKey: string): void {
  const state = destinationStateByKey.get(destinationKey);
  const data = computeDestinationSidebarData(state);
  const destinationName = state?.destinationName ?? destinationKey;
  const message: CockpitStreamWorkerOutgoingMessage = {
    type: 'destination-update',
    destinationName,
    data,
  };

  postMessage(message);
}

function computeDestinationSidebarData(state: DestinationAggregateState | undefined): CockpitDestinationSidebarData {
  if (!state) {
    return {
      metricsLoading: true,
      errorRatePercentage: null,
      processedResponsesLastWindow: 0,
      processedWindowMinutes: 0,
      eventsLoading: true,
      errorsLoading: true,
      events: [],
      errors: [],
    };
  }

  const totalResponses = state.processedResponsesLastWindow;
  const errorResponses = state.errorResponsesLastWindow;
  const events = state.recentEvents.map(toDestinationListItem);
  const errors = state.recentErrors.map(toDestinationListItem);

  const windowMinutes = Math.round((playheadTs - sessionStartTs) / 60000);

  return {
    metricsLoading: totalResponses === 0,
    errorRatePercentage: totalResponses === 0 ? null : Number(((errorResponses / totalResponses) * 100).toFixed(1)),
    processedResponsesLastWindow: totalResponses,
    processedWindowMinutes: Math.max(1, windowMinutes),
    eventsLoading: events.length === 0,
    errorsLoading: state.recentEvents.length === 0,
    events,
    errors,
  };
}

function getDestinationAggregateState(destinationKey: string, destinationName: string): DestinationAggregateState {
  const existingState = destinationStateByKey.get(destinationKey);

  if (existingState) {
    return existingState;
  }

  const state: DestinationAggregateState = {
    destinationName: destinationName || destinationKey,
    processedResponsesLastWindow: 0,
    errorResponsesLastWindow: 0,
    recentEvents: [],
    recentErrors: [],
    dirty: false,
  };

  destinationStateByKey.set(destinationKey, state);

  return state;
}

function upsertMetricContribution(
  requestId: string,
  destinationKey: string,
  timestampMs: number,
  responseCode: number,
): void {
  if (processedRequestIds.has(requestId)) {
    return;
  }

  processedRequestIds.add(requestId);

  const state = getDestinationAggregateState(destinationKey, destinationKey);

  state.processedResponsesLastWindow += 1;

  if (responseCode > 399) {
    state.errorResponsesLastWindow += 1;
  }

  state.dirty = true;
}

function upsertRecentRequest(
  requests: DestinationRecentRequest[],
  request: DestinationRecentRequest,
  maxRequests: number,
): void {
  removeRecentRequest(requests, request.requestId);
  requests.unshift(request);

  while (requests.length > maxRequests) {
    const removedRequest = requests.pop();

    if (removedRequest) {
      pruneRequestDestinationReference(removedRequest.requestId);
    }
  }
}

function removeRecentRequest(requests: DestinationRecentRequest[], requestId: string): void {
  const index = requests.findIndex((request) => request.requestId === requestId);

  if (index < 0) {
    return;
  }

  requests.splice(index, 1);
  pruneRequestDestinationReference(requestId);
}

function pruneRequestDestinationReference(requestId: string): void {
  if (!requestDestinationKeyById.has(requestId)) {
    return;
  }

  if (
    eventStore.has(requestId) ||
    processedRequestIds.has(requestId) ||
    heldRequestDetailsById.has(requestId) ||
    hasRecentRequest(requestId)
  ) {
    return;
  }

  requestDestinationKeyById.delete(requestId);
}

function hasRecentRequest(requestId: string): boolean {
  for (const state of destinationStateByKey.values()) {
    if (
      state.recentEvents.some((request) => request.requestId === requestId) ||
      state.recentErrors.some((request) => request.requestId === requestId)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeRequestDetails(requestId: string, event: CockpitMockStreamEvent): CockpitMockStreamEvent {
  return { ...event, id: requestId };
}

function findRequestDetails(requestId: string): CockpitMockStreamEvent | null {
  const heldRequestDetails = heldRequestDetailsById.get(requestId);

  if (heldRequestDetails) {
    return normalizeRequestDetails(requestId, heldRequestDetails);
  }

  for (const state of destinationStateByKey.values()) {
    const recentRequest =
      state.recentEvents.find((request) => request.requestId === requestId) ??
      state.recentErrors.find((request) => request.requestId === requestId);

    if (recentRequest) {
      return normalizeRequestDetails(requestId, recentRequest.details);
    }
  }

  const storedEvent = eventStore.get(requestId);

  if (storedEvent) {
    return normalizeRequestDetails(requestId, storedEvent);
  }

  return null;
}

export function postRequestDetails(requestId: string): void {
  const normalizedRequestId = String(requestId).trim();

  if (!normalizedRequestId) {
    return;
  }

  const details = findRequestDetails(normalizedRequestId);

  if (details) {
    heldRequestDetailsById.set(normalizedRequestId, details);
  }

  const message: CockpitStreamWorkerOutgoingMessage = {
    type: 'request-details',
    requestId: normalizedRequestId,
    details,
  };

  postMessage(message);
}

export function releaseRequestDetails(requestId: string): void {
  const normalizedRequestId = String(requestId).trim();

  if (!normalizedRequestId) {
    return;
  }

  heldRequestDetailsById.delete(normalizedRequestId);
  pruneRequestDestinationReference(normalizedRequestId);
}

function toDestinationListItem(entry: DestinationRecentRequest): CockpitDestinationSidebarListItem {
  return {
    requestId: entry.requestId,
    responseCode: entry.responseCode,
    flow: entry.flow,
    timestampLabel: new Date(entry.timestampMs).toLocaleTimeString(),
  };
}
