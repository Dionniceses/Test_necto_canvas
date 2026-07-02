import { ApplicationRef, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { CockpitHistoryGateway } from '../../interfaces/cockpit-history-gateway.interface';
import { CockpitRequestDetails } from '../../interfaces/cockpit-request-details.interface';
import { CockpitMockStreamEvent } from '../../interfaces/cockpit-stream.interface';
import { ZoomPanState } from '../../interfaces/zoom-pan.interface';
import { CockpitTimelineCoordinatorService } from '../../services/cockpit-timeline-coordinator.service';
import { COCKPIT_HISTORY_GATEWAY } from '../../services/cockpit-history-gateway.token';
import { PerformanceBudgetService } from '../../services/performance-budget.service';
import { StreamWorkerService } from '../../services/stream-worker.service';
import { ZoomPanService } from '../../services/zoom-pan.service';

import { PixiCanvasComponent } from './pixi-canvas.component';

class MockMutationObserver {
  static instances: MockMutationObserver[] = [];

  observe = jasmine.createSpy('observe');
  disconnect = jasmine.createSpy('disconnect');

  constructor(private readonly callback: MutationCallback) {
    MockMutationObserver.instances.push(this);
  }

  trigger(mutations: MutationRecord[]): void {
    this.callback(mutations, this as unknown as MutationObserver);
  }
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  observe = jasmine.createSpy('observe');
  unobserve = jasmine.createSpy('unobserve');
  disconnect = jasmine.createSpy('disconnect');

  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  trigger(entries: ResizeObserverEntry[]): void {
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

describe('PixiCanvasComponent', () => {
  let component: PixiCanvasComponent;
  let fixture: ComponentFixture<PixiCanvasComponent>;
  let originalMutationObserver: typeof MutationObserver;
  let originalResizeObserver: typeof ResizeObserver;
  let querySelectorSpy: jasmine.Spy;
  let appInitSpy: jasmine.Spy;
  let containerAddChildSpy: jasmine.Spy;
  let textureByAssetPath: Record<string, Texture>;
  let tickerCallback: () => void;
  let createdApps: Array<{ destroy: jasmine.Spy; addChild: jasmine.Spy }>;
  let mockStream$: Subject<CockpitMockStreamEvent>;
  let mockStreamErrors$: Subject<Error>;
  let selectedRequestId$: BehaviorSubject<string | null>;
  let selectedRequestDetails$: BehaviorSubject<CockpitRequestDetails | null>;
  let zoomPanState: ZoomPanState;
  let zoomPanState$: Subject<ZoomPanState>;
  let historyGatewayMock: jasmine.SpyObj<CockpitHistoryGateway>;
  let streamWorkerServiceMock: {
    closeStream: jasmine.Spy;
    selectRequest: jasmine.Spy;
    getRequestDetailsById: jasmine.Spy;
    resetRequestDetails: jasmine.Spy;
    retainRequestDetails: jasmine.Spy;
    evictRequestDetails: jasmine.Spy;
    observeDestination: jasmine.Spy;
    isLiveStreamActive: jasmine.Spy;
    syncPlayheadTime: jasmine.Spy;
    resetSession: jasmine.Spy;
    streamErrors$: Observable<Error>;
    streamEvents$: Observable<CockpitMockStreamEvent>;
    selectedRequestId$: Observable<string | null>;
    selectedRequestDetails$: Observable<CockpitRequestDetails | null>;
  };
  let zoomPanServiceMock: {
    stateChanged$: Observable<ZoomPanState>;
    state: jasmine.Spy;
    init: jasmine.Spy;
    setZoom: jasmine.Spy;
    setWorldBounds: jasmine.Spy;
    resize: jasmine.Spy;
    dispose: jasmine.Spy;
  };

  function resolveExpectedSpriteRadius(responseSize?: number): number {
    const defaultRadius = 8;
    const minRadius = 2;
    const maxRadius = 20;

    if (!responseSize || responseSize <= 0) {
      return defaultRadius;
    }

    const scaledRadius = 4 + Math.log10(responseSize + 1) * 2;

    return Math.min(maxRadius, Math.max(minRadius, scaledRadius));
  }

  async function renderComponent(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.inject(CockpitTimelineCoordinatorService).openDate(new Date());
    // In Angular 19, afterNextRender hooks only execute during ApplicationRef.tick().
    // detectChanges() alone does not trigger them.
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    tickerCallback();
  }

  function setHostDimensions(width: number, height: number): void {
    const hostElement = fixture.nativeElement.querySelector('.pixi-canvas-host') as HTMLDivElement;

    Object.defineProperty(hostElement, 'clientWidth', {
      configurable: true,
      get: () => width,
    });

    Object.defineProperty(hostElement, 'clientHeight', {
      configurable: true,
      get: () => height,
    });
  }

  beforeEach(async () => {
    mockStream$ = new Subject<CockpitMockStreamEvent>();
    mockStreamErrors$ = new Subject<Error>();
    selectedRequestId$ = new BehaviorSubject<string | null>(null);
    selectedRequestDetails$ = new BehaviorSubject<CockpitRequestDetails | null>(null);
    zoomPanState = { zoomLevel: 1, panX: 0, panY: 0 };
    zoomPanState$ = new Subject<ZoomPanState>();
    historyGatewayMock = jasmine.createSpyObj<CockpitHistoryGateway>('CockpitHistoryGateway', [
      'openLiveStream',
      'getRangeMeta',
      'loadBefore',
      'loadAfter',
      'loadRange',
    ]);
    historyGatewayMock.openLiveStream.and.returnValue(
      mockStream$.asObservable().pipe(map((event) => ({ event, source: 'live' as const }))),
    );
    historyGatewayMock.getRangeMeta.and.callFake((date: Date) => {
      const fromTs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      const toTs = fromTs + 60 * 60_000;

      return of({
        dateKey: '2026-01-01',
        serverNowTs: toTs,
        availableRange: { fromTs, toTs },
        downloadedRanges: [],
      });
    });
    historyGatewayMock.loadRange.and.callFake((fromTs: number, toTs: number) =>
      of({ snapshotId: 'snapshot-range', range: { fromTs, toTs }, count: 0, truncated: false }),
    );
    historyGatewayMock.loadBefore.and.returnValue(
      of({ snapshotId: 'snapshot-before', range: { fromTs: 0, toTs: 1 }, count: 0, truncated: false }),
    );
    historyGatewayMock.loadAfter.and.returnValue(
      of({ snapshotId: 'snapshot-after', range: { fromTs: 0, toTs: 1 }, count: 0, truncated: false }),
    );
    streamWorkerServiceMock = {
      closeStream: jasmine.createSpy('closeStream'),
      selectRequest: jasmine.createSpy('selectRequest'),
      getRequestDetailsById: jasmine.createSpy('getRequestDetailsById').and.returnValue(null),
      resetRequestDetails: jasmine.createSpy('resetRequestDetails'),
      retainRequestDetails: jasmine.createSpy('retainRequestDetails'),
      evictRequestDetails: jasmine.createSpy('evictRequestDetails'),
      observeDestination: jasmine.createSpy('observeDestination').and.returnValue(new Subject()),
      isLiveStreamActive: jasmine.createSpy('isLiveStreamActive').and.returnValue(true),
      syncPlayheadTime: jasmine.createSpy('syncPlayheadTime'),
      resetSession: jasmine.createSpy('resetSession'),
      streamErrors$: mockStreamErrors$.asObservable(),
      streamEvents$: mockStream$.asObservable(),
      selectedRequestId$: selectedRequestId$.asObservable(),
      selectedRequestDetails$: selectedRequestDetails$.asObservable(),
    };
    zoomPanServiceMock = {
      stateChanged$: zoomPanState$.asObservable(),
      state: jasmine.createSpy('state').and.callFake(() => zoomPanState),
      init: jasmine.createSpy('init'),
      setZoom: jasmine.createSpy('setZoom'),
      setWorldBounds: jasmine.createSpy('setWorldBounds'),
      resize: jasmine.createSpy('resize'),
      dispose: jasmine.createSpy('dispose'),
    };

    await TestBed.configureTestingModule({
      imports: [PixiCanvasComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        {
          provide: COCKPIT_HISTORY_GATEWAY,
          useValue: historyGatewayMock,
        },
        {
          provide: StreamWorkerService,
          useValue: streamWorkerServiceMock,
        },
        {
          provide: ZoomPanService,
          useValue: zoomPanServiceMock,
        },
        {
          provide: PerformanceBudgetService,
          useValue: {
            budgetConfig: signal({
              tickRateMs: 1_000,
              hitTestingEnabled: true,
              deferHintEvents: false,
            }),
            budgetState: signal('optimal'),
            averageFps: signal(0),
            isTimelineScrollDisabled: signal(false),
          },
        },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    originalMutationObserver = window.MutationObserver;
    originalResizeObserver = window.ResizeObserver;
    MockMutationObserver.instances = [];
    MockResizeObserver.instances = [];
    createdApps = [];
    tickerCallback = () => {};

    (window as Window & { MutationObserver: typeof MutationObserver }).MutationObserver =
      MockMutationObserver as unknown as typeof MutationObserver;
    (window as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
    querySelectorSpy = spyOn(document, 'querySelector').and.callThrough();
    containerAddChildSpy = spyOn(Container.prototype, 'addChild').and.callThrough();
    textureByAssetPath = {
      'assets/images/basetex.png': Object.create(Texture.WHITE) as Texture,
      'assets/images/basetexhl.png': Object.create(Texture.WHITE) as Texture,
      'assets/images/tex2xx.png': Object.create(Texture.WHITE) as Texture,
      'assets/images/tex2xxhl.png': Object.create(Texture.WHITE) as Texture,
      'assets/images/tex4-5xx.png': Object.create(Texture.WHITE) as Texture,
      'assets/images/tex4-5xxhl.png': Object.create(Texture.WHITE) as Texture,
      'assets/images/tex1-3xx.png': Object.create(Texture.WHITE) as Texture,
      'assets/images/tex1-3xxhl.png': Object.create(Texture.WHITE) as Texture,
      'assets/images/neqto.svg': Object.create(Texture.WHITE) as Texture,
    };
    spyOn(Assets, 'load').and.callFake((urls: string | unknown[]) => {
      if (typeof urls === 'string') {
        return Promise.resolve(textureByAssetPath[urls] ?? Texture.WHITE);
      }

      return Promise.resolve(Texture.WHITE);
    });

    appInitSpy = spyOn(Application.prototype, 'init').and.callFake(async function (this: Application) {
      const canvas = document.createElement('canvas');
      const destroySpy = jasmine.createSpy('destroy');
      const addChildSpy = jasmine.createSpy('addChild');

      Object.defineProperty(this, 'canvas', {
        configurable: true,
        get: () => canvas,
      });

      (this as unknown as { stage: { addChild: jasmine.Spy } }).stage = {
        addChild: addChildSpy,
      };

      (this as unknown as { resize: jasmine.Spy }).resize = jasmine.createSpy('resize');
      (this as unknown as { destroy: jasmine.Spy }).destroy = destroySpy;
      (this as unknown as { ticker: { add: jasmine.Spy; remove: jasmine.Spy } }).ticker = {
        add: jasmine.createSpy('add').and.callFake((callback: () => void) => {
          tickerCallback = callback;
        }),
        remove: jasmine.createSpy('remove'),
      };

      createdApps.push({ destroy: destroySpy, addChild: addChildSpy });
    });

    fixture = TestBed.createComponent(PixiCanvasComponent);
    component = fixture.componentInstance;
    setHostDimensions(800, 600);
  });

  afterEach(() => {
    (window as Window & { MutationObserver: typeof MutationObserver }).MutationObserver = originalMutationObserver;
    (window as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = originalResizeObserver;
    mockStream$.complete();
    mockStreamErrors$.complete();
    selectedRequestId$.complete();
    selectedRequestDetails$.complete();
    zoomPanState$.complete();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should observe host element size changes with ResizeObserver and schedule resize work', async () => {
    await renderComponent();

    expect(MockResizeObserver.instances.length).toBe(1);

    const observer = MockResizeObserver.instances[0];
    const host = fixture.nativeElement.querySelector('.pixi-canvas-host');

    expect(observer.observe).toHaveBeenCalledWith(host);

    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callThrough();

    setTimeoutSpy.calls.reset();

    observer.trigger([] as unknown as ResizeObserverEntry[]);

    expect(setTimeoutSpy).toHaveBeenCalled();
  });

  it('should observe sidebar class changes and schedule resize work', async () => {
    const sidebar = document.createElement('div');
    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callThrough();

    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar:not(.cockpit-box-sidebar)').and.returnValue(sidebar);
    await renderComponent();

    expect(appInitSpy).toHaveBeenCalled();
    expect(historyGatewayMock.openLiveStream).toHaveBeenCalledTimes(1);

    expect(MockMutationObserver.instances.length).toBe(1);

    const observer = MockMutationObserver.instances[0];

    expect(observer.observe).toHaveBeenCalledWith(sidebar, {
      attributes: true,
      attributeFilter: ['class'],
    });

    setTimeoutSpy.calls.reset();
    observer.trigger([{ type: 'attributes', attributeName: 'class' } as MutationRecord]);

    expect(setTimeoutSpy).toHaveBeenCalled();
  });

  it('should ignore non-class sidebar mutations', async () => {
    const sidebar = document.createElement('div');
    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callThrough();

    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar:not(.cockpit-box-sidebar)').and.returnValue(sidebar);
    await renderComponent();

    const observer = MockMutationObserver.instances[0];

    setTimeoutSpy.calls.reset();
    observer.trigger([{ type: 'attributes', attributeName: 'style' } as MutationRecord]);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('should skip observer setup when sidebar is not found', async () => {
    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar:not(.cockpit-box-sidebar)').and.returnValue(null);

    await renderComponent();

    expect(MockMutationObserver.instances.length).toBe(0);
  });

  it('should clean up observer, timeout and app on destroy', async () => {
    const sidebar = document.createElement('div');
    const clearTimeoutSpy = spyOn(window, 'clearTimeout');
    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callFake((() => {
      return 55 as unknown as number;
    }) as any);

    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar:not(.cockpit-box-sidebar)').and.returnValue(sidebar);

    await renderComponent();

    expect(appInitSpy).toHaveBeenCalled();

    expect(MockMutationObserver.instances.length).toBe(1);
    expect(MockResizeObserver.instances.length).toBe(1);

    const observer = MockMutationObserver.instances[0];
    const resizeObserver = MockResizeObserver.instances[0];

    observer.trigger([{ type: 'attributes', attributeName: 'class' } as MutationRecord]);

    expect(setTimeoutSpy).toHaveBeenCalled();

    fixture.destroy();

    expect(observer.disconnect).toHaveBeenCalled();
    expect(resizeObserver.disconnect).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(55);
    expect(createdApps.length).toBeGreaterThan(0);
    expect(createdApps[0].destroy).toHaveBeenCalled();
    expect(streamWorkerServiceMock.resetRequestDetails).toHaveBeenCalledTimes(1);
    expect(zoomPanServiceMock.dispose).toHaveBeenCalledTimes(1);
    expect(streamWorkerServiceMock.closeStream).toHaveBeenCalledTimes(1);
  });

  it('should initialize zoom pan with host dimensions and sync world bounds', async () => {
    await renderComponent();

    expect(zoomPanServiceMock.init).toHaveBeenCalledTimes(1);
    const [hostElement, worldWidth, worldHeight] = zoomPanServiceMock.init.calls.mostRecent().args as [
      HTMLElement,
      number,
      number,
    ];

    expect(hostElement.classList.contains('pixi-canvas-host')).toBeTrue();
    expect(worldWidth).toBe(800);
    expect(worldHeight).toBe(600);
    expect(zoomPanServiceMock.setZoom).toHaveBeenCalledOnceWith(1);
    expect(zoomPanServiceMock.setWorldBounds).toHaveBeenCalled();

    const [minX, minY, maxX, maxY] = zoomPanServiceMock.setWorldBounds.calls.mostRecent().args as [
      number,
      number,
      number,
      number,
    ];

    expect(minX).toBeLessThanOrEqual(0);
    expect(minY).toBeLessThanOrEqual(0);
    expect(maxX).toBeGreaterThanOrEqual(800);
    expect(maxY).toBeGreaterThanOrEqual(600);
  });

  it('should resync world bounds when a destination node is added', async () => {
    await renderComponent();
    zoomPanServiceMock.setWorldBounds.calls.reset();

    mockStream$.next({ id: 1, destination: 'bol.com' });

    expect(zoomPanServiceMock.setWorldBounds).toHaveBeenCalledTimes(1);
  });

  it('should sync zoom pan resize before world bounds during sidebar resize cycle', async () => {
    const sidebar = document.createElement('div');
    const callOrder: string[] = [];

    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar:not(.cockpit-box-sidebar)').and.returnValue(sidebar);
    zoomPanServiceMock.resize.and.callFake(() => {
      callOrder.push('resize');
    });
    zoomPanServiceMock.setWorldBounds.and.callFake(() => {
      callOrder.push('bounds');
    });

    spyOn(window, 'setTimeout').and.callFake(((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
      if (typeof handler === 'function') {
        handler(...args);
      }

      return 55 as unknown as number;
    }) as any);

    await renderComponent();
    zoomPanServiceMock.resize.calls.reset();
    zoomPanServiceMock.setWorldBounds.calls.reset();
    callOrder.length = 0;

    const observer = MockMutationObserver.instances[0];

    observer.trigger([{ type: 'attributes', attributeName: 'class' } as MutationRecord]);

    expect(callOrder).toEqual(['resize', 'bounds', 'resize', 'bounds']);
  });

  it('should add a Neqto center node to the stage', async () => {
    await renderComponent();

    const neqtoLabelCalls = containerAddChildSpy.calls
      .allArgs()
      .filter(([child]) => (child as { text?: string }).text === 'Neqto');

    expect(neqtoLabelCalls.length).toBe(1);
  });

  it('should keep stream subscriptions alive for future animations', async () => {
    await renderComponent();

    mockStream$.next({ id: 1 });
    mockStreamErrors$.next(new Error('Mock stream unavailable'));

    expect(historyGatewayMock.openLiveStream).toHaveBeenCalledTimes(1);
  });

  it('should add one destination node when a new destination event arrives', async () => {
    await renderComponent();

    mockStream$.next({ id: 1, destination: 'bol.com' });

    const destinationLabelCalls = containerAddChildSpy.calls
      .allArgs()
      .filter(([child]) => (child as { text?: string }).text === 'bol.com');

    expect(destinationLabelCalls.length).toBe(1);
  });

  it('should draw a connection line when a new destination node is added', async () => {
    await renderComponent();

    const addChildCallCountBeforeEvent = containerAddChildSpy.calls.count();

    mockStream$.next({ id: 1, destination: 'bol.com' });

    const addChildCallCountAfterEvent = containerAddChildSpy.calls.count();

    // A new destination adds three stage objects: line, box and label.
    expect(addChildCallCountAfterEvent - addChildCallCountBeforeEvent).toBe(3);
  });

  it('should start request animation on hinted ttfb when destination is known', async () => {
    await renderComponent();

    mockStream$.next({ id: 10, destination: 'trello.com' });

    const addChildCallCountBeforeHint = containerAddChildSpy.calls.count();

    mockStream$.next({ id: 10, 'ttfb-hint': 106 });
    // The ticker must run once to create the sprite and call addChild.
    tickerCallback();

    const addChildCallCountAfterHint = containerAddChildSpy.calls.count();

    // Hint starts a single moving sprite for this request.
    expect(addChildCallCountAfterHint - addChildCallCountBeforeHint).toBe(1);
  });

  it('should start live request animations at the center when stream timestamps are stale', async () => {
    const selectedDate = new Date();
    const liveTs = Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate(), 1);

    spyOn(Date, 'now').and.returnValue(liveTs);

    await renderComponent();

    mockStream$.next({
      id: 12,
      destination: 'trello.com',
      ts: (liveTs - 30 * 60_000) / 1_000,
      ttfb_hint: 2_000,
    });

    containerAddChildSpy.calls.reset();
    tickerCallback();

    const addedRequestSprites = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Sprite | Graphics => child instanceof Sprite || child instanceof Graphics);

    expect(addedRequestSprites.length).toBe(1);
    expect(addedRequestSprites[0].x).toBeCloseTo(400, 5);
    expect(addedRequestSprites[0].y).toBeCloseTo(300, 5);
  });

  it('should size a new request sprite from response size', async () => {
    await renderComponent();

    mockStream$.next({ id: 20, destination: 'trello.com' });
    mockStream$.next({ id: 20, payload_size: 9999, response_size: 90000, 'ttfb-hint': 120 });

    containerAddChildSpy.calls.reset();
    // Ticker creates the sprite on the first render frame.
    tickerCallback();

    const addedSprites = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Sprite => child instanceof Sprite);

    expect(addedSprites.length).toBe(1);

    const expectedDiameter = resolveExpectedSpriteRadius(90000) * 2;

    expect(addedSprites[0].width).toBeCloseTo(expectedDiameter, 5);
  });

  it('should redraw existing request sprite when response size arrives later', async () => {
    await renderComponent();

    mockStream$.next({ id: 21, destination: 'trello.com' });
    // No response_size yet — sprite is created at the default radius.
    mockStream$.next({ id: 21, payload_size: 9999, 'ttfb-hint': 120 });

    containerAddChildSpy.calls.reset();
    // Ticker creates the initial sprite.
    tickerCallback();

    const addedSprites = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Sprite => child instanceof Sprite);

    expect(addedSprites.length).toBe(1);

    const sprite = addedSprites[0];
    const initialExpectedDiameter = resolveExpectedSpriteRadius(undefined) * 2;

    expect(sprite.width).toBeCloseTo(initialExpectedDiameter, 5);

    // Response size arrives — sprite visuals should update in place.
    mockStream$.next({ id: 21, response_size: 90000 });

    const updatedExpectedDiameter = resolveExpectedSpriteRadius(90000) * 2;

    expect(sprite.width).toBeCloseTo(updatedExpectedDiameter, 5);
  });

  it('should use 4xx/5xx texture when response_code is in error range', async () => {
    await renderComponent();

    mockStream$.next({ id: 61, destination: 'trello.com', response_code: 500 });
    mockStream$.next({ id: 61, 'ttfb-hint': 120 });

    containerAddChildSpy.calls.reset();
    tickerCallback();

    const addedSprites = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Sprite => child instanceof Sprite);

    expect(addedSprites.length).toBe(1);
    expect(addedSprites[0].texture).toBe(textureByAssetPath['assets/images/tex4-5xx.png']);
  });

  it('should switch to selected texture variant for the active response-code bucket', async () => {
    await renderComponent();

    mockStream$.next({ id: 62, destination: 'trello.com', response_code: 200 });
    mockStream$.next({ id: 62, 'ttfb-hint': 120 });

    containerAddChildSpy.calls.reset();
    tickerCallback();

    const addedSprites = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Sprite => child instanceof Sprite);
    const sprite = addedSprites[0];

    expect(sprite).toBeDefined();
    expect(sprite.texture).toBe(textureByAssetPath['assets/images/tex2xx.png']);

    selectedRequestId$.next('62');

    expect(sprite.texture).toBe(textureByAssetPath['assets/images/tex2xxhl.png']);
  });

  it('should forward request id when request sprite is clicked', async () => {
    const spriteOnSpy = spyOn(Sprite.prototype, 'on').and.callThrough();

    await renderComponent();

    mockStream$.next({ id: 31, destination: 'trello.com' });
    mockStream$.next({ id: 31, 'ttfb-hint': 10000 });
    // Ticker creates the request sprite and registers its pointertap handler.
    tickerCallback();

    const pointerTapHandlers = spriteOnSpy.calls
      .allArgs()
      .filter(([eventName]) => eventName === 'pointertap')
      .map(([, handler]) => handler as () => void);

    expect(pointerTapHandlers.length).toBeGreaterThan(0);

    for (const pointerTapHandler of pointerTapHandlers) {
      pointerTapHandler();
    }

    expect(streamWorkerServiceMock.selectRequest).toHaveBeenCalledWith('31');
  });

  it('should disable request sprite hit testing while zoom pan is changing', async () => {
    let runIdleHandler = (): void => {};

    await renderComponent();

    mockStream$.next({ id: 32, destination: 'trello.com' });
    mockStream$.next({ id: 32, 'ttfb-hint': 10000 });
    tickerCallback();

    const addedSprites = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Sprite => child instanceof Sprite);
    const sprite = addedSprites[0];

    expect(sprite.eventMode).toBe('static');

    spyOn(window, 'setTimeout').and.callFake(((handler: TimerHandler) => {
      if (typeof handler === 'function') {
        runIdleHandler = () => {
          (handler as () => void)();
        };
      }

      return 77 as unknown as number;
    }) as typeof window.setTimeout);

    zoomPanState$.next({ zoomLevel: 2, panX: 10, panY: 0 });

    expect(sprite.eventMode).toBe('none');
    runIdleHandler();

    expect(sprite.eventMode).toBe('static');
  });

  it('should keep destination node hit testing enabled while zoom pan is changing', async () => {
    let runIdleHandler = (): void => {};

    await renderComponent();

    mockStream$.next({ id: 51, destination: 'booking.com' });
    tickerCallback();

    const addedGraphics = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Graphics => child instanceof Graphics && child !== (component as any)['#neqtoLogo']);
    // Get the last Graphics object added, which should be the destination node box
    // (connection line is added first, then node box)
    const destinationNodeBox = addedGraphics[addedGraphics.length - 1];

    expect(destinationNodeBox?.eventMode).toBe('static');

    spyOn(window, 'setTimeout').and.callFake(((handler: TimerHandler) => {
      if (typeof handler === 'function') {
        runIdleHandler = () => {
          (handler as () => void)();
        };
      }

      return 77 as unknown as number;
    }) as typeof window.setTimeout);

    zoomPanState$.next({ zoomLevel: 2, panX: 10, panY: 0 });

    expect(destinationNodeBox?.eventMode).toBe('none');
    runIdleHandler();

    expect(destinationNodeBox?.eventMode).toBe('static');
  });

  it('should disable request sprite hit testing in critical mode', async () => {
    const performanceBudgetService = TestBed.inject(PerformanceBudgetService);

    await renderComponent();

    mockStream$.next({ id: 52, destination: 'amazon.com' });
    mockStream$.next({ id: 52, 'ttfb-hint': 10000 });
    tickerCallback();

    const addedSprites = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Sprite => child instanceof Sprite);
    const sprite = addedSprites[0];

    expect(sprite.eventMode).toBe('static');

    // Transition to critical mode
    (performanceBudgetService.budgetConfig as any).set({
      tickRateMs: 4_000,
      hitTestingEnabled: false,
      deferHintEvents: true,
    });
    fixture.detectChanges();

    expect(sprite.eventMode).toBe('none');

    // Transition back to optimal mode
    (performanceBudgetService.budgetConfig as any).set({
      tickRateMs: 1_000,
      hitTestingEnabled: true,
      deferHintEvents: false,
    });
    fixture.detectChanges();

    expect(sprite.eventMode).toBe('static');
  });

  it('should keep destination node hit testing enabled in critical mode', async () => {
    const performanceBudgetService = TestBed.inject(PerformanceBudgetService);

    await renderComponent();

    mockStream$.next({ id: 53, destination: 'ebay.com' });
    tickerCallback();

    const addedGraphics = containerAddChildSpy.calls
      .allArgs()
      .map(([child]) => child)
      .filter((child): child is Graphics => child instanceof Graphics && child !== (component as any)['#neqtoLogo']);
    // Get the last Graphics object added, which should be the destination node box
    const destinationNodeBox = addedGraphics[addedGraphics.length - 1];

    expect(destinationNodeBox?.eventMode).toBe('static');

    // Transition to critical mode
    (performanceBudgetService.budgetConfig as any).set({
      tickRateMs: 4_000,
      hitTestingEnabled: false,
      deferHintEvents: true,
    });
    fixture.detectChanges();

    // Destination node should still have hit testing enabled in critical mode
    expect(destinationNodeBox?.eventMode).toBe('static');

    // Transition back to optimal mode
    (performanceBudgetService.budgetConfig as any).set({
      tickRateMs: 1_000,
      hitTestingEnabled: true,
      deferHintEvents: false,
    });
    fixture.detectChanges();

    expect(destinationNodeBox?.eventMode).toBe('static');
  });

  it('should emit destinationSelected when destination node is clicked', async () => {
    const spriteOnSpy = spyOn(Graphics.prototype, 'on').and.callThrough();
    const destinationSelectedSpy = spyOn(component.destinationSelected, 'emit');

    await renderComponent();

    mockStream$.next({ id: 41, destination: 'bol.com' });

    const pointerTapHandlers = spriteOnSpy.calls
      .allArgs()
      .filter(([eventName]) => eventName === 'pointertap')
      .map(([, handler]) => handler as () => void);

    expect(pointerTapHandlers.length).toBeGreaterThan(0);

    pointerTapHandlers[0]();
    fixture.detectChanges();

    expect(destinationSelectedSpy).toHaveBeenCalledWith('bol.com');
  });

  it('should reuse hinted animation when final ttfb arrives for same request', async () => {
    await renderComponent();

    mockStream$.next({ id: 11, destination: 'trello.com' });
    mockStream$.next({ id: 11, 'ttfb-hint': 106 });

    const addChildCallCountBeforeFinal = containerAddChildSpy.calls.count();

    mockStream$.next({ id: 11, ttfb: 140 });

    const addChildCallCountAfterFinal = containerAddChildSpy.calls.count();

    // Final retimes the existing sprite instead of creating a second one.
    expect(addChildCallCountAfterFinal - addChildCallCountBeforeFinal).toBe(0);
  });

  it('should ignore duplicate destination events', async () => {
    await renderComponent();

    mockStream$.next({ id: 1, destination: 'bol.com' });
    mockStream$.next({ id: 2, destination: 'bol.com' });

    const destinationLabelCalls = containerAddChildSpy.calls
      .allArgs()
      .filter(([child]) => (child as { text?: string }).text === 'bol.com');

    expect(destinationLabelCalls.length).toBe(1);
  });

  it('should retain destination nodes when the date changes', async () => {
    await renderComponent();

    // Ingest events to create some destination nodes
    mockStream$.next({ id: 1, destination: 'destination-1' });
    mockStream$.next({ id: 2, destination: 'destination-2' });

    // Filter addChild calls for BitmapText objects with our labels
    const getDestinationLabelCount = () =>
      containerAddChildSpy.calls.allArgs().filter(([child]) => {
        const c = child;

        return c && typeof c.text === 'string' && c.text.startsWith('destination-');
      }).length;

    expect(getDestinationLabelCount()).toBe(2);

    // Trigger date change via coordinator
    TestBed.inject(CockpitTimelineCoordinatorService).openDate(new Date('2026-06-11'));
    fixture.detectChanges();

    // Verify destination nodes are still there (addChild wasn't called again, and they weren't destroyed)
    expect(getDestinationLabelCount()).toBe(2);
  });
});
