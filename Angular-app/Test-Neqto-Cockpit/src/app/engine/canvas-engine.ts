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
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
  '#e11d48',
  '#0ea5e9',
  '#d946ef',
  '#10b981',
  '#facc15',
  '#8b5cf6',
  '#fb923c',
  '#2dd4bf',
  '#f43f5e',
  '#4ade80',
  '#818cf8',
  '#fbbf24',
  '#38bdf8',
  '#c084fc',
];

const circleVS = `#version 300 es
precision highp float;
in vec2 a_quadPos;
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
    vec2 clipPos = (transformed.xy / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;
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

export class CanvasEngine implements EngineApi {
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

  private gl: WebGL2RenderingContext | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private circleProgram: WebGLProgram | null = null;
  private rectProgram: WebGLProgram | null = null;
  private overlayProgram: WebGLProgram | null = null;

  private circleVAO: WebGLVertexArrayObject | null = null;
  private rectVAO: WebGLVertexArrayObject | null = null;
  private lineVAO: WebGLVertexArrayObject | null = null;
  private overlayVAO: WebGLVertexArrayObject | null = null;

  private quadBuf: WebGLBuffer | null = null;
  private circleInstanceBuf: WebGLBuffer | null = null;
  private rectBuf: WebGLBuffer | null = null;
  private lineBuf: WebGLBuffer | null = null;
  private overlayQuadBuf: WebGLBuffer | null = null;

  private overlayTexture: WebGLTexture | null = null;

  private uRectTransform: WebGLUniformLocation | null = null;
  private uRectResolution: WebGLUniformLocation | null = null;
  private uCircleTransform: WebGLUniformLocation | null = null;
  private uCircleResolution: WebGLUniformLocation | null = null;
  private uOverlayTexture: WebGLUniformLocation | null = null;

  private readonly MAX_CIRCLES = 500000;
  private readonly MAX_RECTS = 1000;
  private readonly MAX_LINE_VERTS = 50000;

  private readonly transformMat = new Float32Array(9);
  private readonly resolutionVec = new Float32Array(2);
  private readonly circleInstanceData = new Float32Array(this.MAX_CIRCLES * 7);
  private readonly rectVertexData = new Float32Array(this.MAX_RECTS * 6 * 6);
  private readonly lineVertexData = new Float32Array(this.MAX_LINE_VERTS * 6);

  private readonly batchPosPool: { x: number; y: number; batch: Batch | null }[] = [];
  private lastBatchPosCount = 0;

  private boxes: Box[] = [];
  private batches: Batch[] = [];
  private boxErrorsMap: Map<number, BoxErrors> = new Map();
  private connectionEdges: [number, number][] = [];
  private cachedLineVertCount = 0;

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
  private readonly boundFrameHandler = (time: number) => this.frame(time);

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
      const rendererError = error instanceof Error ? error : new Error('Engine init failed');
      this.options.events?.onRendererError?.(rendererError);
      this.dispose();
    }
  }

  start(): void {
    if (!this.initialized || this.running || typeof window === 'undefined') {
      return;
    }
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
    if (value === this.paused) {
      return;
    }

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
    this.teardownRenderer();
    this.boxes = [];
    this.batches = [];
    this.connectionEdges = [];
    this.boxErrorsMap.clear();
    this.elements = null;
    this.options = {};
    this.initialized = false;
  }

  private frame(_time: number): void {
    if (!this.running) {
      return;
    }

    if (!this.paused) {
      this.updateSimulation();
    }

    this.renderFrame();

    if (typeof window !== 'undefined') {
      if (this.uncapFps) {
        this.rafId = setTimeout(this.boundFrameHandler, 0) as unknown as number;
      } else {
        this.rafId = window.requestAnimationFrame(this.boundFrameHandler);
      }
    }
  }

  private setupRenderer(): void {
    if (!this.elements) {
      return;
    }

    const gl = this.elements.canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL2 not available in this browser');
    }

    this.gl = gl;
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    if (!this.overlayCtx) {
      throw new Error('2D overlay context not available');
    }

    this.circleProgram = this.createProgram(circleVS, circleFS);
    this.rectProgram = this.createProgram(rectVS, rectFS);
    this.overlayProgram = this.createProgram(overlayVS, overlayFS);

    this.setupCircleBuffers();
    this.setupRectBuffers();
    this.setupLineBuffers();
    this.setupOverlayBuffers();

    this.uRectTransform = gl.getUniformLocation(this.rectProgram, 'u_transform');
    this.uRectResolution = gl.getUniformLocation(this.rectProgram, 'u_resolution');
    this.uCircleTransform = gl.getUniformLocation(this.circleProgram, 'u_transform');
    this.uCircleResolution = gl.getUniformLocation(this.circleProgram, 'u_resolution');
    this.uOverlayTexture = gl.getUniformLocation(this.overlayProgram, 'u_texture');

    this.resize();
  }

  private setupSimulation(): void {
    this.generateBoxes(this.counts.boxes);
    this.buildConnectionEdges();
    this.initBatches();
  }

  private bindInteractionHandlers(): void {
    if (!this.elements || typeof window === 'undefined') {
      return;
    }

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
    if (typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('resize', this.boundResizeHandler);

    const canvas = this.elements?.canvas;
    if (!canvas) {
      return;
    }

    canvas.removeEventListener('wheel', this.boundWheel);
    canvas.removeEventListener('mousedown', this.boundMouseDown);
    canvas.removeEventListener('mousemove', this.boundMouseMove);
    canvas.removeEventListener('mouseup', this.boundMouseUp);
    canvas.removeEventListener('mouseleave', this.boundMouseLeave);
  }

  private updateSimulation(): void {
    const now = performance.now() - this.pauseTimeOffset;

    let writeIdx = 0;
    for (let index = 0; index < this.batches.length; index++) {
      const batch = this.batches[index];
      const progress = (now - batch.startTime) / batch.duration;
      if (progress >= 1) {
        if (Math.random() < ERROR_CHANCE) {
          this.addError(batch.fromIdx, batch.toIdx);
        }
      } else {
        this.batches[writeIdx++] = batch;
      }
    }
    this.batches.length = writeIdx;

    const deficit = this.counts.batches - this.batches.length;
    const spawnCount =
      deficit > 0
        ? Math.max(1, Math.floor(deficit * 0.1))
        : Math.random() < 0.02
          ? 1
          : 0;

    for (let index = 0; index < spawnCount; index++) {
      const batch = this.randomBoxBatch(now);
      if (!batch) {
        continue;
      }
      batch.startTime = now + Math.random() * 500;
      this.batches.push(batch);
    }
  }

  private renderFrame(): void {
    const gl = this.gl;
    const canvas = this.elements?.canvas;
    const overlayCanvas = this.overlayCanvas;
    const overlayCtx = this.overlayCtx;

    if (
      !gl ||
      !canvas ||
      !overlayCanvas ||
      !overlayCtx ||
      !this.rectProgram ||
      !this.circleProgram ||
      !this.overlayProgram ||
      !this.rectVAO ||
      !this.lineVAO ||
      !this.circleVAO ||
      !this.overlayVAO ||
      !this.rectBuf ||
      !this.lineBuf ||
      !this.circleInstanceBuf ||
      !this.overlayTexture
    ) {
      return;
    }

    const realNow = performance.now();
    const now = this.paused ? this.pauseStartTime - this.pauseTimeOffset : realNow - this.pauseTimeOffset;

    this.frameCount++;
    if (realNow - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = realNow;
      this.fpsHistory.push(this.fps);
      if (this.fpsHistory.length > 60) this.fpsHistory.shift();
      this.avgFps = Math.round(this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length);
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.067, 0.067, 0.067, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.updateTransformMatrix();
    this.resolutionVec[0] = canvas.width;
    this.resolutionVec[1] = canvas.height;

    gl.useProgram(this.rectProgram);
    if (this.uRectTransform) {
      gl.uniformMatrix3fv(this.uRectTransform, false, this.transformMat);
    }
    if (this.uRectResolution) {
      gl.uniform2fv(this.uRectResolution, this.resolutionVec);
    }

    let rectCount = 0;
    for (let index = 0; index < this.boxes.length && rectCount < this.MAX_RECTS; index++) {
      const box = this.boxes[index];
      const [r, g, b] = box.rgb;
      const offset = rectCount * 36;
      const x1 = box.x;
      const y1 = box.y;
      const x2 = box.x + box.w;
      const y2 = box.y + box.h;

      this.rectVertexData[offset + 0] = x1;
      this.rectVertexData[offset + 1] = y1;
      this.rectVertexData[offset + 2] = r;
      this.rectVertexData[offset + 3] = g;
      this.rectVertexData[offset + 4] = b;
      this.rectVertexData[offset + 5] = 1;

      this.rectVertexData[offset + 6] = x2;
      this.rectVertexData[offset + 7] = y1;
      this.rectVertexData[offset + 8] = r;
      this.rectVertexData[offset + 9] = g;
      this.rectVertexData[offset + 10] = b;
      this.rectVertexData[offset + 11] = 1;

      this.rectVertexData[offset + 12] = x1;
      this.rectVertexData[offset + 13] = y2;
      this.rectVertexData[offset + 14] = r;
      this.rectVertexData[offset + 15] = g;
      this.rectVertexData[offset + 16] = b;
      this.rectVertexData[offset + 17] = 1;

      this.rectVertexData[offset + 18] = x1;
      this.rectVertexData[offset + 19] = y2;
      this.rectVertexData[offset + 20] = r;
      this.rectVertexData[offset + 21] = g;
      this.rectVertexData[offset + 22] = b;
      this.rectVertexData[offset + 23] = 1;

      this.rectVertexData[offset + 24] = x2;
      this.rectVertexData[offset + 25] = y1;
      this.rectVertexData[offset + 26] = r;
      this.rectVertexData[offset + 27] = g;
      this.rectVertexData[offset + 28] = b;
      this.rectVertexData[offset + 29] = 1;

      this.rectVertexData[offset + 30] = x2;
      this.rectVertexData[offset + 31] = y2;
      this.rectVertexData[offset + 32] = r;
      this.rectVertexData[offset + 33] = g;
      this.rectVertexData[offset + 34] = b;
      this.rectVertexData[offset + 35] = 1;

      rectCount++;
    }

    gl.bindVertexArray(this.rectVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.rectVertexData.subarray(0, rectCount * 36));
    gl.drawArrays(gl.TRIANGLES, 0, rectCount * 6);

    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.drawArrays(gl.LINES, 0, this.cachedLineVertCount);

    if (this.activePopupLine) {
      const hlOffset = 0;
      this.lineVertexData[hlOffset + 0] = this.boxCenterX(this.activePopupLine.from);
      this.lineVertexData[hlOffset + 1] = this.boxCenterY(this.activePopupLine.from);
      this.lineVertexData[hlOffset + 2] = 1;
      this.lineVertexData[hlOffset + 3] = 0.9;
      this.lineVertexData[hlOffset + 4] = 0;
      this.lineVertexData[hlOffset + 5] = 0.9;

      this.lineVertexData[hlOffset + 6] = this.boxCenterX(this.activePopupLine.to);
      this.lineVertexData[hlOffset + 7] = this.boxCenterY(this.activePopupLine.to);
      this.lineVertexData[hlOffset + 8] = 1;
      this.lineVertexData[hlOffset + 9] = 0.9;
      this.lineVertexData[hlOffset + 10] = 0;
      this.lineVertexData[hlOffset + 11] = 0.9;

      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineVertexData.subarray(0, 12));
      gl.drawArrays(gl.LINES, 0, 2);
    }

    gl.useProgram(this.circleProgram);
    if (this.uCircleTransform) {
      gl.uniformMatrix3fv(this.uCircleTransform, false, this.transformMat);
    }
    if (this.uCircleResolution) {
      gl.uniform2fv(this.uCircleResolution, this.resolutionVec);
    }

    let circleCount = 0;
    let activeCount = 0;
    this.lastBatchPosCount = 0;

    for (let index = 0; index < this.batches.length && circleCount < this.MAX_CIRCLES; index++) {
      const batch = this.batches[index];
      const progress = (now - batch.startTime) / batch.duration;
      if (progress < 0 || progress >= 1) {
        continue;
      }

      activeCount++;
      const p = Math.min(progress, 1);
      const x = batch.startX + (batch.endX - batch.startX) * p;
      const y = batch.startY + (batch.endY - batch.startY) * p;

      if (this.lastBatchPosCount >= this.batchPosPool.length) {
        this.batchPosPool.push({ x: 0, y: 0, batch: null });
      }
      const pooled = this.batchPosPool[this.lastBatchPosCount++];
      pooled.x = x;
      pooled.y = y;
      pooled.batch = batch;

      const offset = circleCount * 7;
      this.circleInstanceData[offset + 0] = x;
      this.circleInstanceData[offset + 1] = y;
      this.circleInstanceData[offset + 2] = 6;
      this.circleInstanceData[offset + 3] = batch.rgb[0];
      this.circleInstanceData[offset + 4] = batch.rgb[1];
      this.circleInstanceData[offset + 5] = batch.rgb[2];
      this.circleInstanceData[offset + 6] = 1;
      circleCount++;
    }

    for (const [, err] of this.boxErrorsMap) {
      if (circleCount >= this.MAX_CIRCLES) {
        break;
      }
      const offset = circleCount * 7;
      this.circleInstanceData[offset + 0] = err.x;
      this.circleInstanceData[offset + 1] = err.y;
      this.circleInstanceData[offset + 2] = 9;
      this.circleInstanceData[offset + 3] = 0.94;
      this.circleInstanceData[offset + 4] = 0.17;
      this.circleInstanceData[offset + 5] = 0.17;
      this.circleInstanceData[offset + 6] = 1;
      circleCount++;
    }

    gl.bindVertexArray(this.circleVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.circleInstanceBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.circleInstanceData.subarray(0, circleCount * 7));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, circleCount);

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.save();
    overlayCtx.translate(this.panX, this.panY);
    overlayCtx.scale(this.zoomLevel, this.zoomLevel);
    overlayCtx.font = 'bold 11px monospace';
    overlayCtx.textAlign = 'center';
    overlayCtx.textBaseline = 'middle';
    overlayCtx.fillStyle = 'white';
    overlayCtx.strokeStyle = 'white';
    overlayCtx.lineWidth = 2 / this.zoomLevel;

    for (const box of this.boxes) {
      if (!this.isBoxInView(box)) {
        continue;
      }
      overlayCtx.strokeRect(box.x, box.y, box.w, box.h);
      overlayCtx.fillText(box.label, this.boxCenterX(box), this.boxCenterY(box));
    }

    if (this.activePopupBox) {
      const b = this.activePopupBox;
      const pad = 4;
      overlayCtx.save();
      overlayCtx.strokeStyle = '#ffcc00';
      overlayCtx.lineWidth = 3 / this.zoomLevel;
      overlayCtx.shadowColor = '#ffcc00';
      overlayCtx.shadowBlur = 12 / this.zoomLevel;
      overlayCtx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      overlayCtx.restore();
    }

    if (this.activePopupLine) {
      overlayCtx.save();
      overlayCtx.strokeStyle = '#ffcc00';
      overlayCtx.lineWidth = 2.5 / this.zoomLevel;
      overlayCtx.shadowColor = '#ffcc00';
      overlayCtx.shadowBlur = 10 / this.zoomLevel;
      overlayCtx.beginPath();
      overlayCtx.moveTo(
        this.boxCenterX(this.activePopupLine.from),
        this.boxCenterY(this.activePopupLine.from),
      );
      overlayCtx.lineTo(
        this.boxCenterX(this.activePopupLine.to),
        this.boxCenterY(this.activePopupLine.to),
      );
      overlayCtx.stroke();
      overlayCtx.restore();
    }

    if (this.activePopupBatch) {
      let position: { x: number; y: number; batch: Batch | null } | null = null;
      for (let index = 0; index < this.lastBatchPosCount; index++) {
        if (this.batchPosPool[index].batch === this.activePopupBatch) {
          position = this.batchPosPool[index];
          break;
        }
      }
      if (position) {
        overlayCtx.save();
        overlayCtx.strokeStyle = '#ffcc00';
        overlayCtx.lineWidth = 2.5 / this.zoomLevel;
        overlayCtx.shadowColor = '#ffcc00';
        overlayCtx.shadowBlur = 14 / this.zoomLevel;
        overlayCtx.beginPath();
        overlayCtx.arc(position.x, position.y, 10 / this.zoomLevel, 0, Math.PI * 2);
        overlayCtx.stroke();
        overlayCtx.restore();
      }
    }

    overlayCtx.restore();

    overlayCtx.save();
    overlayCtx.translate(this.panX, this.panY);
    overlayCtx.scale(this.zoomLevel, this.zoomLevel);
    overlayCtx.font = `bold ${Math.max(9, 11 / this.zoomLevel)}px monospace`;
    overlayCtx.textAlign = 'center';
    overlayCtx.textBaseline = 'middle';
    for (const [, err] of this.boxErrorsMap) {
      overlayCtx.fillStyle = 'white';
      overlayCtx.fillText(`${err.entries.length}`, err.x, err.y);
    }
    overlayCtx.restore();

    if (this.activePopupErrors) {
      overlayCtx.save();
      overlayCtx.translate(this.panX, this.panY);
      overlayCtx.scale(this.zoomLevel, this.zoomLevel);
      overlayCtx.strokeStyle = '#ffcc00';
      overlayCtx.lineWidth = 3 / this.zoomLevel;
      overlayCtx.shadowColor = '#ffcc00';
      overlayCtx.shadowBlur = 12 / this.zoomLevel;
      overlayCtx.beginPath();
      overlayCtx.arc(this.activePopupErrors.x, this.activePopupErrors.y, 12, 0, Math.PI * 2);
      overlayCtx.stroke();
      overlayCtx.restore();
    }

    overlayCtx.fillStyle = 'white';
    overlayCtx.font = '16px monospace';
    overlayCtx.textAlign = 'start';
    overlayCtx.textBaseline = 'alphabetic';
    overlayCtx.fillText(`FPS: ${this.fps}`, 10, 24);
    overlayCtx.fillText(`Avg FPS (1m): ${this.avgFps}`, 10, 46);
    overlayCtx.fillText(`Batches: ${this.batches.length} (visible: ${activeCount})`, 10, 68);
    overlayCtx.fillText(`Zoom: ${Math.round(this.zoomLevel * 100)}%`, 10, 90);
    overlayCtx.fillText(`Boxes: ${this.boxes.length}`, 10, 112);
    overlayCtx.fillText(`Errors: ${this.totalErrors()}`, 10, 134);
    if (this.paused) {
      overlayCtx.fillStyle = '#ef4444';
      overlayCtx.font = 'bold 20px monospace';
      overlayCtx.fillText('PAUSED', 10, 162);
    }

    gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, overlayCanvas);

    gl.useProgram(this.overlayProgram);
    if (this.uOverlayTexture) {
      gl.uniform1i(this.uOverlayTexture, 0);
    }
    gl.bindVertexArray(this.overlayVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindVertexArray(null);

    this.emitHud(activeCount);
  }

  private handleRendererResize(): void {
    const canvas = this.elements?.canvas;
    const wrapper = this.elements?.wrapper;
    const overlayCanvas = this.overlayCanvas;
    const gl = this.gl;

    if (!canvas || !wrapper) {
      return;
    }

    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;
    if (overlayCanvas) {
      overlayCanvas.width = canvas.width;
      overlayCanvas.height = canvas.height;
    }

    this.worldW = canvas.width * 5;
    this.worldH = canvas.height * 5;
    this.applyPanConstraints();

    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }

  private rebuildWorldForCounts(): void {
    this.generateBoxes(this.counts.boxes);
    this.buildConnectionEdges();
    this.boxErrorsMap = new Map();
    this.initBatches();
    this.clearSelection();
  }

  private teardownRenderer(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }

    if (this.quadBuf) gl.deleteBuffer(this.quadBuf);
    if (this.circleInstanceBuf) gl.deleteBuffer(this.circleInstanceBuf);
    if (this.rectBuf) gl.deleteBuffer(this.rectBuf);
    if (this.lineBuf) gl.deleteBuffer(this.lineBuf);
    if (this.overlayQuadBuf) gl.deleteBuffer(this.overlayQuadBuf);

    if (this.circleVAO) gl.deleteVertexArray(this.circleVAO);
    if (this.rectVAO) gl.deleteVertexArray(this.rectVAO);
    if (this.lineVAO) gl.deleteVertexArray(this.lineVAO);
    if (this.overlayVAO) gl.deleteVertexArray(this.overlayVAO);

    if (this.overlayTexture) gl.deleteTexture(this.overlayTexture);

    if (this.circleProgram) gl.deleteProgram(this.circleProgram);
    if (this.rectProgram) gl.deleteProgram(this.rectProgram);
    if (this.overlayProgram) gl.deleteProgram(this.overlayProgram);

    this.gl = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.circleProgram = null;
    this.rectProgram = null;
    this.overlayProgram = null;
    this.circleVAO = null;
    this.rectVAO = null;
    this.lineVAO = null;
    this.overlayVAO = null;
    this.quadBuf = null;
    this.circleInstanceBuf = null;
    this.rectBuf = null;
    this.lineBuf = null;
    this.overlayQuadBuf = null;
    this.overlayTexture = null;
    this.uRectTransform = null;
    this.uRectResolution = null;
    this.uCircleTransform = null;
    this.uCircleResolution = null;
    this.uOverlayTexture = null;
  }

  private emitSelection(selection: Selection): void {
    this.options.events?.onSelectionChange?.(selection);
  }

  private emitZoom(): void {
    this.options.events?.onZoomChange?.(Math.round(this.zoomLevel * 100));
  }

  private emitHud(visibleBatches: number): void {
    const now = performance.now();
    if (now - this.lastHudEmitTime < 250) {
      return;
    }
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

  private totalErrors(): number {
    let total = 0;
    for (const [, value] of this.boxErrorsMap) {
      total += value.entries.length;
    }
    return total;
  }

  private compileShader(source: string, type: number): WebGLShader {
    const gl = this.gl;
    if (!gl) {
      throw new Error('WebGL not initialized');
    }

    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create shader');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error';
      gl.deleteShader(shader);
      throw new Error(info);
    }
    return shader;
  }

  private createProgram(vertex: string, fragment: string): WebGLProgram {
    const gl = this.gl;
    if (!gl) {
      throw new Error('WebGL not initialized');
    }

    const program = gl.createProgram();
    if (!program) {
      throw new Error('Failed to create program');
    }

    const vs = this.compileShader(vertex, gl.VERTEX_SHADER);
    const fs = this.compileShader(fragment, gl.FRAGMENT_SHADER);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? 'Unknown program link error';
      gl.deleteProgram(program);
      throw new Error(info);
    }

    return program;
  }

  private setupCircleBuffers(): void {
    const gl = this.gl;
    if (!gl || !this.circleProgram) {
      return;
    }

    this.circleVAO = gl.createVertexArray();
    this.quadBuf = gl.createBuffer();
    this.circleInstanceBuf = gl.createBuffer();
    if (!this.circleVAO || !this.quadBuf || !this.circleInstanceBuf) {
      throw new Error('Failed to allocate circle buffers');
    }

    gl.bindVertexArray(this.circleVAO);
    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    const aQuadPos = gl.getAttribLocation(this.circleProgram, 'a_quadPos');
    gl.enableVertexAttribArray(aQuadPos);
    gl.vertexAttribPointer(aQuadPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.circleInstanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.circleInstanceData.byteLength, gl.DYNAMIC_DRAW);

    const aCenter = gl.getAttribLocation(this.circleProgram, 'a_center');
    const aRadius = gl.getAttribLocation(this.circleProgram, 'a_radius');
    const aColor = gl.getAttribLocation(this.circleProgram, 'a_color');

    gl.enableVertexAttribArray(aCenter);
    gl.vertexAttribPointer(aCenter, 2, gl.FLOAT, false, 7 * 4, 0);
    gl.vertexAttribDivisor(aCenter, 1);

    gl.enableVertexAttribArray(aRadius);
    gl.vertexAttribPointer(aRadius, 1, gl.FLOAT, false, 7 * 4, 2 * 4);
    gl.vertexAttribDivisor(aRadius, 1);

    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
    gl.vertexAttribDivisor(aColor, 1);

    gl.bindVertexArray(null);
  }

  private setupRectBuffers(): void {
    const gl = this.gl;
    if (!gl || !this.rectProgram) {
      return;
    }

    this.rectVAO = gl.createVertexArray();
    this.rectBuf = gl.createBuffer();
    if (!this.rectVAO || !this.rectBuf) {
      throw new Error('Failed to allocate rect buffers');
    }

    gl.bindVertexArray(this.rectVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.rectVertexData.byteLength, gl.DYNAMIC_DRAW);

    const aPos = gl.getAttribLocation(this.rectProgram, 'a_position');
    const aColor = gl.getAttribLocation(this.rectProgram, 'a_color');

    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 6 * 4, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 6 * 4, 2 * 4);
    gl.bindVertexArray(null);
  }

  private setupLineBuffers(): void {
    const gl = this.gl;
    if (!gl || !this.rectProgram) {
      return;
    }

    this.lineVAO = gl.createVertexArray();
    this.lineBuf = gl.createBuffer();
    if (!this.lineVAO || !this.lineBuf) {
      throw new Error('Failed to allocate line buffers');
    }

    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.lineVertexData.byteLength, gl.DYNAMIC_DRAW);

    const aPos = gl.getAttribLocation(this.rectProgram, 'a_position');
    const aColor = gl.getAttribLocation(this.rectProgram, 'a_color');

    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 6 * 4, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 6 * 4, 2 * 4);
    gl.bindVertexArray(null);
  }

  private setupOverlayBuffers(): void {
    const gl = this.gl;
    if (!gl || !this.overlayProgram) {
      return;
    }

    this.overlayTexture = gl.createTexture();
    if (!this.overlayTexture) {
      throw new Error('Failed to allocate overlay texture');
    }
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.overlayVAO = gl.createVertexArray();
    this.overlayQuadBuf = gl.createBuffer();
    if (!this.overlayVAO || !this.overlayQuadBuf) {
      throw new Error('Failed to allocate overlay buffers');
    }

    gl.bindVertexArray(this.overlayVAO);
    const overlayQuad = new Float32Array([
      -1,
      -1,
      0,
      1,
      1,
      -1,
      1,
      1,
      -1,
      1,
      0,
      0,
      -1,
      1,
      0,
      0,
      1,
      -1,
      1,
      1,
      1,
      1,
      1,
      0,
    ]);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, overlayQuad, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(this.overlayProgram, 'a_position');
    const aTex = gl.getAttribLocation(this.overlayProgram, 'a_texCoord');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 4 * 4, 0);
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
    gl.bindVertexArray(null);
  }

  private hexToRgb(hex: string): [number, number, number] {
    const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
    const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
    const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
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
    for (let index = 0; index < count; index++) {
      const isSmall = index >= Math.ceil(count / 3);
      const w = isSmall ? SMALL_BOX_W : BOX_W;
      const h = isSmall ? SMALL_BOX_H : BOX_H;
      let placed = false;

      for (let attempt = 0; attempt < 300; attempt++) {
        const x = Math.random() * Math.max(1, this.worldW - w);
        const y = Math.random() * Math.max(1, this.worldH - h);
        const candidate = { x, y, w, h };
        if (!this.boxes.some((box) => this.boxesOverlap(candidate, box))) {
          const color = boxColors[index % boxColors.length];
          this.boxes.push({
            x,
            y,
            w,
            h,
            label: index < 26 ? String.fromCharCode(65 + index) : `${index + 1}`,
            color,
            rgb: this.hexToRgb(color),
            connections: [],
          });
          placed = true;
          break;
        }
      }

      if (!placed) {
        break;
      }
    }

    for (let index = 0; index < this.boxes.length; index++) {
      const numConnections = 2 + Math.floor(Math.random() * 3);
      const available = Array.from({ length: this.boxes.length }, (_, k) => k).filter((k) => k !== index);
      for (let c = 0; c < numConnections && available.length > 0; c++) {
        const pick = Math.floor(Math.random() * available.length);
        const target = available[pick];
        available.splice(pick, 1);

        if (!this.boxes[index].connections.includes(target)) {
          this.boxes[index].connections.push(target);
        }
        if (!this.boxes[target].connections.includes(index)) {
          this.boxes[target].connections.push(index);
        }
      }
    }
  }

  private buildConnectionEdges(): void {
    this.connectionEdges = [];
    const seen = new Set<string>();
    for (let index = 0; index < this.boxes.length; index++) {
      for (const target of this.boxes[index].connections) {
        const key = index < target ? `${index}-${target}` : `${target}-${index}`;
        if (!seen.has(key)) {
          seen.add(key);
          this.connectionEdges.push([index, target]);
        }
      }
    }
    this.rebuildLineBuffer();
  }

  private rebuildLineBuffer(): void {
    const gl = this.gl;
    if (!gl || !this.lineVAO || !this.lineBuf) {
      return;
    }

    this.cachedLineVertCount = 0;
    for (const [fromIdx, toIdx] of this.connectionEdges) {
      if (this.cachedLineVertCount + 2 > this.MAX_LINE_VERTS) {
        break;
      }

      const off1 = this.cachedLineVertCount * 6;
      this.lineVertexData[off1 + 0] = this.boxCenterX(this.boxes[fromIdx]);
      this.lineVertexData[off1 + 1] = this.boxCenterY(this.boxes[fromIdx]);
      this.lineVertexData[off1 + 2] = 1;
      this.lineVertexData[off1 + 3] = 1;
      this.lineVertexData[off1 + 4] = 1;
      this.lineVertexData[off1 + 5] = 0.15;

      const off2 = (this.cachedLineVertCount + 1) * 6;
      this.lineVertexData[off2 + 0] = this.boxCenterX(this.boxes[toIdx]);
      this.lineVertexData[off2 + 1] = this.boxCenterY(this.boxes[toIdx]);
      this.lineVertexData[off2 + 2] = 1;
      this.lineVertexData[off2 + 3] = 1;
      this.lineVertexData[off2 + 4] = 1;
      this.lineVertexData[off2 + 5] = 0.15;

      this.cachedLineVertCount += 2;
    }

    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.lineVertexData.subarray(0, this.cachedLineVertCount * 6),
    );
    gl.bindVertexArray(null);
  }

  private randomBoxBatch(now: number): Batch | null {
    if (this.connectionEdges.length === 0) {
      return null;
    }
    const edge = this.connectionEdges[Math.floor(Math.random() * this.connectionEdges.length)];
    const [fromIdx, toIdx] = Math.random() < 0.5 ? [edge[0], edge[1]] : [edge[1], edge[0]];
    const from = this.boxes[fromIdx];
    const to = this.boxes[toIdx];
    if (!from || !to) {
      return null;
    }

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
    for (let index = 0; index < this.counts.batches; index++) {
      const batch = this.randomBoxBatch(now);
      if (!batch) {
        continue;
      }
      if (Math.random() < 0.7) {
        batch.startTime = now - Math.random() * 0.8 * batch.duration;
      } else {
        batch.startTime = now + Math.random() * 3000;
      }
      this.batches.push(batch);
    }
  }

  private boxCenterX(box: Box): number {
    return box.x + box.w / 2;
  }

  private boxCenterY(box: Box): number {
    return box.y + box.h / 2;
  }

  private getErrorPosition(box: Box): { x: number; y: number } {
    return { x: box.x + box.w + 10, y: box.y - 5 };
  }

  private addError(fromIdx: number, toIdx: number): void {
    const box = this.boxes[toIdx];
    if (!box) {
      return;
    }

    const entry: ErrorEntry = {
      id: this.errorIdCounter++,
      message: errorMessages[Math.floor(Math.random() * errorMessages.length)],
      severity: errorSeverities[Math.floor(Math.random() * errorSeverities.length)],
      timestamp: Date.now(),
      fromIdx,
      toIdx,
    };

    if (!this.boxErrorsMap.has(toIdx)) {
      const position = this.getErrorPosition(box);
      this.boxErrorsMap.set(toIdx, {
        x: position.x,
        y: position.y,
        boxIdx: toIdx,
        entries: [],
      });
    }

    this.boxErrorsMap.get(toIdx)?.entries.push(entry);

    if (this.activePopupErrors && this.activePopupErrors.boxIdx === toIdx) {
      this.emitSelection({ kind: 'error', errors: this.activePopupErrors });
    }
  }

  private updateTransformMatrix(): void {
    this.transformMat[0] = this.zoomLevel;
    this.transformMat[1] = 0;
    this.transformMat[2] = 0;
    this.transformMat[3] = 0;
    this.transformMat[4] = this.zoomLevel;
    this.transformMat[5] = 0;
    this.transformMat[6] = this.panX;
    this.transformMat[7] = this.panY;
    this.transformMat[8] = 1;
  }

  private isInView(x: number, y: number, margin: number): boolean {
    const canvas = this.elements?.canvas;
    if (!canvas) {
      return false;
    }
    const sx = x * this.zoomLevel + this.panX;
    const sy = y * this.zoomLevel + this.panY;
    return sx > -margin && sx < canvas.width + margin && sy > -margin && sy < canvas.height + margin;
  }

  private isBoxInView(box: Box): boolean {
    const canvas = this.elements?.canvas;
    if (!canvas) {
      return false;
    }

    const sx1 = box.x * this.zoomLevel + this.panX;
    const sy1 = box.y * this.zoomLevel + this.panY;
    const sx2 = (box.x + box.w) * this.zoomLevel + this.panX;
    const sy2 = (box.y + box.h) * this.zoomLevel + this.panY;

    return sx2 > 0 && sx1 < canvas.width && sy2 > 0 && sy1 < canvas.height;
  }

  private applyPanConstraints(): void {
    const canvas = this.elements?.canvas;
    if (!canvas) {
      return;
    }
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
    if (this.elements) {
      this.elements.canvas.style.cursor = 'grabbing';
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging) {
      return;
    }

    this.panX = event.clientX - this.dragStartX;
    this.panY = event.clientY - this.dragStartY;
    this.applyPanConstraints();
  }

  private handleMouseUp(event: MouseEvent): void {
    const wasDrag =
      Math.abs(event.clientX - this.mouseDownX) > 5 || Math.abs(event.clientY - this.mouseDownY) > 5;

    this.isDragging = false;
    if (this.elements) {
      this.elements.canvas.style.cursor = 'grab';
    }

    if (wasDrag || !this.elements) {
      return;
    }

    const rect = this.elements.canvas.getBoundingClientRect();
    const clickScreenX = event.clientX - rect.left;
    const clickScreenY = event.clientY - rect.top;
    const worldX = (clickScreenX - this.panX) / this.zoomLevel;
    const worldY = (clickScreenY - this.panY) / this.zoomLevel;

    const clickedBox = this.boxes.find(
      (box) =>
        worldX >= box.x && worldX <= box.x + box.w && worldY >= box.y && worldY <= box.y + box.h,
    );

    if (clickedBox) {
      this.openBoxSelection(clickedBox);
      return;
    }

    const clickedError = this.findClickedError(worldX, worldY);
    if (clickedError) {
      this.openErrorSelection(clickedError);
      return;
    }

    const clickedBatch = this.findClickedBatch(worldX, worldY);
    if (clickedBatch) {
      this.openBatchSelection(clickedBatch);
      return;
    }

    const clickedLine = this.findClickedLine(worldX, worldY);
    if (clickedLine) {
      this.openLineSelection(clickedLine.from, clickedLine.to);
      return;
    }

    this.clearSelection();
  }

  private handleMouseLeave(): void {
    this.isDragging = false;
    if (this.elements) {
      this.elements.canvas.style.cursor = 'grab';
    }
  }

  private pointToSegmentDist(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      return Math.hypot(px - ax, py - ay);
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  private findClickedLine(worldX: number, worldY: number): { from: Box; to: Box } | null {
    const threshold = 8 / this.zoomLevel;
    const drawn = new Set<string>();
    let best: { from: Box; to: Box; dist: number } | null = null;

    for (let index = 0; index < this.boxes.length; index++) {
      for (const target of this.boxes[index].connections) {
        const key = index < target ? `${index}-${target}` : `${target}-${index}`;
        if (drawn.has(key)) {
          continue;
        }
        drawn.add(key);

        const dist = this.pointToSegmentDist(
          worldX,
          worldY,
          this.boxCenterX(this.boxes[index]),
          this.boxCenterY(this.boxes[index]),
          this.boxCenterX(this.boxes[target]),
          this.boxCenterY(this.boxes[target]),
        );

        if (dist < threshold && (!best || dist < best.dist)) {
          best = { from: this.boxes[index], to: this.boxes[target], dist };
        }
      }
    }

    return best;
  }

  private findClickedBatch(worldX: number, worldY: number): Batch | null {
    const threshold = 10 / this.zoomLevel;
    const thresholdSq = threshold * threshold;

    for (let index = 0; index < this.lastBatchPosCount; index++) {
      const pooled = this.batchPosPool[index];
      const dx = worldX - pooled.x;
      const dy = worldY - pooled.y;
      if (dx * dx + dy * dy < thresholdSq) {
        return pooled.batch;
      }
    }
    return null;
  }

  private findClickedError(worldX: number, worldY: number): BoxErrors | null {
    const threshold = 12 / this.zoomLevel;
    for (const [, err] of this.boxErrorsMap) {
      const dist = Math.hypot(worldX - err.x, worldY - err.y);
      if (dist < threshold) {
        return err;
      }
    }
    return null;
  }

  private focusOnWorldPoint(x: number, y: number): void {
    const canvas = this.elements?.canvas;
    if (!canvas) {
      return;
    }

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
}
