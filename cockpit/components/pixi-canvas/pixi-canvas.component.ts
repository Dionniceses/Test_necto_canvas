import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  effect,
  inject,
  output,
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
import { CockpitCanvasNodeService } from '../../services/cockpit-canvas-node.service';
import { CockpitRequestAnimationService } from '../../services/cockpit-request-animation.service';
import { CockpitTimelineVisualEvent } from '../../interfaces/cockpit-timeline.interface';
import { CockpitTimelineCoordinatorService } from '../../services/cockpit-timeline-coordinator.service';
import { StreamWorkerService } from '../../services/stream-worker.service';
import { ZoomPanService } from '../../services/zoom-pan.service';
import { PerformanceBudgetService } from '../../services/performance-budget.service';
import { AdvancedSettingsService } from '@features/cockpit/services/advanced-settings.service';

@Component({
  selector: 'app-pixi-canvas',
  imports: [],
  templateUrl: './pixi-canvas.component.html',
  styleUrl: './pixi-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PixiCanvasComponent {
  pixiHost = viewChild<ElementRef<HTMLDivElement>>('pixiHost');
  destinationSelected = output<string | null>();

  #app: Application | null = null;
  #neqtoNode: CockpitCanvasNode | null = null;
  #worldContainer: Container | null = null;
  #destinationNodes = new Map<string, CockpitCanvasNode>();
  #connectionLines = new Map<string, Graphics>();
  #requestSprites = new Map<string, Graphics | Sprite>();
  #hostResizeObserver: ResizeObserver | null = null;
  #sidebarObserver: MutationObserver | null = null;
  #resizeTimeoutId: number | null = null;
  #hitTestingIdleTimeoutId: number | null = null;
  #isViewportInteracting = false;
  #isZoomPanInitialized = false;
  #isDestroyed = false;
  #destroyRef = inject(DestroyRef);
  #canvasNodeService = inject(CockpitCanvasNodeService);
  #requestAnimationService = inject(CockpitRequestAnimationService);
  #timelineCoordinator = inject(CockpitTimelineCoordinatorService);
  #streamWorkerService = inject(StreamWorkerService);
  #zoomPanService = inject(ZoomPanService);
  #ngZone = inject(NgZone);
  #performanceBudgetService = inject(PerformanceBudgetService);
  #advancedSetting = inject(AdvancedSettingsService);

  readonly backgroundcolor = this.#advancedSetting.backgroundcolor;
  readonly playheadTs = this.#timelineCoordinator.playheadTs;
  readonly isPaused = this.#timelineCoordinator.isPaused;

  #requestSpriteRadiusById = new Map<string, number>();
  #requestSizesById = new Map<string, number>();
  #requestResponseCodeById = new Map<string, number>();
  #selectedRequestId: string | null = null;
  #selectedDestinationKey: string | null = null;

  #lineLayer: Container | null = null;
  #spriteLayer: Container | null = null;
  #nodeLayer: Container | null = null;

  #ballTexture: Texture | null = null;
  #ballHighlightTexture: Texture | null = null;
  #ballTexture2xx: Texture | null = null;
  #ballTexture2xxHighlight: Texture | null = null;
  #ballTexture4_5xx: Texture | null = null;
  #ballTexture4_5xxHighlight: Texture | null = null;
  #ballTexture1_3xx: Texture | null = null;
  #ballTexture1_3xxHighlight: Texture | null = null;

  #neqtoLogo: Container | null = null;
  #texturesLoaded = false;

  readonly #destinationNodeWidth = 130;
  readonly #destinationNodeHeight = 40;
  readonly #connectionLineColor = 0xe5247d;
  readonly #connectionLineWidth = 2;
  readonly #connectionLineAlpha = 0.2;
  readonly #requestBaseSpriteColor = 0x00a4b3;
  readonly #requestSelectedSpriteStrokeColor = 0xffe800;
  readonly #requestSelectedSpriteStrokeWidth = 2;
  readonly #defaultSpriteRadius = 8;
  readonly #minSpriteRadius = 2;
  readonly #maxSpriteRadius = 20;
  readonly #worldDimensionPadding = 24;
  readonly #hitTestingIdleMs = 250;

  constructor() {
    this.#streamWorkerService.selectedRequestId$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe((requestId) => {
      this.#setSelectedRequestId(requestId);
    });

    this.#timelineCoordinator.visualEvents$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe((visualEvent) => {
      this.#handleTimelineVisualEvent(visualEvent);
    });

    this.#timelineCoordinator.sessionReset$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe(() => {
      this.#resetTimelineVisuals(true);
    });

    effect(() => {
      this.#performanceBudgetService.budgetConfig();
      this.#syncHitTestingState();
    });

    effect(() => {
      // Re-render frame manually when playhead moves while paused (e.g. scrubbing)
      this.playheadTs();
      if (this.isPaused()) {
        this.#renderCurrentAnimationFrame(true);
      }
    });

    effect(() => {
      const color = this.backgroundcolor();

      if (this.#app) {
        this.#app.renderer.background.color = color;
      }
    });

    effect(() => {
      this.#advancedSetting.boxplacementformula();
      this.#positionDestinationNodes();
    });

    afterNextRender(async () => {
      const hostElement = this.pixiHost()?.nativeElement;

      if (!hostElement || this.#isDestroyed) {
        return;
      }

      // Creates an app
      const app = new Application();

      await app.init({
        resizeTo: hostElement,
        backgroundColor: this.backgroundcolor(),
        antialias: true,
      });

      if (this.#isDestroyed) {
        app.destroy(true, { children: true, texture: false });

        return;
      }

      hostElement.appendChild(app.canvas);
      this.#app = app;

      try {
        const [baseTex, baseTexhl] = await Promise.all([
          Assets.load<Texture>('assets/images/basetex.png'),
          Assets.load<Texture>('assets/images/basetexhl.png'),
        ]);

        if (this.#isDestroyed) {
          return;
        }

        const [tex2xx, tex2xxhl, tex4_5xx, tex4_5xxhl, tex1_3xx, tex1_3xxhl] = await Promise.allSettled([
          Assets.load<Texture>('assets/images/tex2xx.png'),
          Assets.load<Texture>('assets/images/tex2xxhl.png'),
          Assets.load<Texture>('assets/images/tex4-5xx.png'),
          Assets.load<Texture>('assets/images/tex4-5xxhl.png'),
          Assets.load<Texture>('assets/images/tex1-3xx.png'),
          Assets.load<Texture>('assets/images/tex1-3xxhl.png'),
        ]);

        this.#ballTexture = baseTex;
        this.#ballHighlightTexture = baseTexhl;

        if (tex2xx.status === 'fulfilled') {
          this.#ballTexture2xx = tex2xx.value;
        }

        if (tex2xxhl.status === 'fulfilled') {
          this.#ballTexture2xxHighlight = tex2xxhl.value;
        }

        if (tex4_5xx.status === 'fulfilled') {
          this.#ballTexture4_5xx = tex4_5xx.value;
        }

        if (tex4_5xxhl.status === 'fulfilled') {
          this.#ballTexture4_5xxHighlight = tex4_5xxhl.value;
        }

        if (tex1_3xx.status === 'fulfilled') {
          this.#ballTexture1_3xx = tex1_3xx.value;
        }

        if (tex1_3xxhl.status === 'fulfilled') {
          this.#ballTexture1_3xxHighlight = tex1_3xxhl.value;
        }

        this.#texturesLoaded = true;
      } catch {
        // Textures unavailable -” falling back to Graphics rendering
      }

      this.#worldContainer = new Container(); // for pan and zoom later
      this.#app.stage.addChild(this.#worldContainer);

      // Create layers in rendering order (bottom to top)
      this.#lineLayer = new Container();
      this.#spriteLayer = new Container();
      this.#nodeLayer = new Container();

      this.#worldContainer.addChild(this.#lineLayer);
      this.#worldContainer.addChild(this.#spriteLayer);
      this.#worldContainer.addChild(this.#nodeLayer);

      this.#app.ticker?.add?.(this.#renderAnimations);

      this.#setupHostResizeObserver();
      this.#setupSidebarObserver();

      this.#createNeqtoNode();
      this.#positionNeqtoNode();
      void this.#loadNeqtoLogo();
      this.#initializeZoomPan(hostElement);
    });

    this.#destroyRef.onDestroy(() => {
      this.#isDestroyed = true;
      this.#hostResizeObserver?.disconnect();
      this.#hostResizeObserver = null;

      this.#sidebarObserver?.disconnect();
      this.#sidebarObserver = null;

      if (this.#resizeTimeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(this.#resizeTimeoutId);
        this.#resizeTimeoutId = null;
      }

      if (this.#hitTestingIdleTimeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(this.#hitTestingIdleTimeoutId);
        this.#hitTestingIdleTimeoutId = null;
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
      this.#neqtoLogo = null;
      this.#destinationNodes.clear();
      this.#connectionLines.clear();
      this.#requestSprites.clear();
      this.#requestSpriteRadiusById.clear();
      this.#requestSizesById.clear();
      this.#requestResponseCodeById.clear();
      this.#requestAnimationService.reset();
      this.#canvasNodeService.resetDestinationPositions();
      this.#isZoomPanInitialized = false;
      this.#zoomPanService.dispose();
      this.#timelineCoordinator.close();
    });
  }

  #initializeZoomPan(hostElement: HTMLElement): void {
    this.#zoomPanService.stateChanged$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe((state) => {
      this.#applyZoomPanState(state);
      this.#markViewportInteracting();
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
    // Place the label below the inscribed circle rather than at its centre.
    this.#neqtoNode.label.y = hostElement.clientHeight / 2 + this.#neqtoNode.height / 2 + 8;
    this.#positionNeqtoLogo();
  }

  async #loadNeqtoLogo(): Promise<void> {
    try {
      const logoTex = await Assets.load<Texture>('assets/images/neqto.svg');

      if (!this.#app || !this.#nodeLayer) {
        return;
      }

      // Use Graphics (not Sprite) so the logo is excluded from the
      // Sprite-specific event-mode management and test assertions.
      const logo = new Graphics();

      logo.rect(0, 0, 64, 40);
      logo.fill({ texture: logoTex });
      logo.pivot.set(32, 20);
      logo.eventMode = 'none';
      this.#neqtoLogo = logo;
      this.#nodeLayer.addChild(logo);
      this.#positionNeqtoLogo();
    } catch {
      // SVG unavailable -” center node shows text label only
    }
  }

  #positionNeqtoLogo(): void {
    const hostElement = this.pixiHost()?.nativeElement;

    if (!hostElement || !this.#neqtoLogo) {
      return;
    }

    this.#neqtoLogo.x = hostElement.clientWidth / 2;
    this.#neqtoLogo.y = hostElement.clientHeight / 2;
  }

  #handleTimelineVisualEvent(visualEvent: CockpitTimelineVisualEvent): void {
    const event = visualEvent.event;

    this.#updateRequestInfoFromEvent(event);
    const destination = typeof event.destination === 'string' ? event.destination.trim() : '';

    if (destination) {
      this.#upsertDestinationNode(event);
    }

    this.#requestAnimationService.ingestEvent(
      visualEvent.animationEvent,
      visualEvent.animationTs,
      visualEvent.visualDurationMultiplier,
    );
  }

  #resetTimelineVisuals(keepDestinations = false): void {
    this.#requestAnimationService.reset();
    this.#streamWorkerService.resetRequestDetails();
    this.#clearRequestSprites();

    if (!keepDestinations) {
      this.#clearDestinationNodes();
    }
  }

  #clearRequestSprites(): void {
    for (const sprite of this.#requestSprites.values()) {
      this.#destroySprite(sprite);
    }

    this.#requestSprites.clear();
    this.#requestSpriteRadiusById.clear();
    this.#requestSizesById.clear();
  }

  #clearDestinationNodes(): void {
    for (const destinationNode of this.#destinationNodes.values()) {
      destinationNode.box.destroy();
      destinationNode.label.destroy();
    }

    for (const line of this.#connectionLines.values()) {
      line.destroy();
    }

    this.#destinationNodes.clear();
    this.#connectionLines.clear();
    this.#canvasNodeService.resetDestinationPositions();
    this.#syncZoomPanWorldDimensions();
  }

  #renderCurrentAnimationFrame(forceRender = false): void {
    if (this.isPaused() && !forceRender) {
      return;
    }

    this.#renderAnimationTick(
      this.#requestAnimationService.render(this.playheadTs(), (destinationKey) =>
        this.#resolveAnimationEndpoints(destinationKey),
      ),
    );
  }

  #updateRequestInfoFromEvent(event: CockpitMockStreamEvent): void {
    const requestId = String(event.id).trim();

    if (!requestId) {
      return;
    }

    if (typeof event.response_code === 'number' && Number.isFinite(event.response_code) && event.response_code > 0) {
      this.#requestResponseCodeById.set(requestId, event.response_code);
    }

    const sprite = this.#requestSprites.get(requestId);

    if (typeof event.response_size !== 'number' || event.response_size < 0) {
      if (!this.#requestSpriteRadiusById.has(requestId)) {
        this.#requestSpriteRadiusById.set(requestId, this.#defaultSpriteRadius);
      }

      if (sprite) {
        const radius = this.#requestSpriteRadiusById.get(requestId) ?? this.#defaultSpriteRadius;

        this.#updateRequestSpriteVisuals(requestId, sprite, radius);
      }

      return;
    }

    const radius = this.#resolveRequestRadius(event.response_size);

    this.#requestSizesById.set(requestId, event.response_size);
    this.#requestSpriteRadiusById.set(requestId, radius);

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

  #drawRequestSprite(requestId: string, sprite: Graphics, radius: number): void {
    const isSelected = this.#selectedRequestId === requestId;

    sprite.clear();
    sprite.circle(0, 0, radius);
    sprite.fill(this.#requestBaseSpriteColor);
    sprite.stroke({
      color: isSelected ? this.#requestSelectedSpriteStrokeColor : 0xffffff,
      width: isSelected ? this.#requestSelectedSpriteStrokeWidth : 1,
    });
  }

  #updateRequestSpriteVisuals(requestId: string, sprite: Graphics | Sprite, radius: number): void {
    if (sprite instanceof Sprite) {
      const isSelected = this.#selectedRequestId === requestId;
      const statusCode = this.#requestResponseCodeById.get(requestId);

      sprite.texture = this.#selectTextureForStatusCode(statusCode, isSelected);

      const diameter = radius * 2;

      sprite.width = diameter;
      sprite.height = diameter;
    } else {
      this.#drawRequestSprite(requestId, sprite, radius);
    }
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

  #selectTextureForStatusCode(statusCode: number | undefined, isHighlight: boolean): Texture {
    if (!statusCode) {
      return isHighlight && this.#ballHighlightTexture
        ? this.#ballHighlightTexture
        : (this.#ballTexture ?? Texture.WHITE);
    }

    if (statusCode >= 200 && statusCode < 300) {
      return isHighlight && this.#ballTexture2xxHighlight
        ? this.#ballTexture2xxHighlight
        : (this.#ballTexture2xx ?? Texture.WHITE);
    }

    if (statusCode >= 400 && statusCode < 600) {
      return isHighlight && this.#ballTexture4_5xxHighlight
        ? this.#ballTexture4_5xxHighlight
        : (this.#ballTexture4_5xx ?? Texture.WHITE);
    }

    // 1xx and 3xx
    return isHighlight && this.#ballTexture1_3xxHighlight
      ? this.#ballTexture1_3xxHighlight
      : (this.#ballTexture1_3xx ?? Texture.WHITE);
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

    destinationNode.box.eventMode = this.#resolveDestinationNodeHitTestingMode();
    destinationNode.box.cursor = 'pointer';
    destinationNode.box.on('pointertap', onDestinationClick);

    destinationNode.label.eventMode = this.#resolveDestinationNodeHitTestingMode();
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

    this.destinationSelected.emit(destinationName);
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
    this.#canvasNodeService.drawDestinationBox(
      destinationNode.box,
      destinationNode.width,
      destinationNode.height,
      destinationNode.nodeColor ?? 0x1f8a5b,
      isSelected,
    );
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

  #createRequestSprite(requestId: string, radius: number): Graphics | Sprite {
    let sprite: Graphics | Sprite;

    if (this.#texturesLoaded && this.#ballTexture) {
      const pixiSprite = new Sprite(this.#ballTexture);
      const statusCode = this.#requestResponseCodeById.get(requestId);
      const isSelected = this.#selectedRequestId === requestId;

      pixiSprite.texture = this.#selectTextureForStatusCode(statusCode, isSelected);
      pixiSprite.anchor.set(0.5);

      const diameter = radius * 2;

      pixiSprite.width = diameter;
      pixiSprite.height = diameter;
      sprite = pixiSprite;
    } else {
      const graphicsSprite = new Graphics();

      this.#drawRequestSprite(requestId, graphicsSprite, radius);
      sprite = graphicsSprite;
    }

    sprite.eventMode = this.#resolveRequestSpriteHitTestingMode();
    sprite.cursor = 'pointer';
    sprite.on('pointertap', () => {
      this.#ngZone.run(() => {
        this.#streamWorkerService.selectRequest(requestId);
      });
    });

    return sprite;
  }

  #syncHitTestingState(): void {
    this.#updateHitTesting();
  }

  #markViewportInteracting(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.#isViewportInteracting = true;
    this.#syncHitTestingState();

    if (this.#hitTestingIdleTimeoutId !== null) {
      window.clearTimeout(this.#hitTestingIdleTimeoutId);
    }

    this.#hitTestingIdleTimeoutId = window.setTimeout(() => {
      this.#hitTestingIdleTimeoutId = null;
      this.#isViewportInteracting = false;
      this.#syncHitTestingState();
    }, this.#hitTestingIdleMs);
  }

  #resolveDestinationNodeHitTestingMode(): 'static' | 'none' {
    return !this.#isViewportInteracting ? 'static' : 'none';
  }

  #resolveRequestSpriteHitTestingMode(): 'static' | 'none' {
    return this.#performanceBudgetService.budgetConfig().hitTestingEnabled && !this.#isViewportInteracting
      ? 'static'
      : 'none';
  }

  #updateHitTesting(): void {
    const ballMode = this.#resolveRequestSpriteHitTestingMode();
    const destinationNodeMode = this.#resolveDestinationNodeHitTestingMode();

    for (const sprite of this.#requestSprites.values()) {
      sprite.eventMode = ballMode;
    }

    for (const destinationNode of this.#destinationNodes.values()) {
      destinationNode.box.eventMode = destinationNodeMode;
      destinationNode.label.eventMode = destinationNodeMode;
    }
  }

  #upsertRequestSprite(requestId: string | number): Graphics | Sprite | null {
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
    this.#streamWorkerService.retainRequestDetails(normalizedRequestId);

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
    this.#requestResponseCodeById.delete(normalizedRequestId);
    this.#streamWorkerService.evictRequestDetails(normalizedRequestId);
  }

  #destroySprite(sprite: Graphics | Sprite): void {
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

      const radius = this.#requestSpriteRadiusById.get(String(frame.requestId).trim()) ?? this.#defaultSpriteRadius;

      this.#updateRequestSpriteVisuals(String(frame.requestId).trim(), sprite, radius);
    }

    for (const requestId of animationTick.completedRequestIds) {
      this.#removeRequestSprite(requestId);
    }
  }

  #renderAnimations = (): void => {
    this.#timelineCoordinator.advanceLiveClock(Date.now());

    if (this.isPaused()) {
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

  #setupHostResizeObserver(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const host = this.pixiHost()?.nativeElement ?? document.querySelector('.pixi-canvas-host');

    if (!(host instanceof HTMLElement)) {
      return;
    }

    this.#hostResizeObserver = new ResizeObserver(() => {
      this.#scheduleCanvasResize();
    });

    this.#hostResizeObserver.observe(host);
  }

  #scheduleCanvasResize(): void {
    if (!this.#app || typeof window === 'undefined') {
      return;
    }

    if (this.#resizeTimeoutId !== null) {
      window.clearTimeout(this.#resizeTimeoutId);
    }

    this.#app.resize();
    this.#positionNeqtoNode();
    this.#positionDestinationNodes();
    this.#syncZoomPanAfterLayoutCycle();

    this.#resizeTimeoutId = window.setTimeout(() => {
      this.#app?.resize();
      this.#positionNeqtoNode();
      this.#positionDestinationNodes();
      this.#syncZoomPanAfterLayoutCycle();
    }, 300);
  }

  #setupSidebarObserver(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const sidebarElement = document.querySelector('app-basic-layout .cap-sidebar:not(.cockpit-box-sidebar)');

    if (!(sidebarElement instanceof HTMLElement)) {
      return;
    }

    this.#sidebarObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          this.#scheduleCanvasResize();
          break;
        }
      }
    });

    this.#sidebarObserver.observe(sidebarElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
}
