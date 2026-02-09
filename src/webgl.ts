export {};

// =============================================
// WebGL versie — zelfde functionaliteit als Canvas 2D
// =============================================

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2')!;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

if (!gl) {
    alert('WebGL2 niet beschikbaar in deze browser');
    throw new Error('No WebGL2');
}

// We need an offscreen 2D canvas for text rendering (box labels + HUD)
const overlayCanvas = document.createElement('canvas');
overlayCanvas.width = canvas.width;
overlayCanvas.height = canvas.height;
const overlayCtx = overlayCanvas.getContext('2d')!;

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
                });
                placed = true;
                break;
            }
        }
        if (!placed) break;
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
}

let batchCount = 25000;
let batches: Batch[] = [];

function randomBoxBatch(now: number): Batch {
    const fromIdx = Math.floor(Math.random() * boxes.length);
    let toIdx = Math.floor(Math.random() * (boxes.length - 1));
    if (toIdx >= fromIdx) toIdx++;

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
    initBatches();
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

canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
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

canvas.addEventListener('mouseup', () => {
    isDragging = false;
    canvas.style.cursor = 'grab';
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    canvas.style.cursor = 'grab';
});

canvas.style.cursor = 'grab';

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
    const now = performance.now();

    // FPS
    frameCount++;
    if (now - lastFpsTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsTime = now;
    }

    // Remove finished batches
    for (let i = batches.length - 1; i >= 0; i--) {
        const progress = (now - batches[i].startTime) / batches[i].duration;
        if (progress >= 1) {
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

    // --- Draw circles (batches) instanced ---
    gl.useProgram(circleProgram);
    gl.uniformMatrix3fv(gl.getUniformLocation(circleProgram, 'u_transform'), false, transform);
    gl.uniform2fv(gl.getUniformLocation(circleProgram, 'u_resolution'), resolution);

    let circleCount = 0;
    let activeCount = 0;
    for (let i = 0; i < batches.length && circleCount < MAX_CIRCLES; i++) {
        const batch = batches[i];
        const progress = (now - batch.startTime) / batch.duration;
        if (progress < 0 || progress >= 1) continue;

        activeCount++;
        const p = Math.min(progress, 1);
        const x = batch.startX + (batch.endX - batch.startX) * p;
        const y = batch.startY + (batch.endY - batch.startY) * p;

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
    overlayCtx.restore();

    // HUD
    overlayCtx.fillStyle = 'white';
    overlayCtx.font = '16px monospace';
    overlayCtx.textAlign = 'start';
    overlayCtx.textBaseline = 'alphabetic';
    overlayCtx.fillText(`FPS: ${fps}`, 10, 24);
    overlayCtx.fillText(`Batches: ${batches.length} (visible: ${activeCount})`, 10, 46);
    overlayCtx.fillText(`Zoom: ${Math.round(zoomLevel * 100)}%`, 10, 68);
    overlayCtx.fillText(`Boxes: ${boxes.length}`, 10, 90);

    // Upload overlay to texture and draw as blended fullscreen quad
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, overlayCanvas);

    gl.useProgram(overlayProgram);
    gl.uniform1i(gl.getUniformLocation(overlayProgram, 'u_texture'), 0);
    gl.bindVertexArray(overlayVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindVertexArray(null);

    requestAnimationFrame(animate);
}

animate();
