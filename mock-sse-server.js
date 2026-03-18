const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.MOCK_SSE_PORT || 8787);
const LIVE_INTERVAL_MS = Number(process.env.MOCK_SSE_LIVE_INTERVAL_MS || 160);
const LIVE_BURST = Number(process.env.MOCK_SSE_LIVE_BURST || 3);
const HISTORICAL_COUNT = Number(process.env.MOCK_SSE_HISTORICAL_COUNT || 180);
const HISTORICAL_INTERVAL_MS = Number(process.env.MOCK_SSE_HISTORICAL_INTERVAL_MS || 22);

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

function writeSse(res, payload, eventName = 'message') {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildHistorical(count) {
  const current = nowMs();
  const arr = [];
  for (let i = 0; i < count; i++) {
    const ts = current - i * randomInt(900, 3500);
    arr.push(makeRequestStages(ts));
  }
  return arr;
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

  const records = [];
  for (let ts = to; ts >= from; ts -= randomInt(800, 1800)) {
    const event = makeRequestStages(ts);
    records.push(event.base, event.hint, event.final);
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

  const historical = buildHistorical(HISTORICAL_COUNT);
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
    writeSse(res, item.base, 'ndjson');
    setTimeout(() => writeSse(res, item.hint, 'ndjson'), 15);
    setTimeout(() => writeSse(res, item.final, 'ndjson'), 30);
  }, HISTORICAL_INTERVAL_MS);

  const livePump = setInterval(() => {
    for (let i = 0; i < LIVE_BURST; i++) {
      const live = makeRequestStages(nowMs() + i * 4);
      const jitter = i * 8;
      writeSse(res, live.base, 'ndjson');
      setTimeout(() => writeSse(res, live.hint, 'ndjson'), randomInt(22, 80) + jitter);
      setTimeout(() => writeSse(res, live.final, 'ndjson'), randomInt(90, 220) + jitter);
    }
  }, LIVE_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(heartBeat);
    clearInterval(historicalPump);
    clearInterval(livePump);
  });
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

server.listen(PORT, () => {
  console.log(`[mock-sse] listening on http://localhost:${PORT}`);
  console.log('[mock-sse] stream:   /api/traffic/stream');
  console.log('[mock-sse] snapshot: /api/traffic/snapshot');
});
