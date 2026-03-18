export {};

// =============================================
// PixiJS versie — GEOPTIMALISEERD
// =============================================
// Optimalisaties vs origineel:
// 1. Sprite-pool voor batch circles i.p.v. Graphics.clear()+rebuild per frame
// 2. Sprite-pool voor error circles i.p.v. Graphics.clear()+rebuild per frame
// 3. HUD text alleen updaten als waarde verandert
// 4. Highlight Graphics alleen rebuilden als selectie verandert
// 5. Gedeelde circle-texture voor alle sprites (1-2 draw calls voor alle circles)

declare const PIXI: any;

(async () => {

const wrapper = document.getElementById('canvas-wrapper')!;
const W = wrapper.clientWidth;
const H = wrapper.clientHeight;

const app = new PIXI.Application();
await app.init({
    width: W,
    height: H,
    backgroundColor: 0x111111,
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preferWebGLVersion: 2,
});
wrapper.appendChild(app.canvas);
app.canvas.id = 'canvas';
app.canvas.style.cursor = 'grab';

// World container voor zoom/pan
// OPTIMALISATIE 5: isRenderGroup = true voor efficiëntere GPU batching in PixiJS v8
const worldContainer = new PIXI.Container();
worldContainer.isRenderGroup = true;
app.stage.addChild(worldContainer);

// HUD container (niet affected door zoom/pan)
const hudContainer = new PIXI.Container();
hudContainer.isRenderGroup = true;
app.stage.addChild(hudContainer);

// Sidebar elementen
const sidebar = document.getElementById('sidebar')!;
const sidebarHeader = document.getElementById('sidebar-header')!;
const sidebarTitle = document.getElementById('sidebar-title')!;
const sidebarBody = document.getElementById('sidebar-body')!;
const sidebarClose = document.getElementById('sidebar-close')!;

sidebarClose.addEventListener('click', () => closeSidebar());

// ============================================================
// OPTIMALISATIE 1: Gedeelde circle-texture voor Sprite-pool
// In plaats van Graphics.circle() per frame (duur: tessellatie + geometry upload),
// maken we EEN texture van een cirkel en hergebruiken die als Sprite.
// Sprites zijn gewoon quads — PixiJS kan ze in 1-2 draw calls batchen.
// ============================================================
const circleGfx = new PIXI.Graphics();
circleGfx.circle(0, 0, 16);
circleGfx.fill(0xffffff);
const circleTexture = app.renderer.generateTexture(circleGfx);
circleGfx.destroy();

// Kleine rode cirkel voor errors
const errorCircleGfx = new PIXI.Graphics();
errorCircleGfx.circle(0, 0, 16);
errorCircleGfx.fill(0xf02b2b);
const errorCircleTexture = app.renderer.generateTexture(errorCircleGfx);
errorCircleGfx.destroy();

// Graphics layers - alleen highlight is dynamisch per frame
const linesGraphics = new PIXI.Graphics();
const boxesGraphics = new PIXI.Graphics();
const highlightGraphics = new PIXI.Graphics();
const labelsContainer = new PIXI.Container();

// Sprite containers voor batches en errors (Sprite-pool)
// OPTIMALISATIE 4: cullable = true zodat PixiJS objecten buiten viewport skipt
const batchSpriteContainer = new PIXI.Container();
batchSpriteContainer.cullable = true;

const errorSpriteContainer = new PIXI.Container();
errorSpriteContainer.cullable = true;

worldContainer.addChild(linesGraphics);
worldContainer.addChild(boxesGraphics);
worldContainer.addChild(batchSpriteContainer);
worldContainer.addChild(errorSpriteContainer);
worldContainer.addChild(highlightGraphics);
worldContainer.addChild(labelsContainer);

// OPTIMALISATIE 4: cullable op containers zodat PixiJS
// objecten buiten viewport niet rendert
labelsContainer.cullable = true;

// === Color parse helper ===
function hexToNum(hex: string): number {
    return parseInt(hex.slice(1), 16);
}

function hexToRgb(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

// === Boxen ===
interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    color: string;
    colorNum: number;
    rgb: [number, number, number];
    connections: number[];
    labelText?: any;
}

const BOX_W = 70;
const BOX_H = 35;
const SMALL_BOX_W = 50;
const SMALL_BOX_H = 28;
const BOX_SPACING = 15;

const boxColors = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#e11d48', '#0ea5e9', '#d946ef', '#10b981',
    '#facc15', '#8b5cf6', '#fb923c', '#2dd4bf', '#f43f5e',
    '#4ade80', '#818cf8', '#fbbf24', '#38bdf8', '#c084fc',
];

let boxes: Box[] = [];

const WORLD_W = W * 5;
const WORLD_H = H * 5;

function boxesOverlap(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
): boolean {
    return !(
        a.x + a.w + BOX_SPACING < b.x ||
        b.x + b.w + BOX_SPACING < a.x ||
        a.y + a.h + BOX_SPACING < b.y ||
        b.y + b.h + BOX_SPACING < a.y
    );
}

function generateBoxes(count: number) {
    for (const box of boxes) {
        if (box.labelText) {
            labelsContainer.removeChild(box.labelText);
            box.labelText.destroy();
        }
    }

    boxes = [];
    for (let i = 0; i < count; i++) {
        const isSmall = i >= Math.ceil(count / 3);
        const w = isSmall ? SMALL_BOX_W : BOX_W;
        const h = isSmall ? SMALL_BOX_H : BOX_H;
        let placed = false;
        for (let attempt = 0; attempt < 300; attempt++) {
            const x = Math.random() * (WORLD_W - w);
            const y = Math.random() * (WORLD_H - h);
            const candidate = { x, y, w, h };
            if (!boxes.some((b) => boxesOverlap(candidate, b))) {
                const color = boxColors[i % boxColors.length];
                const lbl = i < 26 ? String.fromCharCode(65 + i) : `${i + 1}`;
                // OPTIMALISATIE 3: BitmapText i.p.v. PIXI.Text
                // BitmapText deelt 1 font atlas texture vs 75+ individuele canvassen
                const labelText = new PIXI.BitmapText({
                    text: lbl,
                    style: {
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fill: 0xffffff,
                    }
                });
                labelText.anchor.set(0.5, 0.5);
                labelText.x = x + w / 2;
                labelText.y = y + h / 2;
                labelsContainer.addChild(labelText);

                boxes.push({
                    x, y, w, h,
                    label: lbl,
                    color,
                    colorNum: hexToNum(color),
                    rgb: hexToRgb(color),
                    connections: [],
                    labelText,
                });
                placed = true;
                break;
            }
        }
        if (!placed) break;
    }

    for (let i = 0; i < boxes.length; i++) {
        const numConnections = 2 + Math.floor(Math.random() * 3);
        const available = Array.from({ length: boxes.length }, (_, k) => k).filter((k) => k !== i);
        for (let c = 0; c < numConnections && available.length > 0; c++) {
            const pick = Math.floor(Math.random() * available.length);
            const target = available[pick];
            available.splice(pick, 1);
            if (!boxes[i].connections.includes(target)) {
                boxes[i].connections.push(target);
            }
            if (!boxes[target].connections.includes(i)) {
                boxes[target].connections.push(i);
            }
        }
    }

    drawStaticBoxes();
    drawStaticLines();

    // OPTIMALISATIE 2: cacheAsTexture op statische Graphics
    // Lines en boxes veranderen niet tot reset — cache als texture = 1 quad draw i.p.v. tessellatie
    linesGraphics.cacheAsTexture(true);
    boxesGraphics.cacheAsTexture(true);
}

function boxCenterX(b: Box) { return b.x + b.w / 2; }
function boxCenterY(b: Box) { return b.y + b.h / 2; }

// === Batches ===
interface Batch {
    requestId?: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    startTime: number;
    duration: number;
    rgb: [number, number, number];
    colorNum: number;
    fromIdx: number;
    toIdx: number;
    radius: number;
}

interface TrafficBaseEvent {
    id: string;
    ts: number;
    destination: string;
    flow: string;
    flow_execution_id: string;
    trigger_ua?: string;
    trigger_ip?: string;
}

interface TrafficHintEvent {
    id: string;
    payload_size: number;
    'ttfb-hint'?: number;
}

interface TrafficFinalEvent {
    id: string;
    ttfb: number;
    response_size: number;
    response_code: number;
}

interface StreamHintEvent {
    server_ts: number;
    utc_date: string;
    available_range: { from: number; to: number };
    format: string;
}

interface TimelineRecord {
    id: string;
    base?: TrafficBaseEvent;
    hint?: TrafficHintEvent;
    final?: TrafficFinalEvent;
    receivedAt: number;
}

// === Errors ===
interface ErrorEntry {
    id: number;
    message: string;
    severity: string;
    timestamp: number;
    fromIdx: number;
    toIdx: number;
}

interface BoxErrors {
    x: number;
    y: number;
    boxIdx: number;
    entries: ErrorEntry[];
}

let errorIdCounter = 0;
const ERROR_CHANCE = 0.003;
const errorMessages = [
    'Timeout exceeded', 'Connection refused', 'Data corruption detected',
    'Buffer overflow', 'Authentication failed', 'Rate limit exceeded',
    'Checksum mismatch', 'Service unavailable', 'Packet loss detected',
    'Memory allocation error',
];
const errorSeverities = ['Low', 'Medium', 'High', 'Critical'];

let boxErrorsMap: Map<number, BoxErrors> = new Map();

function getErrorPosition(box: Box): { x: number; y: number } {
    return { x: box.x + box.w + 10, y: box.y - 5 };
}

let activePopupBox: Box | null = null;
let activePopupLine: { from: Box; to: Box } | null = null;
let activePopupBatch: Batch | null = null;
let activePopupErrors: BoxErrors | null = null;

function addError(fromIdx: number, toIdx: number) {
    const box = boxes[toIdx];
    const entry: ErrorEntry = {
        id: errorIdCounter++,
        message: errorMessages[Math.floor(Math.random() * errorMessages.length)],
        severity: errorSeverities[Math.floor(Math.random() * errorSeverities.length)],
        timestamp: Date.now(),
        fromIdx,
        toIdx,
    };

    if (!boxErrorsMap.has(toIdx)) {
        const pos = getErrorPosition(box);
        boxErrorsMap.set(toIdx, { x: pos.x, y: pos.y, boxIdx: toIdx, entries: [] });
    }
    boxErrorsMap.get(toIdx)!.entries.push(entry);

    if (activePopupErrors && activePopupErrors.boxIdx === toIdx) {
        refreshErrorSidebar(activePopupErrors);
    }
}

let batches: Batch[] = [];

const STREAM_URL = 'http://localhost:8787/api/traffic/stream';
let streamMode = false;
let streamConnected = false;
let streamStatusText = 'Stream: random fallback';
let streamHintInfo: StreamHintEvent | null = null;
let streamReconnectTimer: number | null = null;

const requestsById = new Map<string, Batch>();
const streamFlows = new Set<string>();
const streamDestinations = new Set<string>();
let lastAutoBoxCount = 0;

const timelineById = new Map<string, TimelineRecord>();
const timelineOrder: TimelineRecord[] = [];
const bufferedLiveIds: string[] = [];
const replayQueue: TrafficBaseEvent[] = [];
let timelineRangeStart = 0;
let timelineRangeEnd = 0;
let timelinePlayheadTs = 0;
let isLivePinned = true;
let timelineLoading = false;
const MAX_TIMELINE_RECORDS = 1600;

let connectionEdges: [number, number][] = [];

function buildConnectionEdges() {
    connectionEdges = [];
    const seen = new Set<string>();
    for (let i = 0; i < boxes.length; i++) {
        for (const j of boxes[i].connections) {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (!seen.has(key)) {
                seen.add(key);
                connectionEdges.push([i, j]);
            }
        }
    }
}

function randomBoxBatch(now: number): Batch {
    const edge = connectionEdges[Math.floor(Math.random() * connectionEdges.length)];
    const [fromIdx, toIdx] = Math.random() < 0.5 ? [edge[0], edge[1]] : [edge[1], edge[0]];
    const from = boxes[fromIdx];
    const to = boxes[toIdx];

    return {
        startX: boxCenterX(from),
        startY: boxCenterY(from),
        endX: boxCenterX(to),
        endY: boxCenterY(to),
        startTime: now,
        duration: 1500 + Math.random() * 3500,
        rgb: from.rgb,
        colorNum: from.colorNum,
        fromIdx,
        toIdx,
        radius: 6,
    };
}

function initBatches() {
    batches = [];
    requestsById.clear();
    const now = performance.now();
    const target = fallbackBatchTarget();
    for (let i = 0; i < target; i++) {
        const batch = randomBoxBatch(now);
        if (Math.random() < 0.7) {
            batch.startTime = now - Math.random() * 0.8 * batch.duration;
        } else {
            batch.startTime = now + Math.random() * 3000;
        }
        batches.push(batch);
    }
}

function hashString(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function radiusFromBytes(bytes: number): number {
    // Small logarithmic scale so very large payloads stay visually manageable.
    const scaled = Math.log2(Math.max(32, bytes)) - 4;
    return clamp(4 + scaled, 4, 14);
}

function fallbackBatchTarget(): number {
    return clamp(Math.floor(boxes.length * 1.4), 10, 220);
}

function autoBoxCountFromStream(): number {
    // Weighted by stream cardinality: more unique flows/destinations yields richer topology.
    const weighted = streamFlows.size * 5 + streamDestinations.size * 6;
    return clamp(weighted, 8, 140);
}

function syncBoxesToStreamData(force = false) {
    const nextCount = autoBoxCountFromStream();
    const shouldRebuild = force || boxes.length === 0 || Math.abs(nextCount - boxes.length) >= 3;
    if (!shouldRebuild) return;

    generateBoxes(nextCount);
    buildConnectionEdges();
    boxErrorsMap = new Map();
    batches = [];
    requestsById.clear();
    closePopup();
    lastAutoBoxCount = nextCount;
}

function formatClock(ts: number): string {
    if (!ts) return '--:--:--';
    return new Date(ts).toLocaleTimeString();
}

function updateTimelineRange(ts: number) {
    if (!Number.isFinite(ts) || ts <= 0) return;
    if (timelineRangeStart === 0 || ts < timelineRangeStart) timelineRangeStart = ts;
    if (timelineRangeEnd === 0 || ts > timelineRangeEnd) timelineRangeEnd = ts;
    if (isLivePinned) {
        timelinePlayheadTs = timelineRangeEnd;
    }
}

function upsertTimelineRecord(id: string): TimelineRecord {
    const existing = timelineById.get(id);
    if (existing) {
        existing.receivedAt = performance.now();
        return existing;
    }
    const created: TimelineRecord = { id, receivedAt: performance.now() };
    timelineById.set(id, created);
    timelineOrder.push(created);

    if (timelineOrder.length > MAX_TIMELINE_RECORDS) {
        const drop = timelineOrder.shift();
        if (drop) {
            timelineById.delete(drop.id);
            const idx = bufferedLiveIds.indexOf(drop.id);
            if (idx >= 0) bufferedLiveIds.splice(idx, 1);
        }
    }
    return created;
}

function enqueueReplayAt(targetTs: number) {
    replayQueue.length = 0;
    const start = targetTs - 20_000;
    const end = targetTs + 45_000;
    const items = timelineOrder
        .filter((r) => !!r.base && r.base!.ts >= start && r.base!.ts <= end)
        .sort((a, b) => (a.base!.ts - b.base!.ts));
    for (const item of items) {
        replayQueue.push(item.base!);
    }
}

function setTimelineLoading(next: boolean) {
    timelineLoading = next;
    if (timelineLoadingEl) {
        timelineLoadingEl.classList.toggle('hidden', !next);
    }
}

function applyTimelineSelection(targetTs: number) {
    if (!timelineRangeStart || !timelineRangeEnd) return;
    isLivePinned = false;
    timelinePlayheadTs = clamp(targetTs, timelineRangeStart, timelineRangeEnd);
    setTimelineLoading(true);

    batches = [];
    requestsById.clear();
    replayQueue.length = 0;

    window.setTimeout(() => {
        enqueueReplayAt(timelinePlayheadTs);
        setTimelineLoading(false);
    }, 650);
}

function pinToLive() {
    replayQueue.length = 0;
    setTimelineLoading(false);
    isLivePinned = true;
    timelinePlayheadTs = timelineRangeEnd;
    setPausedState(false);

    // Build an immediate on-screen burst from buffered + latest known base events.
    const bufferedRecentIds = bufferedLiveIds.slice(-90);
    bufferedLiveIds.length = 0;
    const immediateEvents: TrafficBaseEvent[] = [];

    for (const id of bufferedRecentIds) {
        const rec = timelineById.get(id);
        if (rec?.base) immediateEvents.push(rec.base);
    }

    if (immediateEvents.length < 30) {
        const latestKnown = timelineOrder.filter((r) => !!r.base).slice(-80);
        for (const item of latestKnown) {
            if (item.base) immediateEvents.push(item.base);
        }
    }

    const dedup = new Map<string, TrafficBaseEvent>();
    for (const ev of immediateEvents) dedup.set(ev.id, ev);
    const burst = Array.from(dedup.values())
        .sort((a, b) => a.ts - b.ts)
        .slice(-45);

    batches = [];
    requestsById.clear();
    for (const ev of burst) {
        renderBaseEvent(ev);
    }
}

function edgeForRequest(base: TrafficBaseEvent): [number, number] {
    if (connectionEdges.length === 0) return [0, 0];
    const key = `${base.id}-${base.flow}-${base.destination}`;
    const idx = hashString(key) % connectionEdges.length;
    return connectionEdges[idx];
}

function renderBaseEvent(base: TrafficBaseEvent) {
    if (boxes.length === 0 || connectionEdges.length === 0) return;

    const [fromIdx, toIdx] = edgeForRequest(base);
    const from = boxes[fromIdx];
    const to = boxes[toIdx];
    const batch: Batch = {
        requestId: base.id,
        startX: boxCenterX(from),
        startY: boxCenterY(from),
        endX: boxCenterX(to),
        endY: boxCenterY(to),
        startTime: performance.now(),
        duration: 900,
        rgb: from.rgb,
        colorNum: from.colorNum,
        fromIdx,
        toIdx,
        radius: 6,
    };

    const rec = timelineById.get(base.id);
    if (rec?.hint) {
        batch.radius = radiusFromBytes(rec.hint.payload_size);
        if (typeof rec.hint['ttfb-hint'] === 'number') {
            batch.duration = clamp(rec.hint['ttfb-hint'] * 3, 300, 2400);
        }
    }
    if (rec?.final) {
        batch.duration = clamp(rec.final.ttfb * 3, 250, 4000);
        batch.radius = radiusFromBytes(rec.final.response_size);
    }

    batches.push(batch);
    requestsById.set(base.id, batch);
}

function isTrafficBaseEvent(v: any): v is TrafficBaseEvent {
    return v && typeof v.id === 'string' && typeof v.ts === 'number' && typeof v.destination === 'string' && typeof v.flow === 'string';
}

function isTrafficHintEvent(v: any): v is TrafficHintEvent {
    return v && typeof v.id === 'string' && typeof v.payload_size === 'number';
}

function isTrafficFinalEvent(v: any): v is TrafficFinalEvent {
    return v && typeof v.id === 'string' && typeof v.ttfb === 'number' && typeof v.response_code === 'number';
}

function isStreamHintEvent(v: any): v is StreamHintEvent {
    return v && typeof v.server_ts === 'number' && typeof v.utc_date === 'string' && v.available_range;
}

function handleTrafficBaseEvent(base: TrafficBaseEvent) {
    const rec = upsertTimelineRecord(base.id);
    rec.base = base;
    updateTimelineRange(base.ts);

    const newFlow = !streamFlows.has(base.flow);
    const newDestination = !streamDestinations.has(base.destination);
    if (newFlow) streamFlows.add(base.flow);
    if (newDestination) streamDestinations.add(base.destination);
    if (isLivePinned && (newFlow || newDestination || boxes.length === 0 || connectionEdges.length === 0)) {
        syncBoxesToStreamData();
    }

    if (paused || !isLivePinned || timelineLoading) {
        bufferedLiveIds.push(base.id);
        if (bufferedLiveIds.length > MAX_TIMELINE_RECORDS) {
            bufferedLiveIds.splice(0, bufferedLiveIds.length - MAX_TIMELINE_RECORDS);
        }
        return;
    }

    renderBaseEvent(base);
}

function handleTrafficHintEvent(hint: TrafficHintEvent) {
    const rec = upsertTimelineRecord(hint.id);
    rec.hint = hint;

    const batch = requestsById.get(hint.id);
    if (!batch) return;

    batch.radius = radiusFromBytes(hint.payload_size);
    if (typeof hint['ttfb-hint'] === 'number') {
        batch.duration = clamp(hint['ttfb-hint'] * 3, 300, 2400);
    }
}

function handleTrafficFinalEvent(finalEvent: TrafficFinalEvent) {
    const rec = upsertTimelineRecord(finalEvent.id);
    rec.final = finalEvent;

    const batch = requestsById.get(finalEvent.id);
    if (!batch) return;

    batch.duration = clamp(finalEvent.ttfb * 3, 250, 4000);
    batch.radius = radiusFromBytes(finalEvent.response_size);

    if (finalEvent.response_code >= 400) {
        addError(batch.fromIdx, batch.toIdx);
    }
}

function openTrafficStream() {
    try {
        const source = new EventSource(STREAM_URL);
        streamMode = true;
        streamStatusText = 'Stream: connecting';

        source.addEventListener('open', () => {
            streamConnected = true;
            streamStatusText = 'Stream: connected';
            streamFlows.clear();
            streamDestinations.clear();
            timelineById.clear();
            timelineOrder.length = 0;
            bufferedLiveIds.length = 0;
            replayQueue.length = 0;
            timelineRangeStart = 0;
            timelineRangeEnd = 0;
            timelinePlayheadTs = 0;
            isLivePinned = true;
            batches = [];
            requestsById.clear();
            syncBoxesToStreamData(true);
            setTimelineLoading(false);
        });

        source.addEventListener('hint', (ev: MessageEvent) => {
            try {
                const parsed = JSON.parse(ev.data);
                if (isStreamHintEvent(parsed)) {
                    streamHintInfo = parsed;
                    if (timelineRangeStart === 0) {
                        timelineRangeStart = parsed.available_range.from;
                    }
                    timelineRangeEnd = Math.max(timelineRangeEnd, parsed.available_range.to);
                    if (isLivePinned) timelinePlayheadTs = timelineRangeEnd;
                }
            } catch {
                // Keep rendering, ignore malformed hint payloads.
            }
        });

        source.addEventListener('ndjson', (ev: MessageEvent) => {
            try {
                const parsed = JSON.parse(ev.data);
                if (isTrafficBaseEvent(parsed)) {
                    handleTrafficBaseEvent(parsed);
                    return;
                }
                if (isTrafficHintEvent(parsed)) {
                    handleTrafficHintEvent(parsed);
                    return;
                }
                if (isTrafficFinalEvent(parsed)) {
                    handleTrafficFinalEvent(parsed);
                }
            } catch {
                // Keep rendering, ignore malformed event payloads.
            }
        });

        source.addEventListener('error', () => {
            streamConnected = false;
            streamStatusText = 'Stream: disconnected (retrying)';
            source.close();
            if (streamReconnectTimer !== null) window.clearTimeout(streamReconnectTimer);
            streamReconnectTimer = window.setTimeout(() => openTrafficStream(), 1500);
        });
    } catch {
        streamMode = false;
        streamConnected = false;
        streamStatusText = 'Stream: random fallback';
    }
}

// Draw static elements
function drawStaticLines() {
    linesGraphics.cacheAsTexture(false);
    linesGraphics.clear();
    linesGraphics.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.15 });

    for (const [i, j] of connectionEdges) {
        linesGraphics.moveTo(boxCenterX(boxes[i]), boxCenterY(boxes[i]));
        linesGraphics.lineTo(boxCenterX(boxes[j]), boxCenterY(boxes[j]));
    }
    linesGraphics.stroke();
}

function drawStaticBoxes() {
    boxesGraphics.cacheAsTexture(false);
    boxesGraphics.clear();
    for (const box of boxes) {
        boxesGraphics.rect(box.x, box.y, box.w, box.h);
        boxesGraphics.fill(box.colorNum);
        boxesGraphics.rect(box.x, box.y, box.w, box.h);
        boxesGraphics.stroke({ width: 2, color: 0xffffff });
    }
}

// ============================================================
// OPTIMALISATIE 2: Sprite-pool voor batch circles
// Pre-alloceer Sprites en toggle visible + positie per frame.
// Geen Graphics.clear() / tessellatie meer per frame.
// ============================================================
const batchSpritePool: any[] = [];
const BATCH_SPRITE_RADIUS = 6;
const BATCH_SPRITE_SCALE = BATCH_SPRITE_RADIUS / 16; // circleTexture radius = 16

function ensureBatchSpritePool(needed: number) {
    while (batchSpritePool.length < needed) {
        const s = new PIXI.Sprite(circleTexture);
        s.anchor.set(0.5, 0.5);
        s.scale.set(BATCH_SPRITE_SCALE);
        s.visible = false;
        batchSpriteContainer.addChild(s);
        batchSpritePool.push(s);
    }
}
ensureBatchSpritePool(200);

// ============================================================
// OPTIMALISATIE 3: Sprite-pool voor error circles + labels
// ============================================================
const errorSpritePool: { sprite: any; label: any }[] = [];
const ERROR_SPRITE_RADIUS = 9;
const ERROR_SPRITE_SCALE = ERROR_SPRITE_RADIUS / 16;

function ensureErrorSpritePool(needed: number) {
    while (errorSpritePool.length < needed) {
        const s = new PIXI.Sprite(errorCircleTexture);
        s.anchor.set(0.5, 0.5);
        s.scale.set(ERROR_SPRITE_SCALE);
        s.visible = false;
        errorSpriteContainer.addChild(s);

        const t = new PIXI.BitmapText({ text: '', style: { fontFamily: 'monospace', fontSize: 11, fill: 0xffffff } });
        t.anchor.set(0.5, 0.5);
        t.visible = false;
        errorSpriteContainer.addChild(t);

        errorSpritePool.push({ sprite: s, label: t });
    }
}
ensureErrorSpritePool(20);

generateBoxes(8);
buildConnectionEdges();
initBatches();
openTrafficStream();

// === UI Controls ===
const timelineTrackEl = document.getElementById('timeline-track') as HTMLElement | null;
const timelineBufferEl = document.getElementById('timeline-buffer') as HTMLElement | null;
const timelineCursorEl = document.getElementById('timeline-cursor') as HTMLElement | null;
const timelineCurrentEl = document.getElementById('timeline-current') as HTMLElement | null;
const timelineLoadingEl = document.getElementById('timeline-loading') as HTMLElement | null;
const liveIndicatorEl = document.getElementById('live-indicator') as HTMLElement | null;
const btnLive = document.getElementById('btn-live') as HTMLButtonElement | null;

if (timelineTrackEl) {
    timelineTrackEl.addEventListener('click', (ev: MouseEvent) => {
        if (!timelineRangeStart || !timelineRangeEnd || timelineRangeEnd <= timelineRangeStart) return;
        const rect = timelineTrackEl.getBoundingClientRect();
        const ratio = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
        const targetTs = timelineRangeStart + (timelineRangeEnd - timelineRangeStart) * ratio;
        applyTimelineSelection(targetTs);
    });
}

if (btnLive) {
    btnLive.addEventListener('click', () => {
        pinToLive();
    });
}

// === Pause ===
let paused = false;
let pauseTimeOffset = 0;
let pauseStartTime = 0;

const btnPause = document.getElementById('btn-pause')!;

function setPausedState(nextPaused: boolean) {
    if (nextPaused === paused) return;
    paused = nextPaused;

    if (paused) {
        if (isLivePinned) {
            // Like a live stream player: pausing drops you behind live while new data keeps buffering.
            isLivePinned = false;
            timelinePlayheadTs = timelineRangeEnd;
        }
        pauseStartTime = performance.now();
        btnPause.innerHTML = '&#9654; Hervat';
        btnPause.classList.add('paused');
        return;
    }

    pauseTimeOffset += performance.now() - pauseStartTime;
    setTimelineLoading(false);
    btnPause.innerHTML = '&#10074;&#10074; Pauze';
    btnPause.classList.remove('paused');
}

btnPause.addEventListener('click', () => {
    setPausedState(!paused);
});

// === Zoom & Pan ===
let zoomLevel = 1;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 15;
let panX = 0;
let panY = 0;

const zoomLabel = document.getElementById('zoom-level')!;

function updateZoomLabel() {
    zoomLabel.textContent = `Zoom: ${Math.round(zoomLevel * 100)}%`;
}

function applyTransform() {
    worldContainer.x = panX;
    worldContainer.y = panY;
    worldContainer.scale.set(zoomLevel, zoomLevel);
}

const canvasEl = app.canvas as HTMLCanvasElement;

canvasEl.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(zoomLevel * factor, ZOOM_MIN), ZOOM_MAX);

    const rect = canvasEl.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) - panX) / zoomLevel;
    const mouseY = ((e.clientY - rect.top) - panY) / zoomLevel;

    zoomLevel = newZoom;
    panX = (e.clientX - rect.left) - mouseX * zoomLevel;
    panY = (e.clientY - rect.top) - mouseY * zoomLevel;

    applyTransform();
    updateZoomLabel();
}, { passive: false });

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let mouseDownX = 0;
let mouseDownY = 0;

canvasEl.addEventListener('mousedown', (e) => {
    isDragging = true;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    canvasEl.style.cursor = 'grabbing';
});

canvasEl.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;

    const minPanX = W - WORLD_W * zoomLevel;
    const minPanY = H - WORLD_H * zoomLevel;
    panX = Math.min(0, Math.max(minPanX, panX));
    panY = Math.min(0, Math.max(minPanY, panY));
    applyTransform();
});

canvasEl.addEventListener('mouseup', (e) => {
    const wasDrag = Math.abs(e.clientX - mouseDownX) > 5 || Math.abs(e.clientY - mouseDownY) > 5;
    isDragging = false;
    canvasEl.style.cursor = 'grab';

    if (!wasDrag) {
        const rect = canvasEl.getBoundingClientRect();
        const clickScreenX = e.clientX - rect.left;
        const clickScreenY = e.clientY - rect.top;
        const worldX = (clickScreenX - panX) / zoomLevel;
        const worldY = (clickScreenY - panY) / zoomLevel;

        let clickedBox: Box | null = null;
        for (const box of boxes) {
            if (worldX >= box.x && worldX <= box.x + box.w &&
                worldY >= box.y && worldY <= box.y + box.h) {
                clickedBox = box;
                break;
            }
        }

        if (clickedBox) {
            openBoxPopup(clickedBox);
        } else {
            const clickedError = findClickedError(worldX, worldY);
            if (clickedError) {
                openErrorPopup(clickedError);
            } else {
                const clickedBatch = findClickedBatch(worldX, worldY);
                if (clickedBatch) {
                    openBatchPopup(clickedBatch);
                } else {
                    const clickedLine = findClickedLine(worldX, worldY);
                    if (clickedLine) {
                        openLinePopup(clickedLine.from, clickedLine.to);
                    } else {
                        closePopup();
                    }
                }
            }
        }
    }
});

canvasEl.addEventListener('mouseleave', () => {
    isDragging = false;
    canvasEl.style.cursor = 'grab';
});

// === Mock data & Popup ===
const mockStatuses = ['Active', 'Idle', 'Processing', 'Waiting', 'Complete'];
const mockTypes = ['Sensor', 'Controller', 'Gateway', 'Relay', 'Hub'];

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function findClickedLine(worldX: number, worldY: number): { from: Box; to: Box } | null {
    const threshold = 8 / zoomLevel;
    const drawn = new Set<string>();
    let best: { from: Box; to: Box; dist: number } | null = null;
    for (let i = 0; i < boxes.length; i++) {
        for (const j of boxes[i].connections) {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (drawn.has(key)) continue;
            drawn.add(key);
            const dist = pointToSegmentDist(
                worldX, worldY,
                boxCenterX(boxes[i]), boxCenterY(boxes[i]),
                boxCenterX(boxes[j]), boxCenterY(boxes[j])
            );
            if (dist < threshold && (!best || dist < best.dist)) {
                best = { from: boxes[i], to: boxes[j], dist };
            }
        }
    }
    return best;
}

const batchPosPool: { x: number; y: number; batch: Batch | null }[] = [];
for (let i = 0; i < 1000; i++) batchPosPool.push({ x: 0, y: 0, batch: null });
let lastBatchPosCount = 0;

function findClickedBatch(worldX: number, worldY: number): Batch | null {
    const threshold = 10 / zoomLevel;
    const threshSq = threshold * threshold;
    for (let i = 0; i < lastBatchPosCount; i++) {
        const bp = batchPosPool[i];
        const dx = worldX - bp.x, dy = worldY - bp.y;
        if (dx * dx + dy * dy < threshSq) return bp.batch;
    }
    return null;
}

function findClickedError(worldX: number, worldY: number): BoxErrors | null {
    const threshold = 12 / zoomLevel;
    for (const [, err] of boxErrorsMap) {
        const dist = Math.hypot(worldX - err.x, worldY - err.y);
        if (dist < threshold) return err;
    }
    return null;
}

function getMockData(box: Box) {
    const seed = box.label.charCodeAt(0);
    return {
        type: mockTypes[seed % mockTypes.length],
        status: mockStatuses[seed % mockStatuses.length],
        throughput: `${(seed * 37) % 900 + 100} msg/s`,
        latency: `${(seed * 13) % 50 + 5} ms`,
        uptime: `${(seed * 7) % 99 + 1}%`,
        connections: box.connections.length,
        lastSeen: `${seed % 60}s ago`,
    };
}

const controls = document.getElementById('controls')!;

// ============================================================
// OPTIMALISATIE 4: Highlight dirty flag
// Alleen highlightGraphics.clear()+rebuild als selectie verandert
// ============================================================
let highlightDirty = true;

function closePopup() {
    activePopupBox = null;
    activePopupLine = null;
    activePopupBatch = null;
    activePopupErrors = null;
    highlightDirty = true;
    sidebar.classList.add('empty');
    controls.classList.remove('shifted');
    sidebarHeader.style.display = 'none';
    sidebarBody.innerHTML = '<div id="sidebar-placeholder">Klik op een box, lijn, batch of error<br>om details te zien</div>';
}

function openSidebar() {
    sidebar.classList.remove('empty');
    controls.classList.add('shifted');
    sidebarHeader.style.display = 'flex';
}

const closeSidebar = closePopup;

function openBoxPopup(box: Box) {
    closePopup();
    highlightDirty = true;

    const CLICK_ZOOM = 3;
    const cx = boxCenterX(box);
    const cy = boxCenterY(box);

    zoomLevel = CLICK_ZOOM;
    panX = W / 2 - cx * zoomLevel;
    panY = H / 2 - cy * zoomLevel;

    const minPanX = W - WORLD_W * zoomLevel;
    const minPanY = H - WORLD_H * zoomLevel;
    panX = Math.min(0, Math.max(minPanX, panX));
    panY = Math.min(0, Math.max(minPanY, panY));
    applyTransform();
    updateZoomLabel();

    const data = getMockData(box);

    openSidebar();
    sidebarTitle.innerHTML = `<span style="color: ${box.color}">&#9632;</span> Box ${box.label}`;
    sidebarBody.innerHTML = `
        <table>
            <tr><td>Type</td><td>${data.type}</td></tr>
            <tr><td>Status</td><td>${data.status}</td></tr>
            <tr><td>Throughput</td><td>${data.throughput}</td></tr>
            <tr><td>Latency</td><td>${data.latency}</td></tr>
            <tr><td>Uptime</td><td>${data.uptime}</td></tr>
            <tr><td>Connections</td><td>${data.connections}</td></tr>
            <tr><td>Last seen</td><td>${data.lastSeen}</td></tr>
        </table>
    `;

    activePopupBox = box;
}

function openLinePopup(from: Box, to: Box) {
    closePopup();
    highlightDirty = true;

    const CLICK_ZOOM = 3;
    const mx = (boxCenterX(from) + boxCenterX(to)) / 2;
    const my = (boxCenterY(from) + boxCenterY(to)) / 2;

    zoomLevel = CLICK_ZOOM;
    panX = W / 2 - mx * zoomLevel;
    panY = H / 2 - my * zoomLevel;

    const minPanX = W - WORLD_W * zoomLevel;
    const minPanY = H - WORLD_H * zoomLevel;
    panX = Math.min(0, Math.max(minPanX, panX));
    panY = Math.min(0, Math.max(minPanY, panY));
    applyTransform();
    updateZoomLabel();

    const dx = boxCenterX(to) - boxCenterX(from);
    const dy = boxCenterY(to) - boxCenterY(from);
    const distance = Math.round(Math.sqrt(dx * dx + dy * dy));

    openSidebar();
    sidebarTitle.innerHTML = `<span style="color:${from.color}">${from.label}</span> &rarr; <span style="color:${to.color}">${to.label}</span>`;
    sidebarBody.innerHTML = `
        <table>
            <tr><td>From</td><td>Box ${from.label}</td></tr>
            <tr><td>To</td><td>Box ${to.label}</td></tr>
            <tr><td>Distance</td><td>${distance} units</td></tr>
            <tr><td>Latency</td><td>${(distance % 40) + 5} ms</td></tr>
            <tr><td>Status</td><td>${mockStatuses[(from.label.charCodeAt(0) + to.label.charCodeAt(0)) % mockStatuses.length]}</td></tr>
        </table>
    `;

    activePopupLine = { from, to };
}

function openBatchPopup(batch: Batch) {
    closePopup();
    highlightDirty = true;

    const fromBox = boxes[batch.fromIdx];
    const toBox = boxes[batch.toIdx];

    openSidebar();
    sidebarTitle.innerHTML = `&#9679; Batch`;
    sidebarBody.innerHTML = `
        <table>
            <tr><td>From</td><td><span style="color:${fromBox.color}">Box ${fromBox.label}</span></td></tr>
            <tr><td>To</td><td><span style="color:${toBox.color}">Box ${toBox.label}</span></td></tr>
            <tr><td>Duration</td><td>${Math.round(batch.duration)} ms</td></tr>
            <tr><td>Speed</td><td>${Math.round(Math.hypot(batch.endX - batch.startX, batch.endY - batch.startY) / batch.duration * 1000)} u/s</td></tr>
        </table>
    `;

    activePopupBatch = batch;
}

function refreshErrorSidebar(errors: BoxErrors) {
    const box = boxes[errors.boxIdx];

    const severityCount: Record<string, number> = {};
    for (const e of errors.entries) {
        severityCount[e.severity] = (severityCount[e.severity] || 0) + 1;
    }

    const errListHtml = errors.entries.slice(-20).reverse().map((e) => {
        const sevColor = e.severity === 'Critical' ? '#ef4444' : e.severity === 'High' ? '#f97316' : e.severity === 'Medium' ? '#facc15' : '#84cc16';
        const time = new Date(e.timestamp).toLocaleTimeString();
        return `<div style="margin-bottom:8px;padding:6px 8px;background:#1a1a2e;border-radius:4px;border-left:3px solid ${sevColor}">
            <div style="color:#aaa;font-size:11px">${time} &middot; <span style="color:${sevColor}">${e.severity}</span></div>
            <div style="color:#eee;margin-top:2px">${e.message}</div>
            <div style="color:#666;font-size:11px">from Box ${boxes[e.fromIdx].label}</div>
        </div>`;
    }).join('');

    sidebarTitle.innerHTML = `<span style="color:#ef4444">&#9888;</span> Errors \u2014 Box ${box.label} <span style="background:#ef4444;color:white;border-radius:10px;padding:1px 8px;font-size:12px;margin-left:6px">${errors.entries.length}</span>`;
    sidebarBody.innerHTML = `
        <table style="margin-bottom:12px">
            <tr><td>Total errors</td><td>${errors.entries.length}</td></tr>
            ${Object.entries(severityCount).map(([sev, cnt]) => `<tr><td>${sev}</td><td>${cnt}</td></tr>`).join('')}
        </table>
        <div style="font-size:12px;color:#888;margin-bottom:8px">Recente errors (max 20):</div>
        <div style="max-height:300px;overflow-y:auto">${errListHtml}</div>
    `;
}

function openErrorPopup(errors: BoxErrors) {
    closePopup();
    highlightDirty = true;

    const CLICK_ZOOM = 3;
    const cx = errors.x;
    const cy = errors.y;
    zoomLevel = CLICK_ZOOM;
    panX = W / 2 - cx * zoomLevel;
    panY = H / 2 - cy * zoomLevel;
    const minPanX = W - WORLD_W * zoomLevel;
    const minPanY = H - WORLD_H * zoomLevel;
    panX = Math.min(0, Math.max(minPanX, panX));
    panY = Math.min(0, Math.max(minPanY, panY));
    applyTransform();
    updateZoomLabel();

    openSidebar();
    refreshErrorSidebar(errors);

    activePopupErrors = errors;
}

// === FPS ===
let frameCount = 0;
let lastFpsTime = performance.now();
let fps = 0;

// ============================================================
// OPTIMALISATIE 5: HUD text alleen updaten als waarden veranderen.
// PIXI.Text.text setter triggert canvas re-render + texture upload.
// ============================================================
// OPTIMALISATIE 3: BitmapText voor HUD — deelt font atlas, geen per-text canvas rendering
const hudStyle = { fontFamily: 'monospace', fontSize: 16, fill: 0xffffff };
const fpsText = new PIXI.BitmapText({ text: 'FPS: 0', style: hudStyle });
fpsText.x = 10; fpsText.y = 8;
hudContainer.addChild(fpsText);

const zoomText = new PIXI.BitmapText({ text: 'Zoom: 100%', style: hudStyle });
zoomText.x = 10; zoomText.y = 30;
hudContainer.addChild(zoomText);

const boxCountText = new PIXI.BitmapText({ text: 'Boxes: 0', style: hudStyle });
boxCountText.x = 10; boxCountText.y = 52;
hudContainer.addChild(boxCountText);

const errorCountText = new PIXI.BitmapText({ text: 'Errors: 0', style: hudStyle });
errorCountText.x = 10; errorCountText.y = 74;
hudContainer.addChild(errorCountText);

const pauseText = new PIXI.BitmapText({ text: 'PAUSED', style: { fontFamily: 'monospace', fontSize: 20, fill: 0xef4444 } });
pauseText.x = 10; pauseText.y = 100;
pauseText.visible = false;
hudContainer.addChild(pauseText);

const streamText = new PIXI.BitmapText({ text: 'Stream: random fallback', style: { fontFamily: 'monospace', fontSize: 13, fill: 0x9ae6b4 } });
streamText.x = 10; streamText.y = 126;
hudContainer.addChild(streamText);

// Cached HUD values — only update Text when value changes
let lastHudFps = -1;
let lastHudZoomStr = '';
let lastHudBoxCount = -1;
let lastHudErrors = -1;
let lastHudPaused = false;
let lastHudStream = '';

// === Animate ===
function tickFrame() {
    const realNow = performance.now();
    const now = paused ? pauseStartTime - pauseTimeOffset : realNow - pauseTimeOffset;

    frameCount++;
    if (realNow - lastFpsTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsTime = realNow;
    }

    if (!paused) {
        let writeIdx = 0;
        for (let i = 0; i < batches.length; i++) {
            const b = batches[i];
            const progress = (now - b.startTime) / b.duration;
            if (progress >= 1) {
                if (b.requestId) {
                    requestsById.delete(b.requestId);
                }
                if (Math.random() < ERROR_CHANCE) {
                    addError(b.fromIdx, b.toIdx);
                }
            } else {
                batches[writeIdx++] = b;
            }
        }
        batches.length = writeIdx;

        if (!streamMode || !streamConnected) {
            const deficit = fallbackBatchTarget() - batches.length;
            const spawnCount = deficit > 0
                ? Math.max(1, Math.floor(deficit * 0.1))
                : (Math.random() < 0.02 ? 1 : 0);
            for (let i = 0; i < spawnCount; i++) {
                const batch = randomBoxBatch(now);
                batch.startTime = now + Math.random() * 500;
                batches.push(batch);
            }
        }

        if (!timelineLoading && !isLivePinned) {
            const replayBurst = Math.min(8, replayQueue.length);
            for (let i = 0; i < replayBurst; i++) {
                const base = replayQueue.shift();
                if (!base) break;
                renderBaseEvent(base);
                timelinePlayheadTs = base.ts;
            }

            if (replayQueue.length === 0) {
                const backlogBurst = Math.min(10, bufferedLiveIds.length);
                for (let i = 0; i < backlogBurst; i++) {
                    const nextId = bufferedLiveIds.shift();
                    if (!nextId) break;
                    const rec = timelineById.get(nextId);
                    if (!rec?.base) continue;
                    renderBaseEvent(rec.base);
                    timelinePlayheadTs = rec.base.ts;
                }

                if (bufferedLiveIds.length === 0) {
                    isLivePinned = true;
                    timelinePlayheadTs = timelineRangeEnd;
                }
            }
        }
    }

    // ============================================================
    // BATCH CIRCLES — Sprite pool (geen Graphics.clear() meer!)
    // ============================================================
    lastBatchPosCount = 0;

    // Ensure pool is big enough
    ensureBatchSpritePool(batches.length);

    let spriteIdx = 0;
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const progress = (now - batch.startTime) / batch.duration;
        if (progress < 0 || progress >= 1) continue;

        const p = Math.min(progress, 1);
        const x = batch.startX + (batch.endX - batch.startX) * p;
        const y = batch.startY + (batch.endY - batch.startY) * p;

        if (lastBatchPosCount >= batchPosPool.length) {
            batchPosPool.push({ x: 0, y: 0, batch: null });
        }
        const bp = batchPosPool[lastBatchPosCount++];
        bp.x = x; bp.y = y; bp.batch = batch;

        const s = batchSpritePool[spriteIdx];
        s.x = x;
        s.y = y;
        s.tint = batch.colorNum;
        s.scale.set((batch.radius || BATCH_SPRITE_RADIUS) / 16);
        s.visible = true;
        spriteIdx++;
    }

    // Hide unused sprites
    for (let i = spriteIdx; i < batchSpritePool.length; i++) {
        if (!batchSpritePool[i].visible) break;
        batchSpritePool[i].visible = false;
    }

    // ============================================================
    // ERROR CIRCLES — Sprite pool
    // ============================================================
    const errCount = boxErrorsMap.size;
    ensureErrorSpritePool(errCount);

    let errIdx = 0;
    for (const [, err] of boxErrorsMap) {
        const entry = errorSpritePool[errIdx];
        entry.sprite.x = err.x;
        entry.sprite.y = err.y;
        entry.sprite.visible = true;

        const countStr = `${err.entries.length}`;
        if (entry.label.text !== countStr) {
            entry.label.text = countStr;
        }
        entry.label.x = err.x;
        entry.label.y = err.y;
        entry.label.visible = true;
        errIdx++;
    }
    for (let i = errIdx; i < errorSpritePool.length; i++) {
        if (!errorSpritePool[i].sprite.visible) break;
        errorSpritePool[i].sprite.visible = false;
        errorSpritePool[i].label.visible = false;
    }

    // ============================================================
    // HIGHLIGHTS — alleen rebuilden als dirty of batch beweegt
    // ============================================================
    if (highlightDirty) {
        highlightGraphics.clear();

        if (activePopupBox) {
            const b = activePopupBox;
            const pad = 4;
            highlightGraphics.rect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
            highlightGraphics.stroke({ width: 3, color: 0xffcc00 });
        }

        if (activePopupLine) {
            highlightGraphics.setStrokeStyle({ width: 2.5, color: 0xffcc00 });
            highlightGraphics.moveTo(boxCenterX(activePopupLine.from), boxCenterY(activePopupLine.from));
            highlightGraphics.lineTo(boxCenterX(activePopupLine.to), boxCenterY(activePopupLine.to));
            highlightGraphics.stroke();
        }

        if (activePopupErrors) {
            highlightGraphics.circle(activePopupErrors.x, activePopupErrors.y, 12);
            highlightGraphics.stroke({ width: 3, color: 0xffcc00 });
        }

        highlightDirty = false;
    }

    // Batch highlight ring (beweegt, dus altijd updaten indien actief)
    if (activePopupBatch) {
        let bp: { x: number; y: number; batch: Batch | null } | undefined;
        for (let i = 0; i < lastBatchPosCount; i++) {
            if (batchPosPool[i].batch === activePopupBatch) { bp = batchPosPool[i]; break; }
        }
        if (bp) {
            highlightGraphics.clear();
            highlightGraphics.circle(bp.x, bp.y, 10);
            highlightGraphics.stroke({ width: 2.5, color: 0xffcc00 });
        }
    }

    // ============================================================
    // HUD — alleen updaten als waarden veranderen (OPTIMALISATIE 5)
    // ============================================================
    if (fps !== lastHudFps) {
        fpsText.text = `FPS: ${fps}`;
        lastHudFps = fps;
    }

    const zoomStr = `Zoom: ${Math.round(zoomLevel * 100)}%`;
    if (zoomStr !== lastHudZoomStr) {
        zoomText.text = zoomStr;
        lastHudZoomStr = zoomStr;
    }

    if (boxes.length !== lastHudBoxCount) {
        boxCountText.text = `Boxes: ${boxes.length}`;
        lastHudBoxCount = boxes.length;
    }

    let totalErrors = 0;
    for (const [, e] of boxErrorsMap) totalErrors += e.entries.length;
    if (totalErrors !== lastHudErrors) {
        errorCountText.text = `Errors: ${totalErrors}`;
        lastHudErrors = totalErrors;
    }

    if (paused !== lastHudPaused) {
        pauseText.visible = paused;
        lastHudPaused = paused;
    }

    const streamInfo = streamHintInfo
        ? `${streamStatusText} (${streamHintInfo.utc_date})`
        : streamStatusText;
    if (streamInfo !== lastHudStream) {
        streamText.text = streamInfo;
        lastHudStream = streamInfo;
    }

    const hasRange = timelineRangeStart > 0 && timelineRangeEnd > timelineRangeStart;
    const playhead = isLivePinned ? timelineRangeEnd : timelinePlayheadTs;
    if (timelineCurrentEl) {
        timelineCurrentEl.textContent = formatClock(playhead);
    }
    if (timelineCursorEl) {
        const ratio = hasRange ? clamp((playhead - timelineRangeStart) / (timelineRangeEnd - timelineRangeStart), 0, 1) : 0;
        timelineCursorEl.style.left = `${(ratio * 100).toFixed(2)}%`;
    }
    if (timelineBufferEl) {
        const bufferRatio = hasRange ? 1 : 0;
        timelineBufferEl.style.width = `${(bufferRatio * 100).toFixed(2)}%`;
    }
    if (liveIndicatorEl) {
        const liveState = isLivePinned && streamConnected && !timelineLoading;
        liveIndicatorEl.classList.toggle('live', liveState);
        liveIndicatorEl.textContent = liveState ? 'LIVE' : 'BUFFER';
    }
}

// Ticker calls tickFrame for normal (vsync) mode
app.ticker.add(() => tickFrame());

})();
