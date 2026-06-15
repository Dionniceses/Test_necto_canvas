import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Application, Graphics, Container, Sprite, Texture, Assets } from 'pixi.js';
import {
  CockpitAnimationEndpoints,
  CockpitAnimationTickResult,
} from '../../interfaces/cockpit-request-animation.interface';
import { CockpitCanvasNode } from '../../interfaces/cockpit-canvas-node.interface';
import { CockpitMockStreamEvent } from '../../interfaces/cockpit-stream.interface';
import { ZoomPanState } from '../../interfaces/zoom-pan.interface';
import { CockpitDestinationSidebarComponent } from '@features/cockpit/components/cockpit-destination-sidebar/cockpit-destination-sidebar.component';
import { RequestInfoPopupComponent } from '@features/cockpit/components/request-info-popup/request-info-popup.component';
import { PauseLiveComponent } from '../pause-live/pause-live.component';
import { DatepickerComponent } from '../date-picker/datepicker.component';
import { TenantSelectComponent } from '../tenant-select/tenant-select.component';
import { TimelineBarComponent } from '../timeline-bar/timeline-bar.component';
import { CockpitCanvasNodeService } from '../../services/cockpit-canvas-node.service';
import { CockpitLivePlaybackService } from '../../services/cockpit-live-playback.service';
import { CockpitRequestAnimationService } from '../../services/cockpit-request-animation.service';
import { StreamWorkerService } from '../../services/stream-worker.service';
import { ZoomPanService } from '../../services/zoom-pan.service';
import { PerformanceBudgetService } from '../../services/performance-budget.service';

@Component({
  selector: 'app-pixi-canvas',
  imports: [
    PauseLiveComponent,
    RequestInfoPopupComponent,
    CockpitDestinationSidebarComponent,
    DatepickerComponent,
    TenantSelectComponent,
    TimelineBarComponent,
  ],
  templateUrl: './pixi-canvas.component.html',
  styleUrl: './pixi-canvas.component.scss',
})
export class PixiCanvasComponent {
  pixiHost = viewChild<ElementRef<HTMLDivElement>>('pixiHost');
  destinationSidebarVisible = signal(false);
  selectedDestinationName = signal<string | null>(null);

  #app: Application | null = null;
  #neqtoNode: CockpitCanvasNode | null = null;
  #worldContainer: Container | null = null;
  #destinationNodes = new Map<string, CockpitCanvasNode>();
  #connectionLines = new Map<string, Graphics>();
  #requestSprites = new Map<string, Sprite>();
  #sidebarObserver: MutationObserver | null = null;
  #resizeTimeoutId: number | null = null;
  #isZoomPanInitialized = false;
  #destroyRef = inject(DestroyRef);
  #canvasNodeService = inject(CockpitCanvasNodeService);
  #livePlaybackService = inject(CockpitLivePlaybackService);
  #requestAnimationService = inject(CockpitRequestAnimationService);
  #streamWorkerService = inject(StreamWorkerService);
  #zoomPanService = inject(ZoomPanService);
  #ngZone = inject(NgZone);
  #performanceBudgetService = inject(PerformanceBudgetService);
  readonly currentFps = this.#performanceBudgetService.averageFps;
  #requestSpriteRadiusById = new Map<string, number>();
  #requestSizesById = new Map<string, number>();
  #selectedRequestId: string | null = null;
  #selectedDestinationKey: string | null = null;

  readonly isPaused = this.#livePlaybackService.isPaused;
  readonly isLive = this.#livePlaybackService.isLive;
  readonly bufferedEventCount = this.#livePlaybackService.bufferedEventCount;

  #lineLayer: Container | null = null;
  #spriteLayer: Container | null = null;
  #nodeLayer: Container | null = null;

  #ballTexture!: Texture;
  #ballHighlightTexture!: Texture;

  readonly #destinationNodeWidth = 130;
  readonly #destinationNodeHeight = 40;
  readonly #connectionLineColor = 0x2d213a;
  readonly #connectionLineWidth = 2;
  readonly #connectionLineAlpha = 0.6;
  readonly #destinationNodeStrokeColor = 0x2d213a;
  readonly #destinationNodeSelectedStrokeColor = 0xffe800;
  readonly #destinationNodeDefaultStrokeWidth = 3;
  readonly #destinationNodeSelectedStrokeWidth = 4;
  readonly #defaultSpriteRadius = 8;
  readonly #minSpriteRadius = 2;
  readonly #maxSpriteRadius = 20;
  readonly #worldDimensionPadding = 24;

  constructor() {
    this.#streamWorkerService.selectedRequestId$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe((requestId) => {
      this.#setSelectedRequestId(requestId);
    });

    effect(() => {
      this.#updateSpriteHitTesting(this.#performanceBudgetService.budgetConfig().hitTestingEnabled);
    });

    afterNextRender(async () => {
      const hostElement = this.pixiHost()?.nativeElement;

      if (!hostElement) {
        return;
      }

      // Creates an app
      const app = new Application();

      await app.init({
        resizeTo: hostElement,
        backgroundColor: 0x453E5B,
        antialias: true,
      });
      hostElement.appendChild(app.canvas);
      this.#app = app;

      let ballTex: Texture;
      let ballHlTex: Texture;

      try {
        [ballTex, ballHlTex] = await Promise.all([
          Assets.load<Texture>('assets/images/cockpitball.png'),
          Assets.load<Texture>('assets/images/cockpitballhl.png'),
        ]);
      } catch {
        // Images not found — generate simple circle textures as fallback
        const normalBall = new Graphics().circle(0, 0, 8).fill(0xffffff);
        const highlightBall = new Graphics().circle(0, 0, 8).fill(0xffe800);
        ballTex = app.renderer.generateTexture(normalBall);
        ballHlTex = app.renderer.generateTexture(highlightBall);
        normalBall.destroy();
        highlightBall.destroy();
      }

      this.#ballTexture = ballTex!;
      this.#ballHighlightTexture = ballHlTex!;

      this.#worldContainer = new Container(); // for pan and zoom later
      this.#app.stage.addChild(this.#worldContainer);

      // Create layers in rendering order (bottom to top)
      this.#lineLayer = new Container();
      this.#spriteLayer = new Container();
      this.#nodeLayer = new Container();

      this.#worldContainer.addChild(this.#lineLayer);
      this.#worldContainer.addChild(this.#spriteLayer);
      this.#worldContainer.addChild(this.#nodeLayer);

      const now = this.#nowInMs();

      this.#livePlaybackService.initializeTimeline(now);

      this.#connectToStream();

      this.#app.ticker?.add?.(this.#renderAnimations);

      this.#setupSidebarObserver();
      this.#createNeqtoNode();
      this.#positionNeqtoNode();
      this.#initializeZoomPan(hostElement);
    });

    this.#destroyRef.onDestroy(() => {
      this.#sidebarObserver?.disconnect();
      this.#sidebarObserver = null;

      if (this.#resizeTimeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(this.#resizeTimeoutId);
        this.#resizeTimeoutId = null;
      }

      if (this.#app) {
        this.#app.ticker?.remove?.(this.#renderAnimations);
      }

      for (const sprite of this.#requestSprites.values()) {
        this.#destroySprite(sprite);
      }

      this.#app?.destroy();
      this.#app = null;
      this.#neqtoNode = null;
      this.#destinationNodes.clear();
      this.#connectionLines.clear();
      this.#requestSprites.clear();
      this.#requestSpriteRadiusById.clear();
      this.#requestSizesById.clear();
      this.#livePlaybackService.reset();
      this.#requestAnimationService.reset();
      this.#canvasNodeService.resetDestinationPositions();
      this.#isZoomPanInitialized = false;
      this.#zoomPanService.dispose();
      this.#streamWorkerService.resetRequestDetails();

      this.#streamWorkerService.closeMockStream();
    });
  }

  #initializeZoomPan(hostElement: HTMLElement): void {
    this.#zoomPanService.stateChanged$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe((state) => {
      this.#applyZoomPanState(state);
    });

    const initialWorldWidth = Math.max(1, hostElement.clientWidth);
    const initialWorldHeight = Math.max(1, hostElement.clientHeight);

    this.#zoomPanService.init(hostElement, initialWorldWidth, initialWorldHeight);
    // Preserve current visual baseline: start at 1x scale until dynamic world bounds are introduced.
    this.#zoomPanService.setZoom(1);
    this.#isZoomPanInitialized = true;
    this.#syncZoomPanWorldDimensions();
    this.#applyZoomPanState(this.#zoomPanService.state());
  }

  #applyZoomPanState(state: ZoomPanState): void {
    if (!this.#worldContainer) {
      return;
    }

    this.#worldContainer.scale.set(state.zoomLevel);
    this.#worldContainer.position.set(state.panX, state.panY);
  }

  #syncZoomPanWorldDimensions(): void {
    if (!this.#isZoomPanInitialized) {
      return;
    }

    const hostElement = this.pixiHost()?.nativeElement;

    if (!hostElement) {
      return;
    }

    const contentBounds = this.#resolveNodeContentBounds();
    const paddedMinX = contentBounds.minX - this.#maxSpriteRadius - this.#worldDimensionPadding;
    const paddedMinY = contentBounds.minY - this.#maxSpriteRadius - this.#worldDimensionPadding;
    const paddedMaxX = contentBounds.maxX + this.#maxSpriteRadius + this.#worldDimensionPadding;
    const paddedMaxY = contentBounds.maxY + this.#maxSpriteRadius + this.#worldDimensionPadding;
    const minX = Math.min(0, paddedMinX);
    const minY = Math.min(0, paddedMinY);
    const maxX = Math.max(hostElement.clientWidth, paddedMaxX);
    const maxY = Math.max(hostElement.clientHeight, paddedMaxY);

    this.#zoomPanService.setWorldBounds(minX, minY, maxX, maxY);
  }

  #syncZoomPanAfterLayoutCycle(): void {
    if (!this.#isZoomPanInitialized) {
      return;
    }

    this.#zoomPanService.resize();
    this.#syncZoomPanWorldDimensions();
  }

  #resolveNodeContentBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const trackNodeBounds = (node: CockpitCanvasNode | null): void => {
      if (!node) {
        return;
      }

      minX = Math.min(minX, node.box.x);
      minY = Math.min(minY, node.box.y);
      maxX = Math.max(maxX, node.box.x + node.width);
      maxY = Math.max(maxY, node.box.y + node.height);
    };

    trackNodeBounds(this.#neqtoNode);

    for (const destinationNode of this.#destinationNodes.values()) {
      trackNodeBounds(destinationNode);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    return { minX, minY, maxX, maxY };
  }

  #createNeqtoNode(): void {
    const neqtoNode = this.#canvasNodeService.createNeqtoNode();

    this.#nodeLayer?.addChild(neqtoNode.box);
    this.#nodeLayer?.addChild(neqtoNode.label);

    this.#neqtoNode = neqtoNode;
  }

  #positionNeqtoNode(): void {
    const hostElement = this.pixiHost()?.nativeElement;

    if (!hostElement || !this.#neqtoNode) {
      return;
    }

    this.#canvasNodeService.positionNodeInCenter(this.#neqtoNode, hostElement.clientWidth, hostElement.clientHeight);
  }

  #connectToStream(): void {
    this.#streamWorkerService
      .openMockStream()
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((event) => {
        this.#handleStreamEvent(event);
      });
    this.#streamWorkerService.streamErrors$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe();
  }

  onTogglePause(): void {
    this.#livePlaybackService.togglePause(this.#nowInMs());

    if (this.#livePlaybackService.isPaused()) {
      this.#streamWorkerService.closeMockStream();

      return;
    }

    this.#streamWorkerService.openMockStream();
  }

  onGoLive(): void {
    const wasPaused = this.#livePlaybackService.isPaused();

    this.#livePlaybackService.goLive(this.#nowInMs());

    if (wasPaused) {
      this.#streamWorkerService.openMockStream();
    }
  }

  onDestinationSidebarVisibleChange(visible: boolean): void {
    if (visible) {
      this.destinationSidebarVisible.set(true);

      return;
    }

    this.#clearSelectedDestinationNode();
  }

  #handleStreamEvent(event: CockpitMockStreamEvent): void {
    this.#processStreamEvent(event);
  }

  #processStreamEvent(event: CockpitMockStreamEvent): void {
    this.#updateRequestRadiusFromEvent(event);
    const destination = typeof event.destination === 'string' ? event.destination.trim() : '';

    if (destination) {
      this.#upsertDestinationNode(event);
    }

    this.#requestAnimationService.ingestEvent(event, this.#livePlaybackService.timelineClockMs());
  }

  #renderCurrentAnimationFrame(forceRender = false): void {
    if (this.#livePlaybackService.isPaused() && !forceRender) {
      return;
    }

    this.#renderAnimationTick(
      this.#requestAnimationService.render(this.#livePlaybackService.timelineClockMs(), (destinationKey) =>
        this.#resolveAnimationEndpoints(destinationKey),
      ),
    );
  }

  #updateRequestRadiusFromEvent(event: CockpitMockStreamEvent): void {
    const requestId = String(event.id);

    if (typeof event.response_size !== 'number' || event.response_size < 0) {
      if (!this.#requestSpriteRadiusById.has(requestId)) {
        this.#requestSpriteRadiusById.set(requestId, this.#defaultSpriteRadius);
      }

      return;
    }

    const radius = this.#resolveRequestRadius(event.response_size);

    this.#requestSizesById.set(requestId, event.response_size);
    this.#requestSpriteRadiusById.set(requestId, radius);

    const sprite = this.#requestSprites.get(requestId);

    if (sprite) {
      this.#updateRequestSpriteVisuals(requestId, sprite, radius);
    }
  }

  #resolveRequestRadius(responseSize: number): number {
    if (responseSize <= 0) {
      return this.#defaultSpriteRadius;
    }

    const scaled = 4 + Math.log10(responseSize + 1) * 2;

    return Math.min(this.#maxSpriteRadius, Math.max(this.#minSpriteRadius, scaled));
  }

  #updateRequestSpriteVisuals(requestId: string, sprite: Sprite, radius: number): void {
    const isSelected = this.#selectedRequestId === requestId;

    sprite.texture = isSelected ? this.#ballHighlightTexture : this.#ballTexture;
    const diameter = radius * 2;

    sprite.width = diameter;
    sprite.height = diameter;
  }

  #setSelectedRequestId(requestId: string | null): void {
    if (this.#selectedRequestId === requestId) {
      return;
    }

    const previousRequestId = this.#selectedRequestId;

    this.#selectedRequestId = requestId;
    this.#redrawRequestSpriteForSelection(previousRequestId);
    this.#redrawRequestSpriteForSelection(requestId);
  }

  #redrawRequestSpriteForSelection(requestId: string | null): void {
    if (!requestId) {
      return;
    }

    const sprite = this.#requestSprites.get(requestId);

    if (!sprite) {
      return;
    }

    const radius = this.#requestSpriteRadiusById.get(requestId) ?? this.#defaultSpriteRadius;

    this.#updateRequestSpriteVisuals(requestId, sprite, radius);
  }

  #upsertDestinationNode(event: CockpitMockStreamEvent): void {
    const hostElement = this.pixiHost()?.nativeElement;
    const nodeLayer = this.#nodeLayer;
    const destination = typeof event.destination === 'string' ? event.destination.trim() : '';

    if (!hostElement || !destination || !nodeLayer) {
      return;
    }

    const destinationKey = destination.toLowerCase();

    if (this.#destinationNodes.has(destinationKey)) {
      return;
    }

    const positionResult = this.#canvasNodeService.positionNode(
      destination,
      hostElement.clientWidth,
      hostElement.clientHeight,
    );

    if (!positionResult.isNew) {
      return;
    }

    const destinationNode = this.#canvasNodeService.createNode(
      destination,
      this.#destinationNodeWidth,
      this.#destinationNodeHeight,
    );

    this.#bindDestinationNodeClick(destinationKey, destination, destinationNode);

    destinationNode.box.x = positionResult.position.x - destinationNode.width / 2;
    destinationNode.box.y = positionResult.position.y - destinationNode.height / 2;
    destinationNode.label.x = positionResult.position.x;
    destinationNode.label.y = positionResult.position.y;

    this.#drawConnectionLine(destinationKey, destinationNode);

    nodeLayer.addChild(destinationNode.box);
    nodeLayer.addChild(destinationNode.label);

    this.#destinationNodes.set(destinationKey, destinationNode);
    this.#syncZoomPanWorldDimensions();
  }

  #bindDestinationNodeClick(destinationKey: string, destinationName: string, destinationNode: CockpitCanvasNode): void {
    const onDestinationClick = (): void => {
      this.#ngZone.run(() => {
        this.#selectDestinationNode(destinationKey, destinationName);
      });
    };

    destinationNode.box.eventMode = 'static';
    destinationNode.box.cursor = 'pointer';
    destinationNode.box.on('pointertap', onDestinationClick);

    destinationNode.label.eventMode = 'static';
    destinationNode.label.cursor = 'pointer';
    destinationNode.label.on('pointertap', onDestinationClick);
  }

  #selectDestinationNode(destinationKey: string, destinationName: string): void {
    if (this.#selectedDestinationKey !== destinationKey) {
      const previousDestinationKey = this.#selectedDestinationKey;

      this.#selectedDestinationKey = destinationKey;
      this.#redrawDestinationNode(previousDestinationKey);
      this.#redrawDestinationNode(destinationKey);
    }

    this.selectedDestinationName.set(destinationName);
    this.destinationSidebarVisible.set(true);
  }

  #clearSelectedDestinationNode(): void {
    const previousDestinationKey = this.#selectedDestinationKey;

    this.#selectedDestinationKey = null;
    this.#redrawDestinationNode(previousDestinationKey);
    this.selectedDestinationName.set(null);
    this.destinationSidebarVisible.set(false);
  }

  #redrawDestinationNode(destinationKey: string | null): void {
    if (!destinationKey) {
      return;
    }

    const destinationNode = this.#destinationNodes.get(destinationKey);

    if (!destinationNode) {
      return;
    }

    const isSelected = this.#selectedDestinationKey === destinationKey;

    destinationNode.box.clear();
    destinationNode.box.roundRect(0, 0, destinationNode.width, destinationNode.height, 14);
    destinationNode.box.fill(0xffffff);
    destinationNode.box.stroke({
      color: isSelected ? this.#destinationNodeSelectedStrokeColor : this.#destinationNodeStrokeColor,
      width: isSelected ? this.#destinationNodeSelectedStrokeWidth : this.#destinationNodeDefaultStrokeWidth,
    });
  }

  #positionDestinationNodes(): void {
    const hostElement = this.pixiHost()?.nativeElement;

    if (!hostElement || this.#destinationNodes.size === 0) {
      return;
    }

    this.#canvasNodeService.resetDestinationPositions();

    for (const [destinationKey, destinationNode] of this.#destinationNodes.entries()) {
      const positionResult = this.#canvasNodeService.positionNode(
        destinationKey,
        hostElement.clientWidth,
        hostElement.clientHeight,
      );

      destinationNode.box.x = positionResult.position.x - destinationNode.width / 2;
      destinationNode.box.y = positionResult.position.y - destinationNode.height / 2;
      destinationNode.label.x = positionResult.position.x;
      destinationNode.label.y = positionResult.position.y;
    }

    this.#redrawConnectionLines();
    this.#renderCurrentAnimationFrame(true);
  }

  #redrawConnectionLines(): void {
    if (this.#destinationNodes.size === 0) {
      return;
    }

    for (const [destinationKey, destinationNode] of this.#destinationNodes.entries()) {
      this.#drawConnectionLine(destinationKey, destinationNode);
    }
  }

  #drawConnectionLine(destinationKey: string, destinationNode: CockpitCanvasNode): void {
    const neqtoNode = this.#neqtoNode;
    const lineLayer = this.#lineLayer;

    if (!neqtoNode || !lineLayer) {
      return;
    }

    let line = this.#connectionLines.get(destinationKey);

    if (!line) {
      line = new Graphics();
      lineLayer.addChild(line);
      this.#connectionLines.set(destinationKey, line);
    }

    const sourceX = neqtoNode.box.x + neqtoNode.width / 2;
    const sourceY = neqtoNode.box.y + neqtoNode.height / 2;
    const targetX = destinationNode.box.x + destinationNode.width / 2;
    const targetY = destinationNode.box.y + destinationNode.height / 2;

    line.clear();
    line.moveTo(sourceX, sourceY);
    line.lineTo(targetX, targetY);
    line.stroke({
      color: this.#connectionLineColor,
      width: this.#connectionLineWidth,
      alpha: this.#connectionLineAlpha,
    });
  }

  #createRequestSprite(requestId: string, radius: number): Sprite {
    const isSelected = this.#selectedRequestId === requestId;
    const sprite = new Sprite(isSelected ? this.#ballHighlightTexture : this.#ballTexture);

    sprite.anchor.set(0.5);
    const diameter = radius * 2;

    sprite.width = diameter;
    sprite.height = diameter;
    sprite.eventMode = this.#performanceBudgetService.budgetConfig().hitTestingEnabled ? 'static' : 'none';
    sprite.cursor = 'pointer';
    sprite.on('pointertap', () => {
      this.#ngZone.run(() => {
        this.#streamWorkerService.selectRequest(requestId);
      });
    });

    return sprite;
  }

  #updateSpriteHitTesting(interactive: boolean): void {
    const mode = interactive ? 'static' : 'none';

    for (const sprite of this.#requestSprites.values()) {
      sprite.eventMode = mode;
    }
  }

  #upsertRequestSprite(requestId: string | number): Sprite | null {
    const normalizedRequestId = String(requestId).trim();

    if (!normalizedRequestId) {
      return null;
    }

    const existingSprite = this.#requestSprites.get(normalizedRequestId);

    if (existingSprite) {
      return existingSprite;
    }

    const radius = this.#requestSpriteRadiusById.get(normalizedRequestId) ?? this.#defaultSpriteRadius;
    const spriteLayer = this.#spriteLayer;

    if (!spriteLayer) {
      return null;
    }

    const requestSprite = this.#createRequestSprite(normalizedRequestId, radius);

    spriteLayer.addChild(requestSprite);
    this.#requestSprites.set(normalizedRequestId, requestSprite);

    return requestSprite;
  }

  #removeRequestSprite(requestId: string | number): void {
    const normalizedRequestId = String(requestId).trim();

    if (!normalizedRequestId) {
      return;
    }

    const sprite = this.#requestSprites.get(normalizedRequestId);

    if (!sprite) {
      return;
    }

    this.#destroySprite(sprite);
    this.#requestSprites.delete(normalizedRequestId);
    this.#requestSpriteRadiusById.delete(normalizedRequestId);
    this.#requestSizesById.delete(normalizedRequestId);
  }

  #destroySprite(sprite: Sprite): void {
    sprite.parent?.removeChild(sprite);
    sprite.destroy();
  }

  #renderAnimationTick(animationTick: CockpitAnimationTickResult): void {
    for (const frame of animationTick.frames) {
      const sprite = this.#upsertRequestSprite(frame.requestId);

      if (!sprite) {
        continue;
      }

      sprite.x = frame.x;
      sprite.y = frame.y;
    }

    for (const requestId of animationTick.completedRequestIds) {
      this.#removeRequestSprite(requestId);
    }
  }

  #renderAnimations = (): void => {
    this.#livePlaybackService.advanceTimelineClock(this.#nowInMs());

    if (this.#livePlaybackService.isPaused()) {
      return;
    }

    this.#renderCurrentAnimationFrame();
  };

  #resolveAnimationEndpoints(destinationKey: string): CockpitAnimationEndpoints | null {
    const neqtoNode = this.#neqtoNode;
    const destinationNode = this.#destinationNodes.get(destinationKey);

    if (!neqtoNode || !destinationNode) {
      return null;
    }

    return {
      sourceX: neqtoNode.box.x + neqtoNode.width / 2,
      sourceY: neqtoNode.box.y + neqtoNode.height / 2,
      targetX: destinationNode.box.x + destinationNode.width / 2,
      targetY: destinationNode.box.y + destinationNode.height / 2,
    };
  }

  #nowInMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  #setupSidebarObserver(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const sidebarElement = document.querySelector('app-basic-layout .cap-sidebar');

    if (!(sidebarElement instanceof HTMLElement)) {
      return;
    }

    this.#sidebarObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          this.#resizeCanvasAfterSidebarChange();
          break;
        }
      }
    });

    this.#sidebarObserver.observe(sidebarElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  #resizeCanvasAfterSidebarChange(): void {
    if (!this.#app || typeof window === 'undefined') {
      return;
    }

    this.#app.resize();
    this.#positionNeqtoNode();
    this.#positionDestinationNodes();
    this.#syncZoomPanAfterLayoutCycle();

    if (this.#resizeTimeoutId !== null) {
      window.clearTimeout(this.#resizeTimeoutId);
    }

    // Sidebar width transition needs a delayed resize to finalize dimensions.
    this.#resizeTimeoutId = window.setTimeout(() => {
      this.#app?.resize();
      this.#positionNeqtoNode();
      this.#positionDestinationNodes();
      this.#syncZoomPanAfterLayoutCycle();
    }, 300);
  }
}
