// @ts-nocheck
const http = require('node:http');

function readPositiveEnvNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PORT = Number(process.env.MOCK_COCKPIT_PORT || process.env.PORT || 8788);
const COCKPIT_MOCK_STREAM_PATH = '/mock/cockpit/stream';
const COCKPIT_MOCK_STREAM_PATH_ALIAS = '/api/traffic/stream';
const HEALTH_PATH = '/health';

const MAX_HISTORY_SIZE = 1000;
const GENERATION_INTERVAL_MS = 50;
const PARALLEL_LIFECYCLES_MIN = 1;
const PARALLEL_LIFECYCLES_MAX = 3;
const BASE_JITTER_MAX_MS = 140;
const HINT_DELAY_MIN_MS = 80;
const HINT_DELAY_MAX_MS = 520;
const FINAL_DELAY_MIN_MS = 110;
const FINAL_DELAY_MAX_MS = 620;
const OUT_OF_ORDER_CHANCE = 0.22;
const RESPONSE_TIMEOUT_MS = 15 * 60 * 1000;
const LONG_RESPONSE_CHANCE = 0.000;
const LONG_RESPONSE_EXTRA_MIN_MS = 1500;
const LONG_RESPONSE_EXTRA_MAX_MS = 150000;
const STRESS_ENABLED = false;
const STRESS_EVENT_MULTIPLIER = Math.floor(readPositiveEnvNumber('STRESS_EVENT_MULTIPLIER', 200));
const STRESS_BASE_INTERVAL_MS = Math.floor(readPositiveEnvNumber('STRESS_BASE_INTERVAL_SECONDS', 30) * 1000);
const STRESS_INTERVAL_JITTER_MS = Math.floor(readPositiveEnvNumber('STRESS_INTERVAL_JITTER_SECONDS', 10) * 1000);
const STRESS_DURATION_MS = Math.floor(readPositiveEnvNumber('STRESS_DURATION_SECONDS', 5) * 500);

const RESPONSE_CODES = [200, 201, 202, 204, 206,304, 307, 308,409, 410, 422, 429,502, 503,200, 201, 202, 204, 401, 403, 404, 408,  301, 302, 500, 501,400];
const REQUEST_FIXTURES = [
  {
    destination: 'bol.com',
    flow: 'order-sync',
    triggerIp: '127.0.0.1',
    triggerUa: 'Postman/1.0',
  },
  {
    destination: 'Afas',
    flow: 'customer-sync',
    triggerIp: '10.0.10.11',
    triggerUa: 'Chrome/125.0',
  },
  {
    destination: 'google.com',
    flow: 'invoice-refresh',
    triggerIp: '10.0.10.12',
    triggerUa: 'Neqto Scheduler',
  },
  {
    destination: 'google2.com',
    flow: 'something-something',
    triggerIp: '10.0.23.34',
    triggerUa: 'Neqto flow',
  },
  {
    destination: 'amazon.com',
    flow: 'inventory-sync',
    triggerIp: '10.0.31.41',
    triggerUa: 'Firefox/126.0',
  },
  {
    destination: 'coolblue.nl',
    flow: 'shipment-sync',
    triggerIp: '10.0.31.42',
    triggerUa: 'Chrome/126.0',
  },
  {
    destination: 'zalando.nl',
    flow: 'returns-sync',
    triggerIp: '10.0.31.43',
    triggerUa: 'Safari/17.5',
  },
  {
    destination: 'shopify.com',
    flow: 'catalog-refresh',
    triggerIp: '10.0.31.44',
    triggerUa: 'Neqto Webhook',
  },
  {
    destination: 'exactonline.nl',
    flow: 'ledger-export',
    triggerIp: '10.0.31.45',
    triggerUa: 'Postman/11.2',
  },
  {
    destination: 'microsoft.com',
    flow: 'auth-check',
    triggerIp: '10.0.31.46',
    triggerUa: 'Edge/124.0',
  },/*
  {
    destination: 'adyen.com',
    flow: 'payment-reconcile',
    triggerIp: '10.0.31.47',
    triggerUa: 'Neqto Scheduler',
  },
  {
    destination: 'mollie.com',
    flow: 'payment-status-sync',
    triggerIp: '10.0.31.48',
    triggerUa: 'curl/8.7.1',
  },
  {
    destination: 'dhl.com',
    flow: 'track-and-trace-sync',
    triggerIp: '10.0.31.49',
    triggerUa: 'Chrome/124.0',
  },
  {
    destination: 'postnl.nl',
    flow: 'label-generation',
    triggerIp: '10.0.31.50',
    triggerUa: 'Neqto Worker',
  },
  {
    destination: 'ups.com',
    flow: 'delivery-status-sync',
    triggerIp: '10.0.31.51',
    triggerUa: 'Firefox/125.0',
  }, 
  {
    destination: 'fedex.com',
    flow: 'pickup-request',
    triggerIp: '10.0.31.52',
    triggerUa: 'Neqto API Client',
  },
  {
    destination: 'mailchimp.com',
    flow: 'audience-sync',
    triggerIp: '10.0.31.53',
    triggerUa: 'Chrome/123.0',
  },
  {
    destination: 'sendgrid.com',
    flow: 'email-bounce-sync',
    triggerIp: '10.0.31.54',
    triggerUa: 'Postman/10.24',
  },
  {
    destination: 'slack.com',
    flow: 'alert-dispatch',
    triggerIp: '10.0.31.55',
    triggerUa: 'Neqto Alerting',
  },
  {
    destination: 'github.com',
    flow: 'release-webhook-sync',
    triggerIp: '10.0.31.56',
    triggerUa: 'GitHub-Hookshot',
  },
  {
    destination: 'gitlab.com',
    flow: 'pipeline-status-sync',
    triggerIp: '10.0.31.57',
    triggerUa: 'GitLab/17.0',
  },
  {
    destination: 'atlassian.com',
    flow: 'issue-sync',
    triggerIp: '10.0.31.58',
    triggerUa: 'Jira Cloud',
  },
  {
    destination: 'dropbox.com',
    flow: 'file-metadata-sync',
    triggerIp: '10.0.31.59',
    triggerUa: 'Neqto Integrations',
  },
  {
    destination: 'onedrive.live.com',
    flow: 'document-sync',
    triggerIp: '10.0.31.60',
    triggerUa: 'Edge/123.0',
  },
  {
    destination: 'salesforce.com',
    flow: 'lead-sync',
    triggerIp: '10.0.31.61',
    triggerUa: 'Chrome/127.0',
  },
  {
    destination: 'hubspot.com',
    flow: 'contact-sync',
    triggerIp: '10.0.31.62',
    triggerUa: 'Firefox/127.0',
  },
  {
    destination: 'stripe.com',
    flow: 'subscription-reconcile',
    triggerIp: '10.0.31.63',
    triggerUa: 'Neqto Billing',
  },
  {
    destination: 'paypal.com',
    flow: 'payout-sync',
    triggerIp: '10.0.31.64',
    triggerUa: 'Postman/11.3',
  },
  {
    destination: 'twilio.com',
    flow: 'sms-dispatch',
    triggerIp: '10.0.31.65',
    triggerUa: 'Neqto Messaging',
  },
  {
    destination: 'zendesk.com',
    flow: 'ticket-sync',
    triggerIp: '10.0.31.66',
    triggerUa: 'Chrome/127.0',
  },
  {
    destination: 'freshdesk.com',
    flow: 'sla-report-sync',
    triggerIp: '10.0.31.67',
    triggerUa: 'Firefox/126.0',
  },
  {
    destination: 'intercom.com',
    flow: 'conversation-export',
    triggerIp: '10.0.31.68',
    triggerUa: 'Neqto Support',
  },
  {
    destination: 'notion.so',
    flow: 'workspace-sync',
    triggerIp: '10.0.31.69',
    triggerUa: 'Safari/17.6',
  },
  {
    destination: 'airtable.com',
    flow: 'table-upsert',
    triggerIp: '10.0.31.70',
    triggerUa: 'Neqto Tables',
  },
  {
    destination: 'asana.com',
    flow: 'task-sync',
    triggerIp: '10.0.31.71',
    triggerUa: 'Chrome/126.0',
  },
  {
    destination: 'trello.com',
    flow: 'board-sync',
    triggerIp: '10.0.31.72',
    triggerUa: 'Neqto Planner',
  },
  {
    destination: 'monday.com',
    flow: 'item-status-sync',
    triggerIp: '10.0.31.73',
    triggerUa: 'Edge/125.0',
  },
  {
    destination: 'zoom.us',
    flow: 'meeting-audit-sync',
    triggerIp: '10.0.31.74',
    triggerUa: 'Neqto Meetings',
  },
  {
    destination: 'teams.microsoft.com',
    flow: 'presence-sync',
    triggerIp: '10.0.31.75',
    triggerUa: 'Teams/24180',
  },
  {
    destination: 'xero.com',
    flow: 'invoice-send',
    triggerIp: '10.0.31.76',
    triggerUa: 'Postman/11.1',
  },
  {
    destination: 'quickbooks.intuit.com',
    flow: 'ledger-sync',
    triggerIp: '10.0.31.77',
    triggerUa: 'Neqto Accounting',
  },
  {
    destination: 'oracle.com',
    flow: 'erp-export',
    triggerIp: '10.0.31.78',
    triggerUa: 'Chrome/124.0',
  },
  {
    destination: 'sap.com',
    flow: 'material-master-sync',
    triggerIp: '10.0.31.79',
    triggerUa: 'Neqto ERP Connector',
  },
  {
    destination: 'snowflake.com',
    flow: 'warehouse-update',
    triggerIp: '10.0.31.80',
    triggerUa: 'Neqto ETL',
  },
  {
    destination: 'datadoghq.com',
    flow: 'metrics-push',
    triggerIp: '10.0.31.81',
    triggerUa: 'Neqto Observability',
  },
  {
    destination: 'newrelic.com',
    flow: 'apm-trace-sync',
    triggerIp: '10.0.31.82',
    triggerUa: 'Neqto Telemetry',
  },
  {
    destination: 'sentry.io',
    flow: 'error-forwarding',
    triggerIp: '10.0.31.83',
    triggerUa: 'Neqto Error Reporter',
  },
  {
    destination: 'pagerduty.com',
    flow: 'incident-sync',
    triggerIp: '10.0.31.84',
    triggerUa: 'Neqto OnCall',
  },
  {
    destination: 'okta.com',
    flow: 'identity-sync',
    triggerIp: '10.0.31.85',
    triggerUa: 'Neqto IAM',
  },
  {
    destination: 'auth0.com',
    flow: 'token-validation-audit',
    triggerIp: '10.0.31.86',
    triggerUa: 'Chrome/125.0',
  },
  {
    destination: 'cloudflare.com',
    flow: 'api-quota-check',
    triggerIp: '10.0.31.87',
    triggerUa: 'curl/8.8.0',
  },
  {
    destination: 'fastly.com',
    flow: 'cache-purge-sync',
    triggerIp: '10.0.31.88',
    triggerUa: 'Neqto CDN Ops',
  },
  {
    destination: 'aws.amazon.com',
    flow: 'cost-center-sync',
    triggerIp: '10.0.31.89',
    triggerUa: 'Neqto FinOps',
  },/*  
  {
    destination: 'azure.microsoft.com',
    flow: 'billing-rollup',
    triggerIp: '10.0.31.90',
    triggerUa: 'Edge/126.0',
  },
  {
    destination: 'digitalocean.com',
    flow: 'infra-health-sync',
    triggerIp: '10.0.31.91',
    triggerUa: 'Neqto CloudOps',
  },
  {
    destination: 'linode.com',
    flow: 'node-capacity-sync',
    triggerIp: '10.0.31.92',
    triggerUa: 'Neqto Capacity Planner',
  },
  {
    destination: 'heroku.com',
    flow: 'dyno-metrics-sync',
    triggerIp: '10.0.31.93',
    triggerUa: 'Chrome/126.0',
  },
  {
    destination: 'vercel.com',
    flow: 'deployment-status-sync',
    triggerIp: '10.0.31.94',
    triggerUa: 'Neqto Deploy Bot',
  },
  {
    destination: 'netlify.com',
    flow: 'build-hook-sync',
    triggerIp: '10.0.31.95',
    triggerUa: 'Firefox/128.0',
  },
  {
    destination: 'algolia.com',
    flow: 'search-index-sync',
    triggerIp: '10.0.31.96',
    triggerUa: 'Neqto Search Connector',
  },
  {
    destination: 'elastic.co',
    flow: 'log-shipping-sync',
    triggerIp: '10.0.31.97',
    triggerUa: 'curl/8.8.1',
  },
  {
    destination: 'splunk.com',
    flow: 'siem-forwarding',
    triggerIp: '10.0.31.98',
    triggerUa: 'Neqto SIEM Bridge',
  },
  {
    destination: 'mongodb.com',
    flow: 'oplog-audit-sync',
    triggerIp: '10.0.31.99',
    triggerUa: 'Chrome/127.0',
  },
  {
    destination: 'redis.io',
    flow: 'cache-warmup-report',
    triggerIp: '10.0.31.100',
    triggerUa: 'Neqto Cache Agent',
  },
  {
    destination: 'rabbitmq.com',
    flow: 'queue-depth-sync',
    triggerIp: '10.0.31.101',
    triggerUa: 'Neqto Queue Monitor',
  },
  {
    destination: 'kafka.apache.org',
    flow: 'event-lag-monitor',
    triggerIp: '10.0.31.102',
    triggerUa: 'Edge/127.0',
  },
  {
    destination: 'openai.com',
    flow: 'ai-usage-sync',
    triggerIp: '10.0.31.103',
    triggerUa: 'Neqto AI Gateway',
  },
  {
    destination: 'anthropic.com',
    flow: 'model-quota-sync',
    triggerIp: '10.0.31.104',
    triggerUa: 'Neqto LLM Router',
  },
  {
    destination: 'cohere.com',
    flow: 'embedding-sync',
    triggerIp: '10.0.31.105',
    triggerUa: 'Postman/11.4',
  },
  {
    destination: 'huggingface.co',
    flow: 'model-registry-sync',
    triggerIp: '10.0.31.106',
    triggerUa: 'Neqto Model Ops',
  },
  {
    destination: 'cloudinary.com',
    flow: 'media-transform-sync',
    triggerIp: '10.0.31.107',
    triggerUa: 'Chrome/128.0',
  },
  {
    destination: 'imgix.com',
    flow: 'image-cache-sync',
    triggerIp: '10.0.31.108',
    triggerUa: 'Neqto Media Proxy',
  },
  {
    destination: 'mapbox.com',
    flow: 'geo-tile-sync',
    triggerIp: '10.0.31.109',
    triggerUa: 'Neqto Maps',
  },
  {
    destination: 'tomtom.com',
    flow: 'route-cache-refresh',
    triggerIp: '10.0.31.110',
    triggerUa: 'Neqto Routing',
  }//*/
];

const streamClients = new Set();
const timeoutIds = new Set();
const eventHistory = [];

let intervalId = null;
let requestCounter = 0;
let sseEventCounter = 0;
let requestFixtureIndex = 0;
let stressModeUntil = 0;
let isShuttingDown = false;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isStressModeActive(atMs = Date.now()) {
  return atMs < stressModeUntil;
}

function pickNextStressDelayMs() {
  const minDelay = Math.max(1000, STRESS_BASE_INTERVAL_MS - STRESS_INTERVAL_JITTER_MS);
  const maxDelay = Math.max(minDelay, STRESS_BASE_INTERVAL_MS + STRESS_INTERVAL_JITTER_MS);
  return randomInt(minDelay, maxDelay);
}

function scheduleRandomStressWindow() {
  if (!STRESS_ENABLED || intervalId === null || isShuttingDown) {
    return;
  }

  const nextDelay = pickNextStressDelayMs();
  const stressTriggerTimeout = setTimeout(() => {
    timeoutIds.delete(stressTriggerTimeout);

    if (intervalId === null || isShuttingDown) {
      return;
    }

    stressModeUntil = Date.now() + STRESS_DURATION_MS;
    console.log(
      `[cockpit-mock] stress mode for ${Math.round(STRESS_DURATION_MS / 1000)}s (${STRESS_EVENT_MULTIPLIER}x events)`
    );

    scheduleRandomStressWindow();
  }, nextDelay);

  timeoutIds.add(stressTriggerTimeout);
}

function addCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Last-Event-ID,x-tenant-ref');
}

function toNdjsonFrame(event) {
  return JSON.stringify(event) + '\n';
}

function keepOnlyRecentHistory() {
  if (eventHistory.length > MAX_HISTORY_SIZE) {
    eventHistory.splice(0, eventHistory.length - MAX_HISTORY_SIZE);
  }
}

function broadcastEvent(event) {
  eventHistory.push(event);
  keepOnlyRecentHistory();

  sseEventCounter += 1;
  const frame = toNdjsonFrame(event);

  for (const client of streamClients) {
    if (client.writableEnded || client.destroyed) {
      streamClients.delete(client);
      continue;
    }

    try {
      client.write(frame);
    } catch {
      streamClients.delete(client);
      try {
        client.end();
      } catch {
        // Ignore socket close errors while cleaning up dead clients.
      }
    }
  }
}

function createRequestId() {
  requestCounter = (requestCounter + 1) % 1000;
  return Date.now() * 1000 + requestCounter;
}

function pickNextFixture() {
  const fixture = REQUEST_FIXTURES[requestFixtureIndex % REQUEST_FIXTURES.length];
  requestFixtureIndex += 1;
  return fixture;
}

function calculatePayloadSize(requestSequence) {
  return 90 + (requestSequence % 6) * 80;
}

function calculateTtfbHint(requestSequence, intendedTtfb, isLikelyTimeout = false) {
  if (isLikelyTimeout) {
    // Keep timeout-planned requests very close to the 15-minute timeout window.
    const timeoutOffsetMs = 2000 + (requestSequence % 14) * 500;
    return Math.max(1, RESPONSE_TIMEOUT_MS - timeoutOffsetMs);
  }

  // For normal requests, keep the hint tightly aligned with intended actual TTFB.
  const smallJitterMs = ((requestSequence % 5) - 2) * 4;
  return Math.max(1, intendedTtfb + smallJitterMs);
}

function calculateTtfb(requestSequence) {
    return 250 + (requestSequence % 6) * 16;
}

function calculateResponseSize(requestSequence) {
  return 1800 + (requestSequence % 7) * 100;
}

function createTimeoutEvent(requestId, requestSequence) {
  return {
    id: requestId,
    ttfb: 900000,
    response_code: 504,
  };
}

function generateRequestLifecycle() {
  const requestId = createRequestId();
  const requestSequence = requestCounter;
  const now = Date.now();
  const fixture = pickNextFixture();

  const baseEvent = {
    id: requestId,
    ts: now,
    destination: fixture.destination,
    flow: fixture.flow,
    flow_execution_id: `fx-${now}-${requestSequence}`,
    trigger_ua: fixture.triggerUa,
    trigger_ip: fixture.triggerIp,
  };

  broadcastEvent(baseEvent);

  const hintDelay = randomInt(HINT_DELAY_MIN_MS, HINT_DELAY_MAX_MS);
  let finalDelay = hintDelay + randomInt(FINAL_DELAY_MIN_MS, FINAL_DELAY_MAX_MS);
  const isLongResponse = Math.random() < LONG_RESPONSE_CHANCE;

  if (isLongResponse) {
    finalDelay = RESPONSE_TIMEOUT_MS + randomInt(LONG_RESPONSE_EXTRA_MIN_MS, LONG_RESPONSE_EXTRA_MAX_MS);
  }

  const intendedTtfb = calculateTtfb(requestSequence);

  const hintTimeout = setTimeout(() => {
    timeoutIds.delete(hintTimeout);

    const hintEvent = {
      id: requestId,
      payload_size: calculatePayloadSize(requestSequence),
      'ttfb-hint': calculateTtfbHint(requestSequence, intendedTtfb, isLongResponse),
    };

    broadcastEvent(hintEvent);
  }, hintDelay);

  timeoutIds.add(hintTimeout);

  if (finalDelay > RESPONSE_TIMEOUT_MS) {
    const timeoutEventTimer = setTimeout(() => {
      timeoutIds.delete(timeoutEventTimer);
      broadcastEvent(createTimeoutEvent(requestId, requestSequence));
    }, RESPONSE_TIMEOUT_MS);

    timeoutIds.add(timeoutEventTimer);
    return;
  }

  const finalTimeout = setTimeout(() => {
    timeoutIds.delete(finalTimeout);

    const finalEvent = {
      id: requestId,
      ttfb: intendedTtfb,
      response_size: calculateResponseSize(requestSequence),
      response_code: RESPONSE_CODES[Math.floor(Math.random() * RESPONSE_CODES.length)],
    };

    broadcastEvent(finalEvent);
  }, finalDelay);

  timeoutIds.add(finalTimeout);
}

function clearAllPendingTimeouts() {
  for (const timeoutId of timeoutIds) {
    clearTimeout(timeoutId);
  }

  timeoutIds.clear();
}

function scheduleGenerationBurst() {
  const burstMultiplier = isStressModeActive() ? STRESS_EVENT_MULTIPLIER : 1;
  const burstCount = randomInt(PARALLEL_LIFECYCLES_MIN, PARALLEL_LIFECYCLES_MAX) * burstMultiplier;

  for (let i = 0; i < burstCount; i += 1) {
    const baseDelay = i === 0 ? 0 : randomInt(0, BASE_JITTER_MAX_MS);
    const baseTimeout = setTimeout(() => {
      timeoutIds.delete(baseTimeout);
      generateRequestLifecycle();
    }, baseDelay);

    timeoutIds.add(baseTimeout);
  }
}

function ensureGeneratorStarted() {
  if (intervalId !== null) {
    return;
  }

  scheduleGenerationBurst();

  intervalId = setInterval(() => {
    scheduleGenerationBurst();
  }, GENERATION_INTERVAL_MS);

  scheduleRandomStressWindow();
}

function stopGenerator() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  stressModeUntil = 0;
  clearAllPendingTimeouts();
}

function writeJson(res, statusCode, payload) {
  addCorsHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

// function sendHistoryToClient(res, limit = 0) {
//   const recent = eventHistory.slice(-limit);

//   for (const event of recent) {
//     sseEventCounter += 1;
//     res.write(toSseFrame(event, sseEventCounter));
//   }
// }

function handleSseConnection(req, res) {
  addCorsHeaders(res);

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  // res.write('retry: 1500\n\n');
  // sendHistoryToClient(res);

  streamClients.add(res);
  ensureGeneratorStarted();

  const keepAliveTimer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(JSON.stringify({ type: 'keepalive' }) + '\n');
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    streamClients.delete(res);

    if (streamClients.size === 0) {
      stopGenerator();
    }
  });
}

function describeEndpoints() {
  return {
    service: 'cockpit-mock-server',
    stream: COCKPIT_MOCK_STREAM_PATH,
    alias_stream: COCKPIT_MOCK_STREAM_PATH_ALIAS,
    health: HEALTH_PATH,
    history_count: eventHistory.length,
    stress_enabled: STRESS_ENABLED,
    stress_active: isStressModeActive(),
    stress_multiplier: STRESS_EVENT_MULTIPLIER,
    stress_duration_ms: STRESS_DURATION_MS,
    stress_base_interval_ms: STRESS_BASE_INTERVAL_MS,
  };
}

const server = http.createServer((req, res) => {
  if (!req.url || !req.headers.host) {
    writeJson(res, 400, { error: 'Invalid request' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    addCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && (url.pathname === COCKPIT_MOCK_STREAM_PATH || url.pathname === COCKPIT_MOCK_STREAM_PATH_ALIAS)) {
    handleSseConnection(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/mock/cockpit/history') {
    writeJson(res, 200, {
      count: eventHistory.length,
      events: eventHistory,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/mock/cockpit/snapshot') {
    addCorsHeaders(res);

    const from = Number(url.searchParams.get('from')) || Date.now();
    const limit = Math.max(1, Number(url.searchParams.get('limit')) || 100);
    const snapshotId = url.searchParams.get('snapshotId') || null;

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'close',
    });

    // Spread the timestamps between 3 - 10 minutes starting from the recieved 'from' ts.
    // 'from' is the START of the window. We generate events up to 3-10 minutes AFTER 'from'.
    const durationMs = randomInt(3 * 60 * 1000, 10 * 60 * 1000);
    const to = from + durationMs;
    
    const events = [];
    for (let i = 0; i < limit; i += 1) {
      const frac = limit === 1 ? 0 : i / (limit - 1);
      // We generate from 'to' down to 'from' so they are already in descending order
      const ts = Math.round(to - Math.round(durationMs * frac));
      const fixture = pickNextFixture();
      // Ensure unique ID for snapshot events
      const id = to * 1000 + i;
      const snapshotTtfb = calculateTtfb(i);
      
      const ev = {
        id,
        ts,
        destination: fixture.destination,
        flow: fixture.flow,
        flow_execution_id: `fx-${ts}-${i}`,
        trigger_ua: fixture.triggerUa,
        trigger_ip: fixture.triggerIp,
        payload_size: calculatePayloadSize(i),
        'ttfb-hint': calculateTtfbHint(i, snapshotTtfb, false),
        ttfb: snapshotTtfb,
        response_size: calculateResponseSize(i),
        response_code: RESPONSE_CODES[i % RESPONSE_CODES.length],
      };

      events.push(ev);
    }

    // historical data is sent from most recent to oldest.
    // The loop above generated them starting from 'to' (most recent) down to 'from' (oldest).
    for (const event of events) {
      try {
        res.write(JSON.stringify(event) + '\n');
      } catch (err) {
        break;
      }
    }

    const complete = { 
      type: 'snapshot-complete', 
      snapshotId, 
      range: { fromTs: from, toTs: to }, 
      count: events.length 
    };
    try {
      res.write(JSON.stringify(complete) + '\n');
    } catch {}
    try {
      res.end();
    } catch {}
    return;
  }

  if (req.method === 'GET' && url.pathname === HEALTH_PATH) {
    writeJson(res, 200, {
      ok: true,
      generator_active: intervalId !== null,
      active_clients: streamClients.size,
      ...describeEndpoints(),
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    writeJson(res, 200, describeEndpoints());
    return;
  }

  writeJson(res, 404, { error: 'Not found' });
});

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`[cockpit-mock] shutting down (${signal})`);

  stopGenerator();

  for (const client of streamClients) {
    try {
      client.end();
    } catch {
      // Ignore close errors during shutdown.
    }
  }

  streamClients.clear();

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

server.listen(PORT, () => {
  console.log(`[cockpit-mock] listening on http://localhost:${PORT}`);
  console.log(`[cockpit-mock] stream: ${COCKPIT_MOCK_STREAM_PATH}`);
  console.log(`[cockpit-mock] alias:  ${COCKPIT_MOCK_STREAM_PATH_ALIAS}`);
  console.log('[cockpit-mock] health: /health');
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

