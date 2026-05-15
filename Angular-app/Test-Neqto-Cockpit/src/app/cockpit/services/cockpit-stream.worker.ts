/// <reference lib="webworker" />

import {
  CockpitMockStreamEvent,
  CockpitStreamWorkerIncomingMessage,
  CockpitStreamWorkerOutgoingMessage,
} from '../interfaces/cockpit-stream.interface';

let streamAbortController: AbortController | null = null;

const eventStore = new Map<string, CockpitMockStreamEvent>();
const sendBuffer = new Set<string>();
const sendBufferTimestamps = new Map<string, number>();
let currentTickRate = 1_000;

export const MAX_STORED_EVENTS = 20_000;
let deferHintEvents = false;
let tickIntervalId: ReturnType<typeof setInterval> | null = null;

const isWorkerContext = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

if (isWorkerContext) {
  startTickLoop();

  addEventListener('message', ({ data }: MessageEvent<CockpitStreamWorkerIncomingMessage>) => {
    if (!data) {
      return;
    }

    switch (data.type) {
      case 'ingest-ndjson-line':
        emitFromNdjsonLine(data.line);
        break;
      case 'start-ndjson':
        void startNdjsonStream(data.url, data.headers);
        break;
      case 'stop':
        stopNdjsonStream();
        postStatus('stopped');
        break;
      case 'update-budget-state':
        applyBudgetState(data.tickRateMs, data.deferHintEvents);
        break;
      default:
        break;
    }
  });
}

async function startNdjsonStream(url: string, headers?: Record<string, string>): Promise<void> {
  stopNdjsonStream();
  streamAbortController = new AbortController();
  postStatus('started', 'ndjson');

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/event-stream, application/x-ndjson',
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
    const isSseStream = responseContentType.includes('text/event-stream');
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

export function emitFromNdjsonLine(line: string): void {
  const parsedEvent = parseNdjsonLine(line);
  const normalizedEvent = normalizeCockpitMockStreamEvent(parsedEvent);

  if (!normalizedEvent) {
    return;
  }

  const id = String(normalizedEvent.id).trim();

  if (!id) {
    return;
  }

  const existingEvent = eventStore.get(id);

  if (existingEvent) {
    Object.assign(existingEvent, normalizedEvent, { id: existingEvent.id });
  } else {
    eventStore.set(id, normalizedEvent);
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
  currentTickRate = tickRateMs;
  deferHintEvents = deferHints;

  restartTickLoop();
}

function isHintOnlyEvent(event: CockpitMockStreamEvent): boolean {
  const hasHint = event['ttfb-hint'] !== undefined || event.ttfb_hint !== undefined;
  const hasResponse =
    event.response_size !== undefined || event.ttfb !== undefined || event.response_code !== undefined;

  return hasHint && !hasResponse;
}

function pruneEventStore(): void {
  const excess = eventStore.size - MAX_STORED_EVENTS;

  if (excess <= 0) {
    return;
  }

  const keys = eventStore.keys();

  for (let i = 0; i < excess; i++) {
    const { value: key } = keys.next();

    if (key !== undefined) {
      eventStore.delete(key);
    }
  }
}

export function flushSendBuffer(): void {
  if (sendBuffer.size === 0) {
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
  eventStore.clear();
  sendBuffer.clear();
  sendBufferTimestamps.clear();
  currentTickRate = 1_000;
  deferHintEvents = false;
}
