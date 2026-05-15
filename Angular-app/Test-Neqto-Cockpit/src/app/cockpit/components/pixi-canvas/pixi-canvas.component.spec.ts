import { ApplicationRef, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { CockpitRequestDetails } from '../../interfaces/cockpit-request-details.interface';
import { CockpitMockStreamEvent } from '../../interfaces/cockpit-stream.interface';
import { ZoomPanState } from '../../interfaces/zoom-pan.interface';
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

describe('PixiCanvasComponent', () => {
  let component: PixiCanvasComponent;
  let fixture: ComponentFixture<PixiCanvasComponent>;
  let originalMutationObserver: typeof MutationObserver;
  let querySelectorSpy: jasmine.Spy;
  let appInitSpy: jasmine.Spy;
  let containerAddChildSpy: jasmine.Spy;
  let tickerCallback: () => void;
  let createdApps: Array<{ destroy: jasmine.Spy; addChild: jasmine.Spy }>;
  let mockStream$: Subject<CockpitMockStreamEvent>;
  let mockStreamErrors$: Subject<Error>;
  let selectedRequestId$: BehaviorSubject<string | null>;
  let selectedRequestDetails$: BehaviorSubject<CockpitRequestDetails | null>;
  let zoomPanState: ZoomPanState;
  let zoomPanState$: Subject<ZoomPanState>;
  let streamWorkerServiceMock: {
    openMockStream: jasmine.Spy;
    closeMockStream: jasmine.Spy;
    selectRequest: jasmine.Spy;
    getRequestDetailsById: jasmine.Spy;
    resetRequestDetails: jasmine.Spy;
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
    // In Angular 19, afterNextRender hooks only execute during ApplicationRef.tick().
    // detectChanges() alone does not trigger them.
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
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
    streamWorkerServiceMock = {
      openMockStream: jasmine.createSpy('openMockStream').and.returnValue(mockStream$.asObservable()),
      closeMockStream: jasmine.createSpy('closeMockStream'),
      selectRequest: jasmine.createSpy('selectRequest'),
      getRequestDetailsById: jasmine.createSpy('getRequestDetailsById').and.returnValue(null),
      resetRequestDetails: jasmine.createSpy('resetRequestDetails'),
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
            budgetConfig: signal({ tickRateMs: 1_000, hitTestingEnabled: true, deferHintEvents: false }),
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
    MockMutationObserver.instances = [];
    createdApps = [];
    tickerCallback = () => {};

    (window as Window & { MutationObserver: typeof MutationObserver }).MutationObserver =
      MockMutationObserver as unknown as typeof MutationObserver;
    querySelectorSpy = spyOn(document, 'querySelector').and.callThrough();
    containerAddChildSpy = spyOn(Container.prototype, 'addChild').and.callThrough();
    spyOn(Assets, 'load').and.callFake(() => Promise.resolve(Texture.WHITE));

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
    mockStream$.complete();
    mockStreamErrors$.complete();
    selectedRequestId$.complete();
    selectedRequestDetails$.complete();
    zoomPanState$.complete();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should observe sidebar class changes and schedule resize work', async () => {
    const sidebar = document.createElement('div');
    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callThrough();

    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar').and.returnValue(sidebar);
    await renderComponent();

    expect(appInitSpy).toHaveBeenCalled();
    expect(streamWorkerServiceMock.openMockStream).toHaveBeenCalledTimes(1);

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

    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar').and.returnValue(sidebar);
    await renderComponent();

    const observer = MockMutationObserver.instances[0];

    setTimeoutSpy.calls.reset();
    observer.trigger([{ type: 'attributes', attributeName: 'style' } as MutationRecord]);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('should skip observer setup when sidebar is not found', async () => {
    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar').and.returnValue(null);

    await renderComponent();

    expect(MockMutationObserver.instances.length).toBe(0);
  });

  it('should clean up observer, timeout and app on destroy', async () => {
    const sidebar = document.createElement('div');
    const clearTimeoutSpy = spyOn(window, 'clearTimeout');
    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callFake((() => {
      return 55 as unknown as number;
    }) as any);

    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar').and.returnValue(sidebar);

    await renderComponent();

    expect(appInitSpy).toHaveBeenCalled();

    expect(MockMutationObserver.instances.length).toBe(1);

    const observer = MockMutationObserver.instances[0];

    observer.trigger([{ type: 'attributes', attributeName: 'class' } as MutationRecord]);

    expect(setTimeoutSpy).toHaveBeenCalled();

    fixture.destroy();

    expect(observer.disconnect).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(55);
    expect(createdApps.length).toBeGreaterThan(0);
    expect(createdApps[0].destroy).toHaveBeenCalled();
    expect(streamWorkerServiceMock.resetRequestDetails).toHaveBeenCalledTimes(1);
    expect(zoomPanServiceMock.dispose).toHaveBeenCalledTimes(1);
    expect(streamWorkerServiceMock.closeMockStream).toHaveBeenCalledTimes(1);
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

    querySelectorSpy.withArgs('app-basic-layout .cap-sidebar').and.returnValue(sidebar);
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

    expect(streamWorkerServiceMock.openMockStream).toHaveBeenCalledTimes(1);
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

  it('should open destination sidebar when destination node is clicked', async () => {
    const spriteOnSpy = spyOn(Graphics.prototype, 'on').and.callThrough();

    await renderComponent();

    mockStream$.next({ id: 41, destination: 'bol.com' });

    const pointerTapHandlers = spriteOnSpy.calls
      .allArgs()
      .filter(([eventName]) => eventName === 'pointertap')
      .map(([, handler]) => handler as () => void);

    expect(pointerTapHandlers.length).toBeGreaterThan(0);

    pointerTapHandlers[0]();
    fixture.detectChanges();

    const sidebarElement = fixture.nativeElement.querySelector('.cockpit-box-sidebar');

    expect(sidebarElement).not.toBeNull();
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

  it('should close stream on pause and reopen it on unpause', async () => {
    await renderComponent();

    expect(streamWorkerServiceMock.openMockStream).toHaveBeenCalledTimes(1);

    component.onTogglePause();

    expect(component.isPaused()).toBeTrue();
    expect(component.isLive()).toBeFalse();
    expect(component.bufferedEventCount()).toBe(0);
    expect(streamWorkerServiceMock.closeMockStream).toHaveBeenCalledTimes(1);

    component.onTogglePause();

    expect(component.isPaused()).toBeFalse();
    expect(component.isLive()).toBeTrue();
    expect(component.bufferedEventCount()).toBe(0);
    expect(streamWorkerServiceMock.openMockStream).toHaveBeenCalledTimes(2);
  });

  it('should reopen stream when go-live is triggered while paused', async () => {
    await renderComponent();

    component.onTogglePause();

    expect(component.isPaused()).toBeTrue();

    const openMockStreamCallCountBeforeGoLive = streamWorkerServiceMock.openMockStream.calls.count();

    component.onGoLive();

    expect(component.isPaused()).toBeFalse();
    expect(component.isLive()).toBeTrue();
    expect(component.bufferedEventCount()).toBe(0);
    expect(streamWorkerServiceMock.openMockStream.calls.count()).toBe(openMockStreamCallCountBeforeGoLive + 1);
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
});
