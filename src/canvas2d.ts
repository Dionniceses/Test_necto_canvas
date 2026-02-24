export {};

// =============================================
// Canvas 2D versie — zelfde functionaliteit als WebGL
// =============================================

const wrapper = document.getElementById('canvas-wrapper')!;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = wrapper.clientWidth;
canvas.height = wrapper.clientHeight;

// Popup container referentie
let activePopupBox: Box | null = null;
let activePopupLine: { from: Box; to: Box } | null = null;

// Sidebar elementen
const sidebar = document.getElementById('sidebar')!;
const sidebarHeader = document.getElementById('sidebar-header')!;
const sidebarTitle = document.getElementById('sidebar-title')!;
const sidebarBody = document.getElementById('sidebar-body')!;
const sidebarClose = document.getElementById('sidebar-close')!;

sidebarClose.addEventListener('click', () => closeSidebar());

// === Color parse helper ===
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
    rgb: [number, number, number];
    connections: number[];
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

const WORLD_W = canvas.width * 5;
const WORLD_H = canvas.height * 5;

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
                boxes.push({
                    x, y, w, h,
                    label: i < 26 ? String.fromCharCode(65 + i) : `${i + 1}`,
                    color,
                    rgb: hexToRgb(color),
                    connections: [],
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
}

generateBoxes(75);

function boxCenterX(b: Box) { return b.x + b.w / 2; }
function boxCenterY(b: Box) { return b.y + b.h / 2; }

// === Batches ===
interface Batch {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    startTime: number;
    duration: number;
    rgb: [number, number, number];
    fromIdx: number;
    toIdx: number;
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

let batchCount = 50;
let batches: Batch[] = [];

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
        fromIdx,
        toIdx,
    };
}

function initBatches() {
    batches = [];
    const now = performance.now();
    for (let i = 0; i < batchCount; i++) {
        const batch = randomBoxBatch(now);
        if (Math.random() < 0.7) {
            batch.startTime = now - Math.random() * 0.8 * batch.duration;
        } else {
            batch.startTime = now + Math.random() * 3000;
        }
        batches.push(batch);
    }
}

buildConnectionEdges();
initBatches();

// === UI Controls ===
const inputBatches = document.getElementById('input-batches') as HTMLInputElement;
const inputBoxes = document.getElementById('input-boxes') as HTMLInputElement;
const btnApply = document.getElementById('btn-apply')!;

btnApply.addEventListener('click', () => {
    const newBatchCount = Math.max(0, parseInt(inputBatches.value) || 0);
    const newBoxCount = Math.max(1, parseInt(inputBoxes.value) || 1);
    batchCount = newBatchCount;
    generateBoxes(newBoxCount);
    buildConnectionEdges();
    boxErrorsMap = new Map();
    initBatches();
    closePopup();
});

// === Uncap FPS ===
let uncapFps = false;
const chkUncap = document.getElementById('chk-uncap') as HTMLInputElement | null;
if (chkUncap) {
    chkUncap.addEventListener('change', () => {
        uncapFps = chkUncap.checked;
    });
}

// === Pause ===
let paused = false;
let pauseTimeOffset = 0;
let pauseStartTime = 0;

const btnPause = document.getElementById('btn-pause')!;
btnPause.addEventListener('click', () => {
    paused = !paused;
    if (paused) {
        pauseStartTime = performance.now();
        btnPause.innerHTML = '&#9654; Hervat';
        btnPause.classList.add('paused');
    } else {
        pauseTimeOffset += performance.now() - pauseStartTime;
        btnPause.innerHTML = '&#10074;&#10074; Pauze';
        btnPause.classList.remove('paused');
    }
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

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(zoomLevel * factor, ZOOM_MIN), ZOOM_MAX);

    const mouseX = (e.offsetX - panX) / zoomLevel;
    const mouseY = (e.offsetY - panY) / zoomLevel;

    zoomLevel = newZoom;
    panX = e.offsetX - mouseX * zoomLevel;
    panY = e.offsetY - mouseY * zoomLevel;
    updateZoomLabel();
}, { passive: false });

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let mouseDownX = 0;
let mouseDownY = 0;

canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;

    const minPanX = canvas.width - WORLD_W * zoomLevel;
    const minPanY = canvas.height - WORLD_H * zoomLevel;
    panX = Math.min(0, Math.max(minPanX, panX));
    panY = Math.min(0, Math.max(minPanY, panY));
});

canvas.addEventListener('mouseup', (e) => {
    const wasDrag = Math.abs(e.clientX - mouseDownX) > 5 || Math.abs(e.clientY - mouseDownY) > 5;
    isDragging = false;
    canvas.style.cursor = 'grab';

    if (!wasDrag) {
        const rect = canvas.getBoundingClientRect();
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
            openBoxPopup(clickedBox, clickScreenX, clickScreenY);
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
                        openLinePopup(clickedLine.from, clickedLine.to, clickScreenX, clickScreenY);
                    } else {
                        closePopup();
                    }
                }
            }
        }
    }
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    canvas.style.cursor = 'grab';
});

canvas.style.cursor = 'grab';

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

// Batch position pool for click detection
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

function closePopup() {
    activePopupBox = null;
    activePopupLine = null;
    activePopupBatch = null;
    activePopupErrors = null;
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

function openBoxPopup(box: Box, _screenX: number, _screenY: number) {
    closePopup();

    const CLICK_ZOOM = 3;
    const cx = boxCenterX(box);
    const cy = boxCenterY(box);

    zoomLevel = CLICK_ZOOM;
    panX = canvas.width / 2 - cx * zoomLevel;
    panY = canvas.height / 2 - cy * zoomLevel;

    const minPanX = canvas.width - WORLD_W * zoomLevel;
    const minPanY = canvas.height - WORLD_H * zoomLevel;
    panX = Math.min(0, Math.max(minPanX, panX));
    panY = Math.min(0, Math.max(minPanY, panY));
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

function openLinePopup(from: Box, to: Box, _screenX: number, _screenY: number) {
    closePopup();

    const CLICK_ZOOM = 3;
    const mx = (boxCenterX(from) + boxCenterX(to)) / 2;
    const my = (boxCenterY(from) + boxCenterY(to)) / 2;

    zoomLevel = CLICK_ZOOM;
    panX = canvas.width / 2 - mx * zoomLevel;
    panY = canvas.height / 2 - my * zoomLevel;

    const minPanX = canvas.width - WORLD_W * zoomLevel;
    const minPanY = canvas.height - WORLD_H * zoomLevel;
    panX = Math.min(0, Math.max(minPanX, panX));
    panY = Math.min(0, Math.max(minPanY, panY));
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

let activePopupBatch: Batch | null = null;

function openBatchPopup(batch: Batch) {
    closePopup();

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

let activePopupErrors: BoxErrors | null = null;

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

    const CLICK_ZOOM = 3;
    const cx = errors.x;
    const cy = errors.y;
    zoomLevel = CLICK_ZOOM;
    panX = canvas.width / 2 - cx * zoomLevel;
    panY = canvas.height / 2 - cy * zoomLevel;
    const minPanX = canvas.width - WORLD_W * zoomLevel;
    const minPanY = canvas.height - WORLD_H * zoomLevel;
    panX = Math.min(0, Math.max(minPanX, panX));
    panY = Math.min(0, Math.max(minPanY, panY));
    updateZoomLabel();

    openSidebar();
    refreshErrorSidebar(errors);

    activePopupErrors = errors;
}

// === FPS ===
let frameCount = 0;
let lastFpsTime = performance.now();
let fps = 0;

// === Frustum culling ===
function isInView(x: number, y: number, margin: number): boolean {
    const sx = x * zoomLevel + panX;
    const sy = y * zoomLevel + panY;
    return sx > -margin && sx < canvas.width + margin &&
           sy > -margin && sy < canvas.height + margin;
}

function isBoxInView(box: Box): boolean {
    const sx1 = box.x * zoomLevel + panX;
    const sy1 = box.y * zoomLevel + panY;
    const sx2 = (box.x + box.w) * zoomLevel + panX;
    const sy2 = (box.y + box.h) * zoomLevel + panY;
    return sx2 > 0 && sx1 < canvas.width && sy2 > 0 && sy1 < canvas.height;
}

// === Animate ===

function animate() {
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
                if (Math.random() < ERROR_CHANCE) {
                    addError(b.fromIdx, b.toIdx);
                }
            } else {
                batches[writeIdx++] = b;
            }
        }
        batches.length = writeIdx;

        const deficit = batchCount - batches.length;
        const spawnCount = deficit > 0
            ? Math.max(1, Math.floor(deficit * 0.1))
            : (Math.random() < 0.02 ? 1 : 0);
        for (let i = 0; i < spawnCount; i++) {
            const batch = randomBoxBatch(now);
            batch.startTime = now + Math.random() * 500;
            batches.push(batch);
        }
    }

    // === Canvas 2D rendering ===
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoomLevel, zoomLevel);

    // --- Draw connection lines ---
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1 / zoomLevel;
    const drawnLines = new Set<string>();
    for (let i = 0; i < boxes.length; i++) {
        for (const j of boxes[i].connections) {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (drawnLines.has(key)) continue;
            drawnLines.add(key);
            ctx.beginPath();
            ctx.moveTo(boxCenterX(boxes[i]), boxCenterY(boxes[i]));
            ctx.lineTo(boxCenterX(boxes[j]), boxCenterY(boxes[j]));
            ctx.stroke();
        }
    }

    // --- Highlight selected line ---
    if (activePopupLine) {
        ctx.save();
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2.5 / zoomLevel;
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 10 / zoomLevel;
        ctx.beginPath();
        ctx.moveTo(boxCenterX(activePopupLine.from), boxCenterY(activePopupLine.from));
        ctx.lineTo(boxCenterX(activePopupLine.to), boxCenterY(activePopupLine.to));
        ctx.stroke();
        ctx.restore();
    }

    // --- Draw boxes ---
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const box of boxes) {
        if (!isBoxInView(box)) continue;

        // Fill
        ctx.fillStyle = box.color;
        ctx.fillRect(box.x, box.y, box.w, box.h);

        // Border
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2 / zoomLevel;
        ctx.strokeRect(box.x, box.y, box.w, box.h);

        // Label
        ctx.fillStyle = 'white';
        ctx.fillText(box.label, boxCenterX(box), boxCenterY(box));
    }

    // --- Highlight selected box ---
    if (activePopupBox) {
        const b = activePopupBox;
        const pad = 4;
        ctx.save();
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 3 / zoomLevel;
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 12 / zoomLevel;
        ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
        ctx.restore();
    }

    // --- Draw batch circles ---
    let activeCount = 0;
    lastBatchPosCount = 0;

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const progress = (now - batch.startTime) / batch.duration;
        if (progress < 0 || progress >= 1) continue;

        activeCount++;
        const p = Math.min(progress, 1);
        const x = batch.startX + (batch.endX - batch.startX) * p;
        const y = batch.startY + (batch.endY - batch.startY) * p;

        // Pool batch position for click detection
        if (lastBatchPosCount >= batchPosPool.length) {
            batchPosPool.push({ x: 0, y: 0, batch: null });
        }
        const bp = batchPosPool[lastBatchPosCount++];
        bp.x = x; bp.y = y; bp.batch = batch;

        ctx.fillStyle = `rgb(${batch.rgb[0]}, ${batch.rgb[1]}, ${batch.rgb[2]})`;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
    }

    // --- Highlight selected batch ---
    if (activePopupBatch) {
        let bp: { x: number; y: number; batch: Batch | null } | undefined;
        for (let i = 0; i < lastBatchPosCount; i++) {
            if (batchPosPool[i].batch === activePopupBatch) { bp = batchPosPool[i]; break; }
        }
        if (bp) {
            ctx.save();
            ctx.strokeStyle = '#ffcc00';
            ctx.lineWidth = 2.5 / zoomLevel;
            ctx.shadowColor = '#ffcc00';
            ctx.shadowBlur = 14 / zoomLevel;
            ctx.beginPath();
            ctx.arc(bp.x, bp.y, 10 / zoomLevel, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    // --- Draw error circles ---
    for (const [, err] of boxErrorsMap) {
        // Red circle
        ctx.fillStyle = '#f02b2b';
        ctx.beginPath();
        ctx.arc(err.x, err.y, 9, 0, Math.PI * 2);
        ctx.fill();

        // Count badge
        ctx.fillStyle = 'white';
        ctx.font = `bold ${Math.max(9, 11)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${err.entries.length}`, err.x, err.y);
    }

    // --- Highlight selected error ---
    if (activePopupErrors) {
        ctx.save();
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 3 / zoomLevel;
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 12 / zoomLevel;
        ctx.beginPath();
        ctx.arc(activePopupErrors.x, activePopupErrors.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    ctx.restore(); // End world transform

    // --- HUD (screen space) ---
    ctx.fillStyle = 'white';
    ctx.font = '16px monospace';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`FPS: ${fps}`, 10, 24);
    ctx.fillText(`Batches: ${batches.length} (visible: ${activeCount})`, 10, 46);
    ctx.fillText(`Zoom: ${Math.round(zoomLevel * 100)}%`, 10, 68);
    ctx.fillText(`Boxes: ${boxes.length}`, 10, 90);
    let totalErrors = 0;
    for (const [, e] of boxErrorsMap) totalErrors += e.entries.length;
    ctx.fillText(`Errors: ${totalErrors}`, 10, 112);
    if (paused) {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('PAUSED', 10, 140);
    }

    if (uncapFps) {
        setTimeout(animate, 0);
    } else {
        requestAnimationFrame(animate);
    }
}

animate();
