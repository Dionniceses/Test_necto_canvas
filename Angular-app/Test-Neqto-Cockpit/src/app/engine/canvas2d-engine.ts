import {
  EngineApi,
  EngineCounts,
  EngineInitElements,
  EngineInitOptions,
} from './engine.contract';
import { Batch, Box, BoxErrors, ErrorEntry, HudStats, Selection } from './engine.types';

const DEFAULT_BATCH_COUNT = 50;
const DEFAULT_BOX_COUNT = 75;

const BOX_W = 70;
const BOX_H = 35;
const SMALL_BOX_W = 50;
const SMALL_BOX_H = 28;
const BOX_SPACING = 15;

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 15;
const CLICK_ZOOM = 3;

const ERROR_CHANCE = 0.003;
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

const boxColors = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d946ef', '#10b981',
  '#facc15', '#8b5cf6', '#fb923c', '#2dd4bf', '#f43f5e',
  '#4ade80', '#818cf8', '#fbbf24', '#38bdf8', '#c084fc',
];

export class Canvas2dEngine implements EngineApi {
  private elements: EngineInitElements | null = null;
  private options: EngineInitOptions = {};
  private counts: EngineCounts = {
    batches: DEFAULT_BATCH_COUNT,
    boxes: DEFAULT_BOX_COUNT,
  };

  private running = false;
  private paused = false;
  private rafId: number | null = null;
  private initialized = false;
  private lastHudEmitTime = 0;
  private uncapFps = false;

  private ctx: CanvasRenderingContext2D | null = null;

  private readonly batchPosPool: { x: number; y: number; batch: Batch | null }[] = [];
  private lastBatchPosCount = 0;

  private boxes: Box[] = [];
  private batches: Batch[] = [];
  private boxErrorsMap: Map<number, BoxErrors> = new Map();
  private connectionEdges: [number, number][] = [];

  private activePopupBox: Box | null = null;
  private activePopupLine: { from: Box; to: Box } | null = null;
  private activePopupBatch: Batch | null = null;
  private activePopupErrors: BoxErrors | null = null;

  private frameCount = 0;
  private lastFpsTime = 0;
  private fps = 0;
  private fpsHistory: number[] = [];
  private avgFps = 0;
  private errorIdCounter = 0;

  private pauseTimeOffset = 0;
  private pauseStartTime = 0;

  private zoomLevel = 0.2;
  private panX = 0;
  private panY = 0;
  private worldW = 0;
  private worldH = 0;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private mouseDownX = 0;
  private mouseDownY = 0;

  private readonly boundWheel = (event: WheelEvent) => this.handleWheel(event);
  private readonly boundMouseDown = (event: MouseEvent) => this.handleMouseDown(event);
  private readonly boundMouseMove = (event: MouseEvent) => this.handleMouseMove(event);
  private readonly boundMouseUp = (event: MouseEvent) => this.handleMouseUp(event);
  private readonly boundMouseLeave = () => this.handleMouseLeave();
  private readonly boundResizeHandler = () => this.resize();
  private readonly boundFrameHandler = (_time: number) => this.frame(_time);

  init(elements: EngineInitElements, options?: EngineInitOptions): void {
    if (this.initialized) {
      this.dispose();
    }

    this.elements = elements;
    this.options = options ?? {};
    this.uncapFps = this.options.uncapFps ?? false;
    this.counts = {
      batches: this.options.initialCounts?.batches ?? DEFAULT_BATCH_COUNT,
      boxes: this.options.initialCounts?.boxes ?? DEFAULT_BOX_COUNT,
    };

    try {
      this.setupRenderer();
      this.setupSimulation();
      this.bindInteractionHandlers();
      this.initialized = true;
      this.lastFpsTime = performance.now();
      this.emitZoom();
      this.emitSelection({ kind: 'none' });
    } catch (error) {
      const rendererError = error instanceof Error ? error : new Error('Canvas2D engine init failed');
      this.options.events?.onRendererError?.(rendererError);
      this.dispose();
    }
  }

  start(): void {
    if (!this.initialized || this.running || typeof window === 'undefined') return;
    this.running = true;
    if (this.uncapFps) {
      this.rafId = setTimeout(this.boundFrameHandler, 0) as unknown as number;
    } else {
      this.rafId = window.requestAnimationFrame(this.boundFrameHandler);
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.rafId);
      clearTimeout(this.rafId);
      this.rafId = null;
    }
  }

  resize(): void {
    this.handleRendererResize();
  }

  setPaused(value: boolean): void {
    if (value === this.paused) return;
    if (value) {
      this.pauseStartTime = performance.now();
    } else {
      this.pauseTimeOffset += performance.now() - this.pauseStartTime;
    }
    this.paused = value;
  }

  setCounts(counts: EngineCounts): void {
    this.counts = {
      batches: Math.max(0, Math.floor(counts.batches)),
      boxes: Math.max(1, Math.floor(counts.boxes)),
    };
    this.paused = false;
    this.pauseTimeOffset = 0;
    this.pauseStartTime = 0;
    this.rebuildWorldForCounts();
  }

  clearSelection(): void {
    this.activePopupBox = null;
    this.activePopupLine = null;
    this.activePopupBatch = null;
    this.activePopupErrors = null;
    this.emitSelection({ kind: 'none' });
  }

  resetAvgFps(): void {
    this.fpsHistory = [];
    this.avgFps = 0;
  }

  dispose(): void {
    this.stop();
    this.unbindInteractionHandlers();
    this.ctx = null;
    this.boxes = [];
    this.batches = [];
    this.connectionEdges = [];
    this.boxErrorsMap.clear();
    this.elements = null;
    this.options = {};
    this.initialized = false;
  }

  // ── Renderer Setup ──────────────────────────────────────

  private setupRenderer(): void {
    if (!this.elements) return;
    const ctx = this.elements.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.resize();
  }

  private setupSimulation(): void {
    this.generateBoxes(this.counts.boxes);
    this.buildConnectionEdges();
    this.initBatches();
  }

  private handleRendererResize(): void {
    const canvas = this.elements?.canvas;
    const wrapper = this.elements?.wrapper;
    if (!canvas || !wrapper) return;
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;
    this.worldW = canvas.width * 5;
    this.worldH = canvas.height * 5;
    this.applyPanConstraints();
  }

  private rebuildWorldForCounts(): void {
    this.generateBoxes(this.counts.boxes);
    this.buildConnectionEdges();
    this.boxErrorsMap = new Map();
    this.initBatches();
    this.clearSelection();
  }

  // ── Interaction ─────────────────────────────────────────

  private bindInteractionHandlers(): void {
    if (!this.elements || typeof window === 'undefined') return;
    const canvas = this.elements.canvas;
    window.addEventListener('resize', this.boundResizeHandler);
    canvas.addEventListener('wheel', this.boundWheel, { passive: false });
    canvas.addEventListener('mousedown', this.boundMouseDown);
    canvas.addEventListener('mousemove', this.boundMouseMove);
    canvas.addEventListener('mouseup', this.boundMouseUp);
    canvas.addEventListener('mouseleave', this.boundMouseLeave);
    canvas.style.cursor = 'grab';
  }

  private unbindInteractionHandlers(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('resize', this.boundResizeHandler);
    const canvas = this.elements?.canvas;
    if (!canvas) return;
    canvas.removeEventListener('wheel', this.boundWheel);
    canvas.removeEventListener('mousedown', this.boundMouseDown);
    canvas.removeEventListener('mousemove', this.boundMouseMove);
    canvas.removeEventListener('mouseup', this.boundMouseUp);
    canvas.removeEventListener('mouseleave', this.boundMouseLeave);
  }

  // ── Frame loop ──────────────────────────────────────────

  private frame(_time: number): void {
    if (!this.running) return;
    if (!this.paused) this.updateSimulation();
    this.renderFrame();
    if (typeof window !== 'undefined') {
      if (this.uncapFps) {
        this.rafId = setTimeout(this.boundFrameHandler, 0) as unknown as number;
      } else {
        this.rafId = window.requestAnimationFrame(this.boundFrameHandler);
      }
    }
  }

  private updateSimulation(): void {
    const now = performance.now() - this.pauseTimeOffset;
    let writeIdx = 0;
    for (let i = 0; i < this.batches.length; i++) {
      const b = this.batches[i];
      const progress = (now - b.startTime) / b.duration;
      if (progress >= 1) {
        if (Math.random() < ERROR_CHANCE) this.addError(b.fromIdx, b.toIdx);
      } else {
        this.batches[writeIdx++] = b;
      }
    }
    this.batches.length = writeIdx;

    const deficit = this.counts.batches - this.batches.length;
    const spawnCount = deficit > 0
      ? Math.max(1, Math.floor(deficit * 0.1))
      : Math.random() < 0.02 ? 1 : 0;
    for (let i = 0; i < spawnCount; i++) {
      const batch = this.randomBoxBatch(now);
      if (!batch) continue;
      batch.startTime = now + Math.random() * 500;
      this.batches.push(batch);
    }
  }

  // ── Render ──────────────────────────────────────────────

  private renderFrame(): void {
    const ctx = this.ctx;
    const canvas = this.elements?.canvas;
    if (!ctx || !canvas) return;

    const realNow = performance.now();
    const now = this.paused
      ? this.pauseStartTime - this.pauseTimeOffset
      : realNow - this.pauseTimeOffset;

    this.frameCount++;
    if (realNow - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = realNow;
      this.fpsHistory.push(this.fps);
      if (this.fpsHistory.length > 60) this.fpsHistory.shift();
      this.avgFps = Math.round(this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length);
    }

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoomLevel, this.zoomLevel);

    // Lines
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1 / this.zoomLevel;
    ctx.beginPath();
    for (const [i, j] of this.connectionEdges) {
      ctx.moveTo(this.boxCenterX(this.boxes[i]), this.boxCenterY(this.boxes[i]));
      ctx.lineTo(this.boxCenterX(this.boxes[j]), this.boxCenterY(this.boxes[j]));
    }
    ctx.stroke();

    // Boxes
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const box of this.boxes) {
      ctx.fillStyle = box.color;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2 / this.zoomLevel;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = 'white';
      ctx.fillText(box.label, this.boxCenterX(box), this.boxCenterY(box));
    }

    // Batch circles
    let activeCount = 0;
    this.lastBatchPosCount = 0;
    for (const batch of this.batches) {
      const progress = (now - batch.startTime) / batch.duration;
      if (progress < 0 || progress >= 1) continue;
      activeCount++;
      const p = Math.min(progress, 1);
      const x = batch.startX + (batch.endX - batch.startX) * p;
      const y = batch.startY + (batch.endY - batch.startY) * p;

      if (this.lastBatchPosCount >= this.batchPosPool.length) {
        this.batchPosPool.push({ x: 0, y: 0, batch: null });
      }
      const pooled = this.batchPosPool[this.lastBatchPosCount++];
      pooled.x = x; pooled.y = y; pooled.batch = batch;

      const [r, g, b] = batch.rgb;
      ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Error circles
    for (const [, err] of this.boxErrorsMap) {
      ctx.fillStyle = '#f02b2b';
      ctx.beginPath();
      ctx.arc(err.x, err.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${err.entries.length}`, err.x, err.y);
    }

    // Highlights
    if (this.activePopupBox) {
      const b = this.activePopupBox;
      const pad = 4;
      ctx.save();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 3 / this.zoomLevel;
      ctx.shadowColor = '#ffcc00';
      ctx.shadowBlur = 12 / this.zoomLevel;
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.restore();
    }

    if (this.activePopupLine) {
      ctx.save();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2.5 / this.zoomLevel;
      ctx.shadowColor = '#ffcc00';
      ctx.shadowBlur = 10 / this.zoomLevel;
      ctx.beginPath();
      ctx.moveTo(this.boxCenterX(this.activePopupLine.from), this.boxCenterY(this.activePopupLine.from));
      ctx.lineTo(this.boxCenterX(this.activePopupLine.to), this.boxCenterY(this.activePopupLine.to));
      ctx.stroke();
      ctx.restore();
    }

    if (this.activePopupBatch) {
      let pos: { x: number; y: number } | null = null;
      for (let i = 0; i < this.lastBatchPosCount; i++) {
        if (this.batchPosPool[i].batch === this.activePopupBatch) {
          pos = this.batchPosPool[i];
          break;
        }
      }
      if (pos) {
        ctx.save();
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2.5 / this.zoomLevel;
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 14 / this.zoomLevel;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (this.activePopupErrors) {
      ctx.save();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 3 / this.zoomLevel;
      ctx.shadowColor = '#ffcc00';
      ctx.shadowBlur = 12 / this.zoomLevel;
      ctx.beginPath();
      ctx.arc(this.activePopupErrors.x, this.activePopupErrors.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // HUD
    ctx.fillStyle = 'white';
    ctx.font = '16px monospace';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`FPS: ${this.fps}`, 10, 24);
    ctx.fillText(`Avg FPS (1m): ${this.avgFps}`, 10, 42);
    ctx.fillText(`Batches: ${this.batches.length} (visible: ${activeCount})`, 10, 60);
    ctx.fillText(`Zoom: ${Math.round(this.zoomLevel * 100)}%`, 10, 78);
    ctx.fillText(`Boxes: ${this.boxes.length}`, 10, 96);
    ctx.fillText(`Errors: ${this.totalErrors()}`, 10, 114);
    if (this.paused) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('PAUSED', 10, 140);
    }

    this.emitHud(activeCount);
  }

  // ── Simulation helpers ──────────────────────────────────

  private hexToRgb(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  }

  private boxesOverlap(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    return !(
      a.x + a.w + BOX_SPACING < b.x ||
      b.x + b.w + BOX_SPACING < a.x ||
      a.y + a.h + BOX_SPACING < b.y ||
      b.y + b.h + BOX_SPACING < a.y
    );
  }

  private generateBoxes(count: number): void {
    this.boxes = [];
    for (let i = 0; i < count; i++) {
      const isSmall = i >= Math.ceil(count / 3);
      const w = isSmall ? SMALL_BOX_W : BOX_W;
      const h = isSmall ? SMALL_BOX_H : BOX_H;
      let placed = false;
      for (let attempt = 0; attempt < 300; attempt++) {
        const x = Math.random() * Math.max(1, this.worldW - w);
        const y = Math.random() * Math.max(1, this.worldH - h);
        const candidate = { x, y, w, h };
        if (!this.boxes.some((box) => this.boxesOverlap(candidate, box))) {
          const color = boxColors[i % boxColors.length];
          this.boxes.push({
            x, y, w, h,
            label: i < 26 ? String.fromCharCode(65 + i) : `${i + 1}`,
            color,
            rgb: this.hexToRgb(color),
            connections: [],
          });
          placed = true;
          break;
        }
      }
      if (!placed) break;
    }

    for (let i = 0; i < this.boxes.length; i++) {
      const numConnections = 2 + Math.floor(Math.random() * 3);
      const available = Array.from({ length: this.boxes.length }, (_, k) => k).filter((k) => k !== i);
      for (let c = 0; c < numConnections && available.length > 0; c++) {
        const pick = Math.floor(Math.random() * available.length);
        const target = available[pick];
        available.splice(pick, 1);
        if (!this.boxes[i].connections.includes(target)) this.boxes[i].connections.push(target);
        if (!this.boxes[target].connections.includes(i)) this.boxes[target].connections.push(i);
      }
    }
  }

  private buildConnectionEdges(): void {
    this.connectionEdges = [];
    const seen = new Set<string>();
    for (let i = 0; i < this.boxes.length; i++) {
      for (const j of this.boxes[i].connections) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          this.connectionEdges.push([i, j]);
        }
      }
    }
  }

  private randomBoxBatch(now: number): Batch | null {
    if (this.connectionEdges.length === 0) return null;
    const edge = this.connectionEdges[Math.floor(Math.random() * this.connectionEdges.length)];
    const [fromIdx, toIdx] = Math.random() < 0.5 ? [edge[0], edge[1]] : [edge[1], edge[0]];
    const from = this.boxes[fromIdx];
    const to = this.boxes[toIdx];
    if (!from || !to) return null;
    return {
      startX: this.boxCenterX(from),
      startY: this.boxCenterY(from),
      endX: this.boxCenterX(to),
      endY: this.boxCenterY(to),
      startTime: now,
      duration: 1500 + Math.random() * 3500,
      rgb: from.rgb,
      fromIdx,
      toIdx,
    };
  }

  private initBatches(): void {
    this.batches = [];
    const now = performance.now() - this.pauseTimeOffset;
    for (let i = 0; i < this.counts.batches; i++) {
      const batch = this.randomBoxBatch(now);
      if (!batch) continue;
      if (Math.random() < 0.7) {
        batch.startTime = now - Math.random() * 0.8 * batch.duration;
      } else {
        batch.startTime = now + Math.random() * 3000;
      }
      this.batches.push(batch);
    }
  }

  private boxCenterX(box: Box): number { return box.x + box.w / 2; }
  private boxCenterY(box: Box): number { return box.y + box.h / 2; }

  private getErrorPosition(box: Box): { x: number; y: number } {
    return { x: box.x + box.w + 10, y: box.y - 5 };
  }

  private addError(fromIdx: number, toIdx: number): void {
    const box = this.boxes[toIdx];
    if (!box) return;
    const entry: ErrorEntry = {
      id: this.errorIdCounter++,
      message: errorMessages[Math.floor(Math.random() * errorMessages.length)],
      severity: errorSeverities[Math.floor(Math.random() * errorSeverities.length)],
      timestamp: Date.now(),
      fromIdx,
      toIdx,
    };
    if (!this.boxErrorsMap.has(toIdx)) {
      const pos = this.getErrorPosition(box);
      this.boxErrorsMap.set(toIdx, { x: pos.x, y: pos.y, boxIdx: toIdx, entries: [] });
    }
    this.boxErrorsMap.get(toIdx)?.entries.push(entry);
    if (this.activePopupErrors && this.activePopupErrors.boxIdx === toIdx) {
      this.emitSelection({ kind: 'error', errors: this.activePopupErrors });
    }
  }

  private totalErrors(): number {
    let total = 0;
    for (const [, v] of this.boxErrorsMap) total += v.entries.length;
    return total;
  }

  // ── Zoom / Pan ──────────────────────────────────────────

  private applyPanConstraints(): void {
    const canvas = this.elements?.canvas;
    if (!canvas) return;
    const minPanX = canvas.width - this.worldW * this.zoomLevel;
    const minPanY = canvas.height - this.worldH * this.zoomLevel;
    this.panX = Math.min(0, Math.max(minPanX, this.panX));
    this.panY = Math.min(0, Math.max(minPanY, this.panY));
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(this.zoomLevel * factor, ZOOM_MIN), ZOOM_MAX);
    const mouseX = (event.offsetX - this.panX) / this.zoomLevel;
    const mouseY = (event.offsetY - this.panY) / this.zoomLevel;
    this.zoomLevel = newZoom;
    this.panX = event.offsetX - mouseX * this.zoomLevel;
    this.panY = event.offsetY - mouseY * this.zoomLevel;
    this.applyPanConstraints();
    this.emitZoom();
  }

  private handleMouseDown(event: MouseEvent): void {
    this.isDragging = true;
    this.mouseDownX = event.clientX;
    this.mouseDownY = event.clientY;
    this.dragStartX = event.clientX - this.panX;
    this.dragStartY = event.clientY - this.panY;
    if (this.elements) this.elements.canvas.style.cursor = 'grabbing';
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging) return;
    this.panX = event.clientX - this.dragStartX;
    this.panY = event.clientY - this.dragStartY;
    this.applyPanConstraints();
  }

  private handleMouseUp(event: MouseEvent): void {
    const wasDrag = Math.abs(event.clientX - this.mouseDownX) > 5 || Math.abs(event.clientY - this.mouseDownY) > 5;
    this.isDragging = false;
    if (this.elements) this.elements.canvas.style.cursor = 'grab';
    if (wasDrag || !this.elements) return;

    const rect = this.elements.canvas.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - this.panX) / this.zoomLevel;
    const worldY = (event.clientY - rect.top - this.panY) / this.zoomLevel;

    const clickedBox = this.boxes.find(
      (box) => worldX >= box.x && worldX <= box.x + box.w && worldY >= box.y && worldY <= box.y + box.h,
    );
    if (clickedBox) { this.openBoxSelection(clickedBox); return; }

    const clickedError = this.findClickedError(worldX, worldY);
    if (clickedError) { this.openErrorSelection(clickedError); return; }

    const clickedBatch = this.findClickedBatch(worldX, worldY);
    if (clickedBatch) { this.openBatchSelection(clickedBatch); return; }

    const clickedLine = this.findClickedLine(worldX, worldY);
    if (clickedLine) { this.openLineSelection(clickedLine.from, clickedLine.to); return; }

    this.clearSelection();
  }

  private handleMouseLeave(): void {
    this.isDragging = false;
    if (this.elements) this.elements.canvas.style.cursor = 'grab';
  }

  // ── Hit testing ─────────────────────────────────────────

  private pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  private findClickedLine(worldX: number, worldY: number): { from: Box; to: Box } | null {
    const threshold = 8 / this.zoomLevel;
    const drawn = new Set<string>();
    let best: { from: Box; to: Box; dist: number } | null = null;
    for (let i = 0; i < this.boxes.length; i++) {
      for (const j of this.boxes[i].connections) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const dist = this.pointToSegmentDist(worldX, worldY,
          this.boxCenterX(this.boxes[i]), this.boxCenterY(this.boxes[i]),
          this.boxCenterX(this.boxes[j]), this.boxCenterY(this.boxes[j]));
        if (dist < threshold && (!best || dist < best.dist)) {
          best = { from: this.boxes[i], to: this.boxes[j], dist };
        }
      }
    }
    return best;
  }

  private findClickedBatch(worldX: number, worldY: number): Batch | null {
    const threshold = 10 / this.zoomLevel;
    const threshSq = threshold * threshold;
    for (let i = 0; i < this.lastBatchPosCount; i++) {
      const p = this.batchPosPool[i];
      const dx = worldX - p.x, dy = worldY - p.y;
      if (dx * dx + dy * dy < threshSq) return p.batch;
    }
    return null;
  }

  private findClickedError(worldX: number, worldY: number): BoxErrors | null {
    const threshold = 12 / this.zoomLevel;
    for (const [, err] of this.boxErrorsMap) {
      if (Math.hypot(worldX - err.x, worldY - err.y) < threshold) return err;
    }
    return null;
  }

  // ── Selection ───────────────────────────────────────────

  private focusOnWorldPoint(x: number, y: number): void {
    const canvas = this.elements?.canvas;
    if (!canvas) return;
    this.zoomLevel = CLICK_ZOOM;
    this.panX = canvas.width / 2 - x * this.zoomLevel;
    this.panY = canvas.height / 2 - y * this.zoomLevel;
    this.applyPanConstraints();
    this.emitZoom();
  }

  private openBoxSelection(box: Box): void {
    this.activePopupBox = box;
    this.activePopupLine = null;
    this.activePopupBatch = null;
    this.activePopupErrors = null;
    this.focusOnWorldPoint(this.boxCenterX(box), this.boxCenterY(box));
    this.emitSelection({ kind: 'box', box });
  }

  private openLineSelection(from: Box, to: Box): void {
    this.activePopupBox = null;
    this.activePopupLine = { from, to };
    this.activePopupBatch = null;
    this.activePopupErrors = null;
    this.focusOnWorldPoint(
      (this.boxCenterX(from) + this.boxCenterX(to)) / 2,
      (this.boxCenterY(from) + this.boxCenterY(to)) / 2,
    );
    this.emitSelection({ kind: 'line', from, to });
  }

  private openBatchSelection(batch: Batch): void {
    this.activePopupBox = null;
    this.activePopupLine = null;
    this.activePopupBatch = batch;
    this.activePopupErrors = null;
    const from = this.boxes[batch.fromIdx];
    const to = this.boxes[batch.toIdx];
    if (from && to) {
      this.emitSelection({ kind: 'batch', batch, from, to });
    } else {
      this.emitSelection({ kind: 'none' });
    }
  }

  private openErrorSelection(errors: BoxErrors): void {
    this.activePopupBox = null;
    this.activePopupLine = null;
    this.activePopupBatch = null;
    this.activePopupErrors = errors;
    this.focusOnWorldPoint(errors.x, errors.y);
    this.emitSelection({ kind: 'error', errors });
  }

  // ── Emit ────────────────────────────────────────────────

  private emitSelection(selection: Selection): void {
    this.options.events?.onSelectionChange?.(selection);
  }

  private emitZoom(): void {
    this.options.events?.onZoomChange?.(Math.round(this.zoomLevel * 100));
  }

  private emitHud(visibleBatches: number): void {
    const now = performance.now();
    if (now - this.lastHudEmitTime < 250) return;
    this.lastHudEmitTime = now;
    const stats: HudStats = {
      fps: this.fps,
      avgFps: this.avgFps,
      totalBatches: this.batches.length,
      visibleBatches,
      zoomPercent: Math.round(this.zoomLevel * 100),
      boxCount: this.boxes.length,
      totalErrors: this.totalErrors(),
      paused: this.paused,
    };
    this.options.events?.onHudUpdate?.(stats);
  }
}
