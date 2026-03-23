const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.MOCK_SSE_PORT || 8787);
const DATA_DIR = path.join(__dirname, 'mock-data');
const DATA_FILE = path.join(DATA_DIR, 'traffic-history.ndjson');
const MAX_IN_MEMORY_EVENTS = 25000;

const STATUS_CODES = [200, 201, 202, 204, 400, 401, 403, 404, 429, 500, 502, 503];
const DESTINATIONS = [
  'api.neqto.local/v1/devices',
  'api.neqto.local/v1/flows',
  'api.neqto.local/v1/jobs',
  'tenant.service.local/query',
  'edge.gateway.local/sync',
  'bol.com',
  'example.org'
];
const FLOWS = ['sync-flow', 'status-flow', 'retry-flow', 'report-flow', 'my-flow'];
const USER_AGENTS = ['Postman/1.0', 'Chrome/125.0', 'Neqto-Agent/0.9', 'curl/8.4.0'];

let sequence = 0;
let eventStore = [];
const subscribers = new Set();
let liveProducerTimer = null;
let shutdownHandled = false;

function nowMs() {
  return Date.now();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function makeId(ts) {
  sequence += 1;
  return `${ts}-${sequence}`;
}

function makeRequestBase(ts) {
  return {
    id: makeId(ts),
    ts,
    destination: pick(DESTINATIONS),
    flow: pick(FLOWS),
    flow_execution_id: `${randomInt(10, 99)}-${ts}${randomInt(1000, 9999)}`,
    trigger_ua: pick(USER_AGENTS),
    trigger_ip: `10.0.${randomInt(0, 255)}.${randomInt(1, 254)}`
  };
}

function makeRequestStages(ts) {
  const base = makeRequestBase(ts);
  const hint = {
    id: base.id,
    payload_size: randomInt(300, 16000),
    'ttfb-hint': randomInt(40, 260)
  };
  const final = {
    id: base.id,
    ttfb: randomInt(60, 900),
    response_size: randomInt(500, 42000),
    response_code: pick(STATUS_CODES)
  };
  return { base, hint, final };
}

function isBaseEvent(event) {
  return event && typeof event.id === 'string' && typeof event.ts === 'number';
}

function ensureDataFileExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    const seed = [];
    const current = nowMs();
    for (let i = 120; i > 0; i -= 1) {
      const ts = current - i * 20 * 1000;
      const ev = makeRequestStages(ts);
      seed.push(ev.base, ev.hint, ev.final);
    }
    fs.writeFileSync(DATA_FILE, seed.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  }
}

function loadEventsFromFile() {
  const content = fs.readFileSync(DATA_FILE, 'utf8');
  eventStore = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((line) => line !== null);

  if (eventStore.length > MAX_IN_MEMORY_EVENTS) {
    eventStore = eventStore.slice(-MAX_IN_MEMORY_EVENTS);
  }
}

function readAllEventsFromFile() {
  const content = fs.readFileSync(DATA_FILE, 'utf8');
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((line) => line !== null);
}

function appendEventToStore(event) {
  eventStore.push(event);
  if (eventStore.length > MAX_IN_MEMORY_EVENTS) {
    eventStore = eventStore.slice(-MAX_IN_MEMORY_EVENTS);
  }

  fs.appendFileSync(DATA_FILE, `${JSON.stringify(event)}\n`, 'utf8');
}

function broadcastNdjson(event) {
  for (const res of subscribers) {
    writeSse(res, event, 'ndjson');
  }
}

function publishLiveEvent(event) {
  appendEventToStore(event);
  broadcastNdjson(event);
}

function startLiveProducer() {
  liveProducerTimer = setInterval(() => {
    // Emit two lightweight request pipelines per tick for denser live traffic.
    const first = makeRequestStages(nowMs());
    publishLiveEvent(first.base);
    setTimeout(() => publishLiveEvent(first.hint), randomInt(30, 90));
    setTimeout(() => publishLiveEvent(first.final), randomInt(110, 260));

    const second = makeRequestStages(nowMs() + randomInt(1, 7));
    setTimeout(() => publishLiveEvent(second.base), randomInt(20, 70));
    setTimeout(() => publishLiveEvent(second.hint), randomInt(70, 140));
    setTimeout(() => publishLiveEvent(second.final), randomInt(170, 320));
  }, 360);
}

function clearHistoryFile() {
  try {
    fs.writeFileSync(DATA_FILE, '', 'utf8');
    eventStore = [];
    console.log('[mock-sse] history cleared on shutdown');
  } catch (err) {
    console.error('[mock-sse] failed to clear history on shutdown', err);
  }
}

function handleShutdown(signal) {
  if (shutdownHandled) return;
  shutdownHandled = true;

  console.log(`[mock-sse] shutting down (${signal})`);

  if (liveProducerTimer) {
    clearInterval(liveProducerTimer);
  }

  clearHistoryFile();

  for (const res of subscribers) {
    try {
      res.end();
    } catch {
      // Ignore errors while tearing down sockets.
    }
  }

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 1000);
}

function buildIdTimestampMap(records) {
  const idTs = new Map();
  for (const item of records) {
    if (isBaseEvent(item)) {
      idTs.set(item.id, item.ts);
    }
  }
  return idTs;
}

function timestampForRecord(record, idTs) {
  if (typeof record.ts === 'number') return record.ts;
  if (typeof record.id === 'string' && idTs.has(record.id)) return idTs.get(record.id);
  return null;
}

function writeSse(res, payload, eventName = 'message') {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function parseTs(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function writeCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function handleSnapshot(req, res, url) {
  writeCors(res);
  const to = parseTs(url.searchParams.get('to'), nowMs());
  const from = parseTs(url.searchParams.get('from'), to - 5 * 60 * 1000);

  // Snapshot reads from full NDJSON history file, not only in-memory cache.
  const allEvents = readAllEventsFromFile();
  const idTs = buildIdTimestampMap(allEvents);
  const records = [];
  for (let i = allEvents.length - 1; i >= 0; i -= 1) {
    const item = allEvents[i];
    const itemTs = timestampForRecord(item, idTs);
    if (itemTs === null) continue;
    if (itemTs >= from && itemTs <= to) {
      records.push(item);
    }
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  for (const item of records) {
    res.write(`${JSON.stringify(item)}\n`);
  }
  res.end();
}

function handleSse(req, res) {
  writeCors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const hint = {
    server_ts: nowMs(),
    utc_date: new Date().toISOString().slice(0, 10),
    available_range: {
      from: dayStart.getTime(),
      to: nowMs()
    },
    format: 'ndjson-over-sse'
  };
  writeSse(res, hint, 'hint');

  const idTs = buildIdTimestampMap(eventStore);
  const historical = [];
  for (let i = eventStore.length - 1; i >= 0 && historical.length < 400; i -= 1) {
    const item = eventStore[i];
    const itemTs = timestampForRecord(item, idTs);
    if (itemTs === null) continue;
    if (itemTs >= dayStart.getTime()) {
      historical.push(item);
    }
  }
  let historicalIndex = 0;

  const heartBeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  const historicalPump = setInterval(() => {
    if (historicalIndex >= historical.length) {
      clearInterval(historicalPump);
      return;
    }

    const item = historical[historicalIndex++];
    writeSse(res, item, 'ndjson');
  }, 35);

  subscribers.add(res);

  req.on('close', () => {
    clearInterval(heartBeat);
    clearInterval(historicalPump);
    subscribers.delete(res);
  });
}

function bootstrapData() {
  ensureDataFileExists();
  loadEventsFromFile();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    writeCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/traffic/stream') {
    handleSse(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/traffic/snapshot') {
    handleSnapshot(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    writeCors(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'mock-sse-server' }));
    return;
  }

  writeCors(res);
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

bootstrapData();
startLiveProducer();

server.listen(PORT, () => {
  console.log(`[mock-sse] listening on http://localhost:${PORT}`);
  console.log('[mock-sse] stream:   /api/traffic/stream');
  console.log('[mock-sse] snapshot: /api/traffic/snapshot');
  console.log(`[mock-sse] data file: ${DATA_FILE}`);
});

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('exit', () => {
  if (!shutdownHandled) {
    clearHistoryFile();
  }
});
