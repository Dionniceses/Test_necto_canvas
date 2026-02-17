export {};

// =============================================
// WebGL versie — zelfde functionaliteit als Canvas 2D
// =============================================

const wrapper = document.getElementById('canvas-wrapper')!;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2')!;
canvas.width = wrapper.clientWidth;
canvas.height = wrapper.clientHeight;

if (!gl) {
    alert('WebGL2 niet beschikbaar in deze browser');
    throw new Error('No WebGL2');
}

// We need an offscreen 2D canvas for text rendering (box labels + HUD)
const overlayCanvas = document.createElement('canvas');
overlayCanvas.width = canvas.width;
overlayCanvas.height = canvas.height;
const overlayCtx = overlayCanvas.getContext('2d')!;

// Popup container referentie
let activePopup: HTMLElement | null = null;
let activePopupBox: Box | null = null;
let activePopupLine: { from: Box, to: Box } | null = null;

// Sidebar elementen
const sidebar = document.getElementById('sidebar')!;
const sidebarHeader = document.getElementById('sidebar-header')!;
const sidebarTitle = document.getElementById('sidebar-title')!;
const sidebarBody = document.getElementById('sidebar-body')!;
const sidebarClose = document.getElementById('sidebar-close')!;
const sidebarPlaceholder = document.getElementById('sidebar-placeholder')!;

sidebarClose.addEventListener('click', () => closeSidebar());

// === Shaders ===

// Vertex shader for circles (instanced quads)
const circleVS = `#version 300 es
precision highp float;

// Per-vertex (quad corners)
in vec2 a_quadPos; // -1..1

// Per-instance
in vec2 a_center;
in float a_radius;
in vec4 a_color;

uniform mat3 u_transform;
uniform vec2 u_resolution;

out vec4 v_color;
out vec2 v_quadPos;

void main() {
    vec2 worldPos = a_center + a_quadPos * a_radius;
    vec3 transformed = u_transform * vec3(worldPos, 1.0);
    // Convert to clip space
    vec2 clipPos = (transformed.xy / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y; // flip Y
    gl_Position = vec4(clipPos, 0.0, 1.0);
    v_color = a_color;
    v_quadPos = a_quadPos;
}`;

const circleFS = `#version 300 es
precision highp float;

in vec4 v_color;
in vec2 v_quadPos;
out vec4 fragColor;

void main() {
    float dist = length(v_quadPos);
    if (dist > 1.0) discard;
    fragColor = v_color;
}`;

// Vertex shader for boxes (filled rects)
const rectVS = `#version 300 es
precision highp float;

in vec2 a_position;
in vec4 a_color;

uniform mat3 u_transform;
uniform vec2 u_resolution;

out vec4 v_color;

void main() {
    vec3 transformed = u_transform * vec3(a_position, 1.0);
    vec2 clipPos = (transformed.xy / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;
    gl_Position = vec4(clipPos, 0.0, 1.0);
    v_color = a_color;
}`;

const rectFS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() {
    fragColor = v_color;
}`;

// === Shader compilation helpers ===
function compileShader(src: string, type: number): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        throw new Error('Shader compile error');
    }
    return shader;
}

function createProgram(vs: string, fs: string): WebGLProgram {
    const program = gl.createProgram()!;
    gl.attachShader(program, compileShader(vs, gl.VERTEX_SHADER));
    gl.attachShader(program, compileShader(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program));
        throw new Error('Program link error');
    }
    return program;
}

// === Programs ===
const circleProgram = createProgram(circleVS, circleFS);
const rectProgram = createProgram(rectVS, rectFS);

// === Circle instanced rendering setup ===
const circleVAO = gl.createVertexArray()!;
gl.bindVertexArray(circleVAO);

// Quad vertices (2 triangles)
const quadVerts = new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1, 1,   1, -1,   1, 1,
]);
const quadBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
const aQuadPos = gl.getAttribLocation(circleProgram, 'a_quadPos');
gl.enableVertexAttribArray(aQuadPos);
gl.vertexAttribPointer(aQuadPos, 2, gl.FLOAT, false, 0, 0);

// Instance buffers
// Layout: centerX, centerY, radius, r, g, b, a  = 7 floats per instance
const MAX_CIRCLES = 200000;
const circleInstanceData = new Float32Array(MAX_CIRCLES * 7);
const circleInstanceBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, circleInstanceBuf);
gl.bufferData(gl.ARRAY_BUFFER, circleInstanceData.byteLength, gl.DYNAMIC_DRAW);

const aCenter = gl.getAttribLocation(circleProgram, 'a_center');
gl.enableVertexAttribArray(aCenter);
gl.vertexAttribPointer(aCenter, 2, gl.FLOAT, false, 7 * 4, 0);
gl.vertexAttribDivisor(aCenter, 1);

const aRadius = gl.getAttribLocation(circleProgram, 'a_radius');
gl.enableVertexAttribArray(aRadius);
gl.vertexAttribPointer(aRadius, 1, gl.FLOAT, false, 7 * 4, 2 * 4);
gl.vertexAttribDivisor(aRadius, 1);

const aCircleColor = gl.getAttribLocation(circleProgram, 'a_color');
gl.enableVertexAttribArray(aCircleColor);
gl.vertexAttribPointer(aCircleColor, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
gl.vertexAttribDivisor(aCircleColor, 1);

gl.bindVertexArray(null);

// === Rect rendering setup ===
const rectVAO = gl.createVertexArray()!;
gl.bindVertexArray(rectVAO);

// We'll fill rect data each frame: x, y, r, g, b, a = 6 floats per vertex, 6 verts per rect
const MAX_RECTS = 1000;
const rectVertexData = new Float32Array(MAX_RECTS * 6 * 6);
const rectBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
gl.bufferData(gl.ARRAY_BUFFER, rectVertexData.byteLength, gl.DYNAMIC_DRAW);

const aRectPos = gl.getAttribLocation(rectProgram, 'a_position');
gl.enableVertexAttribArray(aRectPos);
gl.vertexAttribPointer(aRectPos, 2, gl.FLOAT, false, 6 * 4, 0);

const aRectColor = gl.getAttribLocation(rectProgram, 'a_color');
gl.enableVertexAttribArray(aRectColor);
gl.vertexAttribPointer(aRectColor, 4, gl.FLOAT, false, 6 * 4, 2 * 4);

gl.bindVertexArray(null);

// === Line rendering setup (reuses rectProgram shaders) ===
const lineVAO = gl.createVertexArray()!;
gl.bindVertexArray(lineVAO);

const MAX_LINE_VERTS = 50000;
const lineVertexData = new Float32Array(MAX_LINE_VERTS * 6);
const lineBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
gl.bufferData(gl.ARRAY_BUFFER, lineVertexData.byteLength, gl.DYNAMIC_DRAW);

const aLinePos = gl.getAttribLocation(rectProgram, 'a_position');
gl.enableVertexAttribArray(aLinePos);
gl.vertexAttribPointer(aLinePos, 2, gl.FLOAT, false, 6 * 4, 0);

const aLineColor = gl.getAttribLocation(rectProgram, 'a_color');
gl.enableVertexAttribArray(aLineColor);
gl.vertexAttribPointer(aLineColor, 4, gl.FLOAT, false, 6 * 4, 2 * 4);

gl.bindVertexArray(null);

// === Overlay texture for text ===
const overlayTexture = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

const overlayVS = `#version 300 es
precision highp float;
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}`;

const overlayFS = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
    fragColor = texture(u_texture, v_texCoord);
}`;

const overlayProgram = createProgram(overlayVS, overlayFS);
const overlayVAO = gl.createVertexArray()!;
gl.bindVertexArray(overlayVAO);

// Fullscreen quad
const overlayQuad = new Float32Array([
    // pos       texcoord
    -1, -1,      0, 1,
     1, -1,      1, 1,
    -1,  1,      0, 0,
    -1,  1,      0, 0,
     1, -1,      1, 1,
     1,  1,      1, 0,
]);
const overlayQuadBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, overlayQuadBuf);
gl.bufferData(gl.ARRAY_BUFFER, overlayQuad, gl.STATIC_DRAW);
const aOverlayPos = gl.getAttribLocation(overlayProgram, 'a_position');
gl.enableVertexAttribArray(aOverlayPos);
gl.vertexAttribPointer(aOverlayPos, 2, gl.FLOAT, false, 4 * 4, 0);
const aOverlayTex = gl.getAttribLocation(overlayProgram, 'a_texCoord');
gl.enableVertexAttribArray(aOverlayTex);
gl.vertexAttribPointer(aOverlayTex, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
gl.bindVertexArray(null);

// === Color parse helper ===
function hexToRgb(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
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
    connections: number[]; // indices of connected boxes
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

function boxesOverlap(a: {x:number,y:number,w:number,h:number}, b: {x:number,y:number,w:number,h:number}): boolean {
    return !(a.x + a.w + BOX_SPACING < b.x ||
             b.x + b.w + BOX_SPACING < a.x ||
             a.y + a.h + BOX_SPACING < b.y ||
             b.y + b.h + BOX_SPACING < a.y);
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
            if (!boxes.some(b => boxesOverlap(candidate, b))) {
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

    // Genereer random verbindingen (2-4 per box, niet naar zichzelf)
    for (let i = 0; i < boxes.length; i++) {
        const numConnections = 2 + Math.floor(Math.random() * 3); // 2-4
        const available = Array.from({length: boxes.length}, (_, k) => k).filter(k => k !== i);
        for (let c = 0; c < numConnections && available.length > 0; c++) {
            const pick = Math.floor(Math.random() * available.length);
            const target = available[pick];
            available.splice(pick, 1);
            if (!boxes[i].connections.includes(target)) {
                boxes[i].connections.push(target);
            }
            // Maak bidirectioneel
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
const ERROR_CHANCE = 0.003; // 0.3% kans per voltooide batch
const errorMessages = [
    'Timeout exceeded',
    'Connection refused',
    'Data corruption detected',
    'Buffer overflow',
    'Authentication failed',
    'Rate limit exceeded',
    'Checksum mismatch',
    'Service unavailable',
    'Packet loss detected',
    'Memory allocation error',
];
const errorSeverities = ['Low', 'Medium', 'High', 'Critical'];

let boxErrorsMap: Map<number, BoxErrors> = new Map();

function getErrorPosition(box: Box): { x: number, y: number } {
    // Positie net buiten de box (rechts-boven)
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

    // Live update sidebar als deze box open staat
    if (activePopupErrors && activePopupErrors.boxIdx === toIdx) {
        refreshErrorSidebar(activePopupErrors);
    }
}

let batchCount = 50;
let batches: Batch[] = [];

// Lijst van alle verbindingen (edges) om batches over te sturen
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
    // Kies een willekeurige verbinding
    const edge = connectionEdges[Math.floor(Math.random() * connectionEdges.length)];
    // Willekeurige richting
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
        // Klik: check of er een box is aangeklikt
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
            // Check error bolletjes
            const clickedError = findClickedError(worldX, worldY);
            if (clickedError) {
                openErrorPopup(clickedError);
            } else {
                // Check batch bolletjes
                const clickedBatch = findClickedBatch(worldX, worldY);
                if (clickedBatch) {
                    openBatchPopup(clickedBatch);
                } else {
                    // Check lijnen
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

// Afstand van punt naar lijnsegment
function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function findClickedLine(worldX: number, worldY: number): { from: Box, to: Box } | null {
    const threshold = 8 / zoomLevel;
    const drawn = new Set<string>();
    let best: { from: Box, to: Box, dist: number } | null = null;
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

// Vind aangeklikte batch (bolletje)
let lastBatchPositions: { x: number, y: number, batch: Batch }[] = [];

function findClickedBatch(worldX: number, worldY: number): Batch | null {
    const threshold = 10 / zoomLevel;
    for (const bp of lastBatchPositions) {
        const dist = Math.hypot(worldX - bp.x, worldY - bp.y);
        if (dist < threshold) return bp.batch;
    }
    return null;
}

// Vind aangeklikte error bolletje
function findClickedError(worldX: number, worldY: number): BoxErrors | null {
    const threshold = 12 / zoomLevel;
    for (const [, err] of boxErrorsMap) {
        const dist = Math.hypot(worldX - err.x, worldY - err.y);
        if (dist < threshold) return err;
    }
    return null;
}

function getMockData(box: Box) {
    // Deterministic mock data gebaseerd op label
    const seed = box.label.charCodeAt(0);
    return {
        type: mockTypes[seed % mockTypes.length],
        status: mockStatuses[seed % mockStatuses.length],
        throughput: `${(seed * 37 % 900 + 100)} msg/s`,
        latency: `${(seed * 13 % 50 + 5)} ms`,
        uptime: `${(seed * 7 % 99 + 1)}%`,
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

function updatePopupPosition() {
    // Niet meer nodig — sidebar staat vast
}

function openBoxPopup(box: Box, screenX: number, screenY: number) {
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

function openLinePopup(from: Box, to: Box, screenX: number, screenY: number) {
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

// === Batch popup ===
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

// === Error popup ===
let activePopupErrors: BoxErrors | null = null;

function refreshErrorSidebar(errors: BoxErrors) {
    const box = boxes[errors.boxIdx];

    const severityCount: Record<string, number> = {};
    for (const e of errors.entries) {
        severityCount[e.severity] = (severityCount[e.severity] || 0) + 1;
    }

    let errListHtml = errors.entries.slice(-20).reverse().map(e => {
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

// === Helper: build transform matrix (column-major for uniform) ===
function getTransformMatrix(): Float32Array {
    // Transform = translate(panX, panY) * scale(zoom)
    return new Float32Array([
        zoomLevel, 0, 0,
        0, zoomLevel, 0,
        panX, panY, 1,
    ]);
}

// === Animate ===

function animate() {
    const realNow = performance.now();
    const now = paused ? pauseStartTime - pauseTimeOffset : realNow - pauseTimeOffset;

    // FPS (altijd tellen)
    frameCount++;
    if (realNow - lastFpsTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsTime = realNow;
    }

    if (!paused) {
        // Remove finished batches + mogelijke error generatie
        for (let i = batches.length - 1; i >= 0; i--) {
            const progress = (now - batches[i].startTime) / batches[i].duration;
            if (progress >= 1) {
                // Kleine kans op error
                if (Math.random() < ERROR_CHANCE) {
                    addError(batches[i].fromIdx, batches[i].toIdx);
                }
                batches.splice(i, 1);
            }
        }

        // Spawn new
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

    // === WebGL rendering ===
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.067, 0.067, 0.067, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const transform = getTransformMatrix();
    const resolution = new Float32Array([canvas.width, canvas.height]);

    // --- Draw boxes as rects ---
    gl.useProgram(rectProgram);
    gl.uniformMatrix3fv(gl.getUniformLocation(rectProgram, 'u_transform'), false, transform);
    gl.uniform2fv(gl.getUniformLocation(rectProgram, 'u_resolution'), resolution);

    let rectCount = 0;
    for (let i = 0; i < boxes.length && rectCount < MAX_RECTS; i++) {
        const box = boxes[i];
        const [r, g, b] = box.rgb;
        const off = rectCount * 36; // 6 verts * 6 floats
        const x1 = box.x, y1 = box.y, x2 = box.x + box.w, y2 = box.y + box.h;

        // Triangle 1
        rectVertexData[off + 0] = x1; rectVertexData[off + 1] = y1;
        rectVertexData[off + 2] = r; rectVertexData[off + 3] = g; rectVertexData[off + 4] = b; rectVertexData[off + 5] = 1;

        rectVertexData[off + 6] = x2; rectVertexData[off + 7] = y1;
        rectVertexData[off + 8] = r; rectVertexData[off + 9] = g; rectVertexData[off + 10] = b; rectVertexData[off + 11] = 1;

        rectVertexData[off + 12] = x1; rectVertexData[off + 13] = y2;
        rectVertexData[off + 14] = r; rectVertexData[off + 15] = g; rectVertexData[off + 16] = b; rectVertexData[off + 17] = 1;

        // Triangle 2
        rectVertexData[off + 18] = x1; rectVertexData[off + 19] = y2;
        rectVertexData[off + 20] = r; rectVertexData[off + 21] = g; rectVertexData[off + 22] = b; rectVertexData[off + 23] = 1;

        rectVertexData[off + 24] = x2; rectVertexData[off + 25] = y1;
        rectVertexData[off + 26] = r; rectVertexData[off + 27] = g; rectVertexData[off + 28] = b; rectVertexData[off + 29] = 1;

        rectVertexData[off + 30] = x2; rectVertexData[off + 31] = y2;
        rectVertexData[off + 32] = r; rectVertexData[off + 33] = g; rectVertexData[off + 34] = b; rectVertexData[off + 35] = 1;

        rectCount++;
    }

    gl.bindVertexArray(rectVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rectVertexData.subarray(0, rectCount * 36));
    gl.drawArrays(gl.TRIANGLES, 0, rectCount * 6);

    // --- Draw random lines between connected boxes ---
    {
        let lineVertCount = 0;
        const drawn = new Set<string>();
        for (let i = 0; i < boxes.length; i++) {
            for (const j of boxes[i].connections) {
                const key = i < j ? `${i}-${j}` : `${j}-${i}`;
                if (drawn.has(key) || lineVertCount + 2 > MAX_LINE_VERTS) continue;
                drawn.add(key);

                const off1 = lineVertCount * 6;
                lineVertexData[off1    ] = boxCenterX(boxes[i]);
                lineVertexData[off1 + 1] = boxCenterY(boxes[i]);
                lineVertexData[off1 + 2] = 1; lineVertexData[off1 + 3] = 1;
                lineVertexData[off1 + 4] = 1; lineVertexData[off1 + 5] = 0.15;

                const off2 = (lineVertCount + 1) * 6;
                lineVertexData[off2    ] = boxCenterX(boxes[j]);
                lineVertexData[off2 + 1] = boxCenterY(boxes[j]);
                lineVertexData[off2 + 2] = 1; lineVertexData[off2 + 3] = 1;
                lineVertexData[off2 + 4] = 1; lineVertexData[off2 + 5] = 0.15;

                lineVertCount += 2;
            }
        }

        gl.bindVertexArray(lineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineVertexData.subarray(0, lineVertCount * 6));
        gl.drawArrays(gl.LINES, 0, lineVertCount);

        // Highlight geselecteerde lijn
        if (activePopupLine) {
            const hlOff = 0;
            lineVertexData[hlOff    ] = boxCenterX(activePopupLine.from);
            lineVertexData[hlOff + 1] = boxCenterY(activePopupLine.from);
            lineVertexData[hlOff + 2] = 1; lineVertexData[hlOff + 3] = 0.9;
            lineVertexData[hlOff + 4] = 0; lineVertexData[hlOff + 5] = 0.9;

            lineVertexData[hlOff + 6] = boxCenterX(activePopupLine.to);
            lineVertexData[hlOff + 7] = boxCenterY(activePopupLine.to);
            lineVertexData[hlOff + 8] = 1; lineVertexData[hlOff + 9] = 0.9;
            lineVertexData[hlOff + 10] = 0; lineVertexData[hlOff + 11] = 0.9;

            gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineVertexData.subarray(0, 12));
            gl.lineWidth(1);
            gl.drawArrays(gl.LINES, 0, 2);
        }
    }

    // --- Draw circles (batches) instanced ---
    gl.useProgram(circleProgram);
    gl.uniformMatrix3fv(gl.getUniformLocation(circleProgram, 'u_transform'), false, transform);
    gl.uniform2fv(gl.getUniformLocation(circleProgram, 'u_resolution'), resolution);

    let circleCount = 0;
    let activeCount = 0;
    lastBatchPositions = [];
    for (let i = 0; i < batches.length && circleCount < MAX_CIRCLES; i++) {
        const batch = batches[i];
        const progress = (now - batch.startTime) / batch.duration;
        if (progress < 0 || progress >= 1) continue;

        activeCount++;
        const p = Math.min(progress, 1);
        const x = batch.startX + (batch.endX - batch.startX) * p;
        const y = batch.startY + (batch.endY - batch.startY) * p;

        lastBatchPositions.push({ x, y, batch });

        const off = circleCount * 7;
        circleInstanceData[off + 0] = x;
        circleInstanceData[off + 1] = y;
        circleInstanceData[off + 2] = 6; // radius
        circleInstanceData[off + 3] = batch.rgb[0];
        circleInstanceData[off + 4] = batch.rgb[1];
        circleInstanceData[off + 5] = batch.rgb[2];
        circleInstanceData[off + 6] = 1.0;
        circleCount++;
    }

    // Error bolletjes ook als circles tekenen (rood)
    for (const [, err] of boxErrorsMap) {
        if (circleCount >= MAX_CIRCLES) break;
        const off = circleCount * 7;
        circleInstanceData[off + 0] = err.x;
        circleInstanceData[off + 1] = err.y;
        circleInstanceData[off + 2] = 9; // iets groter
        circleInstanceData[off + 3] = 0.94;
        circleInstanceData[off + 4] = 0.17;
        circleInstanceData[off + 5] = 0.17;
        circleInstanceData[off + 6] = 1.0;
        circleCount++;
    }

    gl.bindVertexArray(circleVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, circleInstanceBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, circleInstanceData.subarray(0, circleCount * 7));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, circleCount);

    // --- Text overlay via 2D canvas texture ---
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Draw box labels on overlay using transform
    overlayCtx.save();
    overlayCtx.translate(panX, panY);
    overlayCtx.scale(zoomLevel, zoomLevel);
    overlayCtx.font = 'bold 11px monospace';
    overlayCtx.textAlign = 'center';
    overlayCtx.textBaseline = 'middle';
    overlayCtx.fillStyle = 'white';
    // Box borders
    overlayCtx.strokeStyle = 'white';
    overlayCtx.lineWidth = 2 / zoomLevel;
    for (const box of boxes) {
        overlayCtx.strokeRect(box.x, box.y, box.w, box.h);
        overlayCtx.fillText(box.label, boxCenterX(box), boxCenterY(box));
    }

    // Highlight geselecteerde box
    if (activePopupBox) {
        const b = activePopupBox;
        const pad = 4;
        overlayCtx.save();
        overlayCtx.strokeStyle = '#ffcc00';
        overlayCtx.lineWidth = 3 / zoomLevel;
        overlayCtx.shadowColor = '#ffcc00';
        overlayCtx.shadowBlur = 12 / zoomLevel;
        overlayCtx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
        overlayCtx.restore();
    }

    // Highlight geselecteerde lijn op overlay
    if (activePopupLine) {
        overlayCtx.save();
        overlayCtx.strokeStyle = '#ffcc00';
        overlayCtx.lineWidth = 2.5 / zoomLevel;
        overlayCtx.shadowColor = '#ffcc00';
        overlayCtx.shadowBlur = 10 / zoomLevel;
        overlayCtx.beginPath();
        overlayCtx.moveTo(boxCenterX(activePopupLine.from), boxCenterY(activePopupLine.from));
        overlayCtx.lineTo(boxCenterX(activePopupLine.to), boxCenterY(activePopupLine.to));
        overlayCtx.stroke();
        overlayCtx.restore();
    }

    // Highlight geselecteerde batch
    if (activePopupBatch) {
        const bp = lastBatchPositions.find(p => p.batch === activePopupBatch);
        if (bp) {
            overlayCtx.save();
            overlayCtx.strokeStyle = '#ffcc00';
            overlayCtx.lineWidth = 2.5 / zoomLevel;
            overlayCtx.shadowColor = '#ffcc00';
            overlayCtx.shadowBlur = 14 / zoomLevel;
            overlayCtx.beginPath();
            overlayCtx.arc(bp.x, bp.y, 10 / zoomLevel, 0, Math.PI * 2);
            overlayCtx.stroke();
            overlayCtx.restore();
        }
    }

    overlayCtx.restore();

    // Error count badges (in world space, boven de error cirkels)
    overlayCtx.save();
    overlayCtx.translate(panX, panY);
    overlayCtx.scale(zoomLevel, zoomLevel);
    overlayCtx.font = `bold ${Math.max(9, 11 / zoomLevel * 1)}px monospace`;
    overlayCtx.textAlign = 'center';
    overlayCtx.textBaseline = 'middle';
    for (const [, err] of boxErrorsMap) {
        // Teken aantal op het error bolletje
        overlayCtx.fillStyle = 'white';
        overlayCtx.fillText(`${err.entries.length}`, err.x, err.y);
    }
    overlayCtx.restore();

    // Highlight geselecteerde error
    if (activePopupErrors) {
        overlayCtx.save();
        overlayCtx.translate(panX, panY);
        overlayCtx.scale(zoomLevel, zoomLevel);
        overlayCtx.strokeStyle = '#ffcc00';
        overlayCtx.lineWidth = 3 / zoomLevel;
        overlayCtx.shadowColor = '#ffcc00';
        overlayCtx.shadowBlur = 12 / zoomLevel;
        overlayCtx.beginPath();
        overlayCtx.arc(activePopupErrors.x, activePopupErrors.y, 12, 0, Math.PI * 2);
        overlayCtx.stroke();
        overlayCtx.restore();
    }

    // HUD
    overlayCtx.fillStyle = 'white';
    overlayCtx.font = '16px monospace';
    overlayCtx.textAlign = 'start';
    overlayCtx.textBaseline = 'alphabetic';
    overlayCtx.fillText(`FPS: ${fps}`, 10, 24);
    overlayCtx.fillText(`Batches: ${batches.length} (visible: ${activeCount})`, 10, 46);
    overlayCtx.fillText(`Zoom: ${Math.round(zoomLevel * 100)}%`, 10, 68);
    overlayCtx.fillText(`Boxes: ${boxes.length}`, 10, 90);
    let totalErrors = 0;
    for (const [, e] of boxErrorsMap) totalErrors += e.entries.length;
    overlayCtx.fillText(`Errors: ${totalErrors}`, 10, 112);
    if (paused) {
        overlayCtx.fillStyle = '#ef4444';
        overlayCtx.font = 'bold 20px monospace';
        overlayCtx.fillText('PAUSED', 10, 140);
    }

    // Upload overlay to texture and draw as blended fullscreen quad
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, overlayCanvas);

    gl.useProgram(overlayProgram);
    gl.uniform1i(gl.getUniformLocation(overlayProgram, 'u_texture'), 0);
    gl.bindVertexArray(overlayVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindVertexArray(null);

    updatePopupPosition();

    requestAnimationFrame(animate);
}

animate();
