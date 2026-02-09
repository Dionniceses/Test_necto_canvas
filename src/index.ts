const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// === Boxen ===
interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    color: string;
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

// World 5x zo groot als het scherm
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
                boxes.push({
                    x, y, w, h,
                    label: i < 26 ? String.fromCharCode(65 + i) : `${i + 1}`,
                    color: boxColors[i % boxColors.length],
                });
                placed = true;
                break;
            }
        }
        if (!placed) break; // geen ruimte meer
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
    color: string;
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
        color: from.color,
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

// Zoom state
let zoomLevel = 1;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 15;
let panX = 0;
let panY = 0;

const zoomLabel = document.getElementById('zoom-level')!;

function updateZoomLabel() {
    zoomLabel.textContent = `Zoom: ${Math.round(zoomLevel * 100)}%`;
}

// Scroll-zoom op cursorpositie
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(zoomLevel * factor, ZOOM_MIN), ZOOM_MAX);

    // Cursorpositie in world-space vóór zoom
    const mouseX = (e.offsetX - panX) / zoomLevel;
    const mouseY = (e.offsetY - panY) / zoomLevel;

    zoomLevel = newZoom;

    // Pas pan aan zodat het punt onder de cursor op dezelfde plek blijft
    panX = e.offsetX - mouseX * zoomLevel;
    panY = e.offsetY - mouseY * zoomLevel;

    updateZoomLabel();
}, { passive: false });

// Drag/pan met muisknop
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

    // Begrens pan binnen de world-grenzen
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

// FPS counter
let frameCount = 0;
let lastFpsTime = performance.now();
let fps = 0;

// Animatie-loop
function animate() {
    const now = performance.now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Zoom toepassen op cursorpositie
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoomLevel, zoomLevel);

    // FPS berekenen
    frameCount++;
    if (now - lastFpsTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsTime = now;
    }

    // Verwijder voltooide batches (ze verdwijnen bij aankomst)
    for (let i = batches.length - 1; i >= 0; i--) {
        const progress = (now - batches[i].startTime) / batches[i].duration;
        if (progress >= 1) {
            batches.splice(i, 1);
        }
    }

    // Spawn nieuwe batches om het aantal rond batchCount te houden
    const deficit = batchCount - batches.length;
    const spawnCount = deficit > 0
        ? Math.max(1, Math.floor(deficit * 0.1))
        : (Math.random() < 0.02 ? 1 : 0);
    for (let i = 0; i < spawnCount; i++) {
        const batch = randomBoxBatch(now);
        batch.startTime = now + Math.random() * 500;
        batches.push(batch);
    }

    // Teken boxen
    boxes.forEach(box => {
        ctx.fillStyle = box.color;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(box.label, boxCenterX(box), boxCenterY(box));
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';

    // Teken alle batches
    let activeCount = 0;
    batches.forEach((batch) => {
        const progress = (now - batch.startTime) / batch.duration;

        // Nog niet gestart
        if (progress < 0) return;

        activeCount++;
        const easedProgress = Math.min(progress, 1);
        const x = batch.startX + (batch.endX - batch.startX) * easedProgress;
        const y = batch.startY + (batch.endY - batch.startY) * easedProgress;

        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = batch.color;
        ctx.fill();
    });

    // Herstel transform zodat overlay niet meezoomt
    ctx.restore();

    // Toon FPS en batch-count overlay
    ctx.fillStyle = 'white';
    ctx.font = '16px monospace';
    ctx.fillText(`FPS: ${fps}`, 10, 24);
    ctx.fillText(`Batches: ${batches.length} (visible: ${activeCount})`, 10, 46);
    ctx.fillText(`Zoom: ${Math.round(zoomLevel * 100)}%`, 10, 68);

    requestAnimationFrame(animate);
}

animate();