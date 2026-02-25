import {
  EngineApi,
  EngineCounts,
  EngineInitElements,
  EngineInitOptions,
} from './engine.contract';
import { Batch, Box, BoxErrors, ErrorEntry, HudStats, Selection } from './engine.types';

declare const PIXI: any;

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

function hexToNum(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

function hexToRgb01(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** Pre-compute tint integer from rgb tuple */
function rgbToTint(rgb: [number, number, number]): number {
  return (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255);
}

interface BatchInternal extends Batch {
  tint: number;
}

export class PixiEngine implements EngineApi {
  private elements: EngineInitElements | null = null;
  private options: EngineInitOptions = {};
  private counts: EngineCounts = {
    batches: DEFAULT_BATCH_COUNT,
    boxes: DEFAULT_BOX_COUNT,
  };

  private running = false;
  private paused = false;
  private initialized = false;
  private requestedStart = false;
  private lastHudEmitTime = 0;
  private uncapFps = false;
  private uncapFrameId: number | null = null;

  private app: any = null;
  private worldContainer: any = null;

  // PixiJS layers (only dynamic things)
  private linesGraphics: any = null;
  private boxesGraphics: any = null;
  private highlightGraphics: any = null;
  private batchSpriteContainer: any = null;
  private errorSpriteContainer: any = null;

  private circleTexture: any = null;
  private errorCircleTexture: any = null;

  private batchSpritePool: any[] = [];
  private errorSpritePool: any[] = []; // just sprites, labels move to Canvas2D

  // Canvas 2D overlay for HUD + box labels (cheap text rendering)
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private overlayDirty = true;

  // Cached HUD values (only repaint overlay when changed)
  private lastHudFps = -1;
  private lastHudBatchStr = '';
  private lastHudZoomStr = '';
  private lastHudBoxCount = -1;
  private lastHudErrors = -1;
  private lastHudPaused = false;

  private highlightDirty = true;

  private readonly batchPosPool: { x: number; y: number; batch: BatchInternal | null }[] = [];
  private lastBatchPosCount = 0;

  private boxes: Box[] = [];
  private batches: BatchInternal[] = [];
  private boxErrorsMap: Map<number, BoxErrors> = new Map();
  private connectionEdges: [number, number][] = [];
  private cachedTotalErrors = 0;
  private errorsDirty = true;

  private activePopupBox: Box | null = null;
  private activePopupLine: { from: Box; to: Box } | null = null;
  private activePopupBatch: BatchInternal | null = null;
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

  private canvasEl: HTMLCanvasElement | null = null;

  private readonly boundWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly boundMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
  private readonly boundMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private readonly boundMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
  private readonly boundMouseLeave = () => this.handleMouseLeave();
  private readonly boundResizeHandler = () => this.resize();

  // ── Public API ──────────────────────────────────────────

  init(elements: EngineInitElements, options?: EngineInitOptions): void {
    if (this.initialized) this.dispose();
    this.elements = elements;
    this.options = options ?? {};
    this.uncapFps = this.options.uncapFps ?? false;
    this.counts = {
      batches: this.options.initialCounts?.batches ?? DEFAULT_BATCH_COUNT,
      boxes: this.options.initialCounts?.boxes ?? DEFAULT_BOX_COUNT,
    };

    this.asyncInit().catch((err) => {
      this.options.events?.onRendererError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }

  start(): void {
    if (this.initialized) {
      if (this.running) return;
      this.running = true;
      if (this.uncapFps) {
        this.app?.ticker?.stop();
        this.scheduleUncappedFrame();
      } else {
        this.app?.ticker?.start();
      }
    } else {
      this.requestedStart = true;
    }
  }

  stop(): void {
    this.running = false;
    this.app?.ticker?.stop();
    if (this.uncapFrameId !== null) {
      cancelAnimationFrame(this.uncapFrameId);
      this.uncapFrameId = null;
    }
  }

  resize(): void {
    const wrapper = this.elements?.wrapper;
    if (!wrapper || !this.app) return;
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    this.app.renderer.resize(w, h);
    this.worldW = w * 5;
    this.worldH = h * 5;
    // Resize overlay canvas to match
    if (this.overlayCanvas) {
      const dpr = window.devicePixelRatio || 1;
      this.overlayCanvas.width = w * dpr;
      this.overlayCanvas.height = h * dpr;
      this.overlayCanvas.style.width = `${w}px`;
      this.overlayCanvas.style.height = `${h}px`;
      this.overlayDirty = true;
    }
    this.applyPanConstraints();
    this.applyTransform();
  }

  setPaused(value: boolean): void {
    if (value === this.paused) return;
    if (value) {
      this.pauseStartTime = performance.now();
    } else {
      this.pauseTimeOffset += performance.now() - this.pauseStartTime;
    }
    this.paused = value;
    this.overlayDirty = true;
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
    this.highlightDirty = true;
    this.emitSelection({ kind: 'none' });
  }

  resetAvgFps(): void {
    this.fpsHistory = [];
    this.avgFps = 0;
  }

  dispose(): void {
    this.stop();
    this.unbindInteractionHandlers();

    if (this.app) {
      try { this.app.destroy(true); } catch { /* ignore */ }
      this.app = null;
    }

    // Remove overlay canvas
    if (this.overlayCanvas) {
      this.overlayCanvas.remove();
      this.overlayCanvas = null;
      this.overlayCtx = null;
    }

    this.worldContainer = null;
    this.linesGraphics = null;
    this.boxesGraphics = null;
    this.highlightGraphics = null;
    this.batchSpriteContainer = null;
    this.errorSpriteContainer = null;
    this.circleTexture = null;
    this.errorCircleTexture = null;
    this.batchSpritePool = [];
    this.errorSpritePool = [];
    this.canvasEl = null;

    this.boxes = [];
    this.batches = [];
    this.connectionEdges = [];
    this.boxErrorsMap.clear();
    this.elements = null;
    this.options = {};
    this.initialized = false;
  }

  // ── Async init ──────────────────────────────────────────

  private async asyncInit(): Promise<void> {
    if (!this.elements) return;
    const wrapper = this.elements.wrapper;
    const W = wrapper.clientWidth;
    const H = wrapper.clientHeight;

    // Hide the <canvas> Angular gave us — PixiJS creates its own
    this.elements.canvas.style.display = 'none';

    this.app = new PIXI.Application();
    await this.app.init({
      width: W,
      height: H,
      backgroundColor: 0x111111,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preferWebGLVersion: 2,
    });
    wrapper.appendChild(this.app.canvas);
    this.canvasEl = this.app.canvas as HTMLCanvasElement;
    this.canvasEl.style.position = 'absolute';
    this.canvasEl.style.top = '0';
    this.canvasEl.style.left = '0';
    this.canvasEl.style.cursor = 'grab';

    // Create Canvas 2D overlay on top of PixiJS canvas (for HUD + labels)
    this.overlayCanvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    this.overlayCanvas.width = W * dpr;
    this.overlayCanvas.height = H * dpr;
    this.overlayCanvas.style.width = `${W}px`;
    this.overlayCanvas.style.height = `${H}px`;
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none'; // clicks pass through to pixi canvas
    this.overlayCanvas.style.zIndex = '1';
    this.overlayCanvas.style.background = 'transparent';
    wrapper.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d')!;

    this.worldW = W * 5;
    this.worldH = H * 5;

    // World container (PixiJS scene graph — only dynamic sprites + static cached graphics)
    this.worldContainer = new PIXI.Container();
    this.worldContainer.isRenderGroup = true;
    this.app.stage.addChild(this.worldContainer);

    // No hudContainer in PixiJS anymore — HUD is drawn on overlayCanvas

    // Circle textures
    const cg = new PIXI.Graphics();
    cg.circle(0, 0, 16);
    cg.fill(0xffffff);
    this.circleTexture = this.app.renderer.generateTexture(cg);
    cg.destroy();

    const eg = new PIXI.Graphics();
    eg.circle(0, 0, 16);
    eg.fill(0xf02b2b);
    this.errorCircleTexture = this.app.renderer.generateTexture(eg);
    eg.destroy();

    // Graphics layers (only in PixiJS scene)
    this.linesGraphics = new PIXI.Graphics();
    this.boxesGraphics = new PIXI.Graphics();
    this.highlightGraphics = new PIXI.Graphics();

    this.batchSpriteContainer = new PIXI.Container();
    this.batchSpriteContainer.cullable = true;
    this.errorSpriteContainer = new PIXI.Container();
    this.errorSpriteContainer.cullable = true;

    this.worldContainer.addChild(this.linesGraphics);
    this.worldContainer.addChild(this.boxesGraphics);
    this.worldContainer.addChild(this.batchSpriteContainer);
    this.worldContainer.addChild(this.errorSpriteContainer);
    this.worldContainer.addChild(this.highlightGraphics);

    // No labelsContainer — box labels are drawn on overlayCanvas

    // Sprite pools
    this.ensureBatchSpritePool(200);
    this.ensureErrorSpritePool(20);

    // Simulation
    this.generateBoxes(this.counts.boxes);
    this.buildConnectionEdges();
    this.initBatches();

    // Interaction
    this.bindInteractionHandlers();

    // Initial transform + resize
    this.applyTransform();
    this.resize();

    // Ticker
    this.app.ticker.stop();
    this.app.ticker.add(() => this.tickFrame());

    this.initialized = true;
    this.lastFpsTime = performance.now();
    this.overlayDirty = true;
    this.emitZoom();
    this.emitSelection({ kind: 'none' });

    // Perform first render
    this.tickFrame();
    this.app.renderer.render(this.app.stage);

    if (this.requestedStart) {
      this.requestedStart = false;
      this.start();
    }
  }

  // ── Sprite pools ────────────────────────────────────────

  private ensureBatchSpritePool(needed: number): void {
    const scale = 6 / 16;
    while (this.batchSpritePool.length < needed) {
      const s = new PIXI.Sprite(this.circleTexture);
      s.anchor.set(0.5, 0.5);
      s.scale.set(scale);  // static — ParticleContainer has scale:false
      s.visible = false;
      this.batchSpriteContainer.addChild(s);
      this.batchSpritePool.push(s);
    }
  }

  private ensureErrorSpritePool(needed: number): void {
    const scale = 9 / 16;
    while (this.errorSpritePool.length < needed) {
      const s = new PIXI.Sprite(this.errorCircleTexture);
      s.anchor.set(0.5, 0.5);
      s.scale.set(scale);
      s.visible = false;
      this.errorSpriteContainer.addChild(s);
      this.errorSpritePool.push(s);
    }
  }

  // ── Uncapped frame loop ─────────────────────────────────

  private scheduleUncappedFrame(): void {
    if (!this.uncapFps || !this.running) return;
    this.uncapFrameId = requestAnimationFrame(() => {
      this.tickFrame();
      this.app?.renderer?.render(this.app.stage);
      this.scheduleUncappedFrame();
    });
  }

  // ── Frame tick ──────────────────────────────────────────

  private tickFrame(): void {
    if (!this.app || !this.worldContainer) return;

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
      this.overlayDirty = true; // FPS changed → repaint overlay
    }

    if (!this.paused) this.updateSimulation(now);

    // ── Batch sprites (only moving things) ──
    let activeCount = 0;
    this.lastBatchPosCount = 0;

    // Only grow pool when needed (not every frame)
    if (this.batches.length > this.batchSpritePool.length) {
      this.ensureBatchSpritePool(this.batches.length);
    }

    let spriteIdx = 0;
    for (let bi = 0; bi < this.batches.length; bi++) {
      const batch = this.batches[bi];
      const progress = (now - batch.startTime) / batch.duration;
      if (progress < 0 || progress >= 1) continue;
      activeCount++;
      const p = Math.min(progress, 1);
      const x = batch.startX + (batch.endX - batch.startX) * p;
      const y = batch.startY + (batch.endY - batch.startY) * p;

      if (this.lastBatchPosCount >= this.batchPosPool.length) {
        this.batchPosPool.push({ x: 0, y: 0, batch: null });
      }
      const bp = this.batchPosPool[this.lastBatchPosCount++];
      bp.x = x; bp.y = y; bp.batch = batch;

      const s = this.batchSpritePool[spriteIdx];
      s.x = x;
      s.y = y;
      s.tint = batch.tint; // pre-computed, no per-frame math
      s.visible = true;
      spriteIdx++;
    }
    // Hide remaining sprites
    for (let i = spriteIdx; i < this.batchSpritePool.length; i++) {
      if (!this.batchSpritePool[i].visible) break;
      this.batchSpritePool[i].visible = false;
    }

    // ── Error sprites (only update when errors changed) ──
    if (this.errorsDirty) {
      const errCount = this.boxErrorsMap.size;
      if (errCount > this.errorSpritePool.length) {
        this.ensureErrorSpritePool(errCount);
      }
      let errIdx = 0;
      for (const [, err] of this.boxErrorsMap) {
        const entry = this.errorSpritePool[errIdx];
        entry.x = err.x;
        entry.y = err.y;
        entry.visible = true;
        errIdx++;
      }
      for (let i = errIdx; i < this.errorSpritePool.length; i++) {
        if (!this.errorSpritePool[i].visible) break;
        this.errorSpritePool[i].visible = false;
      }
      this.errorsDirty = false;
      this.overlayDirty = true; // error count labels need redraw
    }

    // ── Highlight (only when dirty) ──
    if (this.highlightDirty) {
      this.highlightGraphics.clear();
      if (this.activePopupBox) {
        const b = this.activePopupBox;
        const pad = 4;
        this.highlightGraphics.rect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
        this.highlightGraphics.stroke({ width: 3, color: 0xffcc00 });
      }
      if (this.activePopupLine) {
        this.highlightGraphics.setStrokeStyle({ width: 2.5, color: 0xffcc00 });
        this.highlightGraphics.moveTo(this.boxCenterX(this.activePopupLine.from), this.boxCenterY(this.activePopupLine.from));
        this.highlightGraphics.lineTo(this.boxCenterX(this.activePopupLine.to), this.boxCenterY(this.activePopupLine.to));
        this.highlightGraphics.stroke();
      }
      if (this.activePopupErrors) {
        this.highlightGraphics.circle(this.activePopupErrors.x, this.activePopupErrors.y, 12);
        this.highlightGraphics.stroke({ width: 3, color: 0xffcc00 });
      }
      this.highlightDirty = false;
    }

    if (this.activePopupBatch) {
      let bp: { x: number; y: number } | undefined;
      for (let i = 0; i < this.lastBatchPosCount; i++) {
        if (this.batchPosPool[i].batch === this.activePopupBatch) { bp = this.batchPosPool[i]; break; }
      }
      if (bp) {
        this.highlightGraphics.clear();
        this.highlightGraphics.circle(bp.x, bp.y, 10);
        this.highlightGraphics.stroke({ width: 2.5, color: 0xffcc00 });
      }
    }

    // ── Canvas 2D overlay: HUD + box labels + error counts ──
    this.paintOverlay(activeCount);

    this.emitHud(activeCount);
  }

  // ── Canvas 2D overlay ───────────────────────────────────

  private paintOverlay(activeCount: number): void {
    const ctx = this.overlayCtx;
    if (!ctx || !this.overlayCanvas) return;

    // Check if anything changed
    const bStr = `Batches: ${this.batches.length} (visible: ${activeCount})`;
    const zStr = `Zoom: ${Math.round(this.zoomLevel * 100)}%`;

    if (
      this.fps !== this.lastHudFps ||
      bStr !== this.lastHudBatchStr ||
      zStr !== this.lastHudZoomStr ||
      this.boxes.length !== this.lastHudBoxCount ||
      this.cachedTotalErrors !== this.lastHudErrors ||
      this.paused !== this.lastHudPaused
    ) {
      this.overlayDirty = true;
    }

    if (!this.overlayDirty) return;
    this.overlayDirty = false;

    // Update cached values
    this.lastHudFps = this.fps;
    this.lastHudBatchStr = bStr;
    this.lastHudZoomStr = zStr;
    this.lastHudBoxCount = this.boxes.length;
    this.lastHudErrors = this.cachedTotalErrors;
    this.lastHudPaused = this.paused;

    const dpr = window.devicePixelRatio || 1;
    const W = this.overlayCanvas.width;
    const H = this.overlayCanvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(dpr, dpr);

    // ── HUD text (top-left, fixed position) ──
    ctx.font = '14px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`FPS: ${this.fps}`, 10, 20);
    ctx.fillText(`Avg FPS (1m): ${this.avgFps}`, 10, 38);
    ctx.fillText(bStr, 10, 56);
    ctx.fillText(zStr, 10, 74);
    ctx.fillText(`Boxes: ${this.boxes.length}`, 10, 92);
    ctx.fillText(`Errors: ${this.cachedTotalErrors}`, 10, 110);
    if (this.paused) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('PAUSED', 10, 132);
    }

    // ── Box labels (world-space, transformed) ──
    ctx.font = '11px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const box of this.boxes) {
      const wx = this.boxCenterX(box) * this.zoomLevel + this.panX;
      const wy = this.boxCenterY(box) * this.zoomLevel + this.panY;
      // Simple culling: skip labels outside viewport
      if (wx < -50 || wx > W / dpr + 50 || wy < -20 || wy > H / dpr + 20) continue;
      ctx.fillText(box.label, wx, wy);
    }

    // ── Error count labels (world-space, transformed) ──
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    for (const [, err] of this.boxErrorsMap) {
      const wx = err.x * this.zoomLevel + this.panX;
      const wy = err.y * this.zoomLevel + this.panY;
      if (wx < -30 || wx > W / dpr + 30 || wy < -15 || wy > H / dpr + 15) continue;
      ctx.fillText(`${err.entries.length}`, wx, wy);
    }

    ctx.restore();
  }

  // ── Simulation ──────────────────────────────────────────

  private updateSimulation(now: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.batches.length; i++) {
      const b = this.batches[i];
      if ((now - b.startTime) / b.duration >= 1) {
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

  // ── Static drawing ──────────────────────────────────────

  private drawStaticLines(): void {
    this.linesGraphics.cacheAsTexture(false);
    this.linesGraphics.clear();
    this.linesGraphics.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.15 });
    for (const [i, j] of this.connectionEdges) {
      this.linesGraphics.moveTo(this.boxCenterX(this.boxes[i]), this.boxCenterY(this.boxes[i]));
      this.linesGraphics.lineTo(this.boxCenterX(this.boxes[j]), this.boxCenterY(this.boxes[j]));
    }
    this.linesGraphics.stroke();
    this.linesGraphics.cacheAsTexture(true);
  }

  private drawStaticBoxes(): void {
    this.boxesGraphics.cacheAsTexture(false);
    this.boxesGraphics.clear();
    for (const box of this.boxes) {
      this.boxesGraphics.rect(box.x, box.y, box.w, box.h);
      this.boxesGraphics.fill(hexToNum(box.color));
      this.boxesGraphics.rect(box.x, box.y, box.w, box.h);
      this.boxesGraphics.stroke({ width: 2, color: 0xffffff });
    }
    this.boxesGraphics.cacheAsTexture(true);
  }

  // ── Simulation helpers ──────────────────────────────────

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
            rgb: hexToRgb01(color),
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

    if (this.boxesGraphics) {
      this.drawStaticBoxes();
      this.overlayDirty = true; // labels changed
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
    if (this.linesGraphics) this.drawStaticLines();
  }

  private randomBoxBatch(now: number): BatchInternal | null {
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
      tint: rgbToTint(from.rgb), // pre-computed tint
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
    this.cachedTotalErrors++;
    this.errorsDirty = true;
    if (this.activePopupErrors && this.activePopupErrors.boxIdx === toIdx) {
      this.emitSelection({ kind: 'error', errors: this.activePopupErrors });
    }
  }

  private rebuildWorldForCounts(): void {
    this.generateBoxes(this.counts.boxes);
    this.buildConnectionEdges();
    this.boxErrorsMap = new Map();
    this.cachedTotalErrors = 0;
    this.errorsDirty = true;
    this.initBatches();
    this.clearSelection();
  }

  // ── Transform ───────────────────────────────────────────

  private applyTransform(): void {
    if (!this.worldContainer) return;
    this.worldContainer.x = this.panX;
    this.worldContainer.y = this.panY;
    this.worldContainer.scale.set(this.zoomLevel, this.zoomLevel);
    this.overlayDirty = true; // labels need repositioning
  }

  private applyPanConstraints(): void {
    const wrapper = this.elements?.wrapper;
    if (!wrapper) return;
    const W = wrapper.clientWidth;
    const H = wrapper.clientHeight;
    const minPanX = W - this.worldW * this.zoomLevel;
    const minPanY = H - this.worldH * this.zoomLevel;
    this.panX = Math.min(0, Math.max(minPanX, this.panX));
    this.panY = Math.min(0, Math.max(minPanY, this.panY));
  }

  // ── Interaction ─────────────────────────────────────────

  private bindInteractionHandlers(): void {
    if (!this.canvasEl || typeof window === 'undefined') return;
    window.addEventListener('resize', this.boundResizeHandler);
    this.canvasEl.addEventListener('wheel', this.boundWheel, { passive: false });
    this.canvasEl.addEventListener('mousedown', this.boundMouseDown);
    this.canvasEl.addEventListener('mousemove', this.boundMouseMove);
    this.canvasEl.addEventListener('mouseup', this.boundMouseUp);
    this.canvasEl.addEventListener('mouseleave', this.boundMouseLeave);
  }

  private unbindInteractionHandlers(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('resize', this.boundResizeHandler);
    if (!this.canvasEl) return;
    this.canvasEl.removeEventListener('wheel', this.boundWheel);
    this.canvasEl.removeEventListener('mousedown', this.boundMouseDown);
    this.canvasEl.removeEventListener('mousemove', this.boundMouseMove);
    this.canvasEl.removeEventListener('mouseup', this.boundMouseUp);
    this.canvasEl.removeEventListener('mouseleave', this.boundMouseLeave);
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(this.zoomLevel * factor, ZOOM_MIN), ZOOM_MAX);
    const rect = this.canvasEl!.getBoundingClientRect();
    const mouseX = ((event.clientX - rect.left) - this.panX) / this.zoomLevel;
    const mouseY = ((event.clientY - rect.top) - this.panY) / this.zoomLevel;
    this.zoomLevel = newZoom;
    this.panX = (event.clientX - rect.left) - mouseX * this.zoomLevel;
    this.panY = (event.clientY - rect.top) - mouseY * this.zoomLevel;
    this.applyPanConstraints();
    this.applyTransform();
    this.emitZoom();
  }

  private handleMouseDown(event: MouseEvent): void {
    this.isDragging = true;
    this.mouseDownX = event.clientX;
    this.mouseDownY = event.clientY;
    this.dragStartX = event.clientX - this.panX;
    this.dragStartY = event.clientY - this.panY;
    if (this.canvasEl) this.canvasEl.style.cursor = 'grabbing';
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging) return;
    this.panX = event.clientX - this.dragStartX;
    this.panY = event.clientY - this.dragStartY;
    this.applyPanConstraints();
    this.applyTransform();
  }

  private handleMouseUp(event: MouseEvent): void {
    const wasDrag = Math.abs(event.clientX - this.mouseDownX) > 5 || Math.abs(event.clientY - this.mouseDownY) > 5;
    this.isDragging = false;
    if (this.canvasEl) this.canvasEl.style.cursor = 'grab';
    if (wasDrag || !this.canvasEl) return;

    const rect = this.canvasEl.getBoundingClientRect();
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
    if (this.canvasEl) this.canvasEl.style.cursor = 'grab';
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

  private findClickedBatch(worldX: number, worldY: number): BatchInternal | null {
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
    const wrapper = this.elements?.wrapper;
    if (!wrapper) return;
    this.zoomLevel = CLICK_ZOOM;
    this.panX = wrapper.clientWidth / 2 - x * this.zoomLevel;
    this.panY = wrapper.clientHeight / 2 - y * this.zoomLevel;
    this.applyPanConstraints();
    this.applyTransform();
    this.emitZoom();
  }

  private openBoxSelection(box: Box): void {
    this.activePopupBox = box;
    this.activePopupLine = null;
    this.activePopupBatch = null;
    this.activePopupErrors = null;
    this.highlightDirty = true;
    this.focusOnWorldPoint(this.boxCenterX(box), this.boxCenterY(box));
    this.emitSelection({ kind: 'box', box });
  }

  private openLineSelection(from: Box, to: Box): void {
    this.activePopupBox = null;
    this.activePopupLine = { from, to };
    this.activePopupBatch = null;
    this.activePopupErrors = null;
    this.highlightDirty = true;
    this.focusOnWorldPoint(
      (this.boxCenterX(from) + this.boxCenterX(to)) / 2,
      (this.boxCenterY(from) + this.boxCenterY(to)) / 2,
    );
    this.emitSelection({ kind: 'line', from, to });
  }

  private openBatchSelection(batch: BatchInternal): void {
    this.activePopupBox = null;
    this.activePopupLine = null;
    this.activePopupBatch = batch;
    this.activePopupErrors = null;
    this.highlightDirty = true;
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
    this.highlightDirty = true;
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
      totalErrors: this.cachedTotalErrors,
      paused: this.paused,
    };
    this.options.events?.onHudUpdate?.(stats);
  }
}
