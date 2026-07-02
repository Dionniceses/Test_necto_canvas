import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PerformanceBudgetService } from './performance-budget.service';
import { AdvancedSettingsService } from './advanced-settings.service';

describe('PerformanceBudgetService', () => {
  let service: PerformanceBudgetService;
  let rafCallbacks: FrameRequestCallback[];
  let rafIdCounter: number;
  let currentTimeMs: number;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 0;
    currentTimeMs = 0;

    spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);

      return ++rafIdCounter;
    });
    spyOn(window, 'cancelAnimationFrame').and.stub();
    spyOn(performance, 'now').and.returnValue(0);

    const mockAdvancedSettings = {
      performance: jasmine.createSpy('performance').and.returnValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: AdvancedSettingsService, useValue: mockAdvancedSettings }],
    });
    service = TestBed.inject(PerformanceBudgetService);
  });

  /**
   * Simulate `targetFps` frames evenly spaced across a 1000 ms window.
   * The last frame always lands at exactly `currentTimeMs + 1000` to avoid
   * floating-point drift on the elapsed check. Advances `currentTimeMs` by 1000.
   */
  function simulateFps(targetFps: number): void {
    const startMs = currentTimeMs;

    for (let i = 0; i < targetFps; i++) {
      const cb = rafCallbacks.shift();
      const isLastFrame = i === targetFps - 1;

      currentTimeMs = isLastFrame ? startMs + 1000 : startMs + (i + 1) * (1000 / targetFps);
      cb(currentTimeMs);
    }
  }

  function simulateFpsSequence(fpsList: number[]): void {
    for (const fps of fpsList) {
      simulateFps(fps);
    }
  }

  /**
   * Hold a steady fps for `seconds` 1-second windows, to allow the
   * service's downgrade-hold timers to elapse before testing recovery.
   */
  function holdFps(fps: number, seconds: number): void {
    for (let i = 0; i < seconds; i++) {
      simulateFps(fps);
    }
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start in optimal state', () => {
    expect(service.budgetState()).toBe('optimal');
  });

  it('should start with averageFps of 0', () => {
    expect(service.averageFps()).toBe(0);
  });

  it('should register a requestAnimationFrame on creation', () => {
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('should not update state or fps before 1000 ms has elapsed', () => {
    const cb = rafCallbacks.shift();

    cb(500);

    expect(service.budgetState()).toBe('optimal');
    expect(service.averageFps()).toBe(0);
  });

  describe('from optimal state', () => {
    it('should remain optimal at exactly 45 fps', () => {
      simulateFps(45);

      expect(service.budgetState()).toBe('optimal');
    });

    it('should remain optimal above 45 fps', () => {
      simulateFps(60);

      expect(service.budgetState()).toBe('optimal');
    });

    it('should drop to degraded below 45 fps', () => {
      simulateFps(44);

      expect(service.budgetState()).toBe('degraded');
    });
  });

  describe('from degraded state', () => {
    beforeEach(() => {
      simulateFps(44); // optimal → degraded
    });

    it('should remain degraded between 25 and 54 fps', () => {
      simulateFps(40);

      expect(service.budgetState()).toBe('degraded');
    });

    it('should remain degraded at exactly 25 fps', () => {
      simulateFps(25);

      expect(service.budgetState()).toBe('degraded');
    });

    it('should remain degraded at exactly 54 fps', () => {
      simulateFps(54);

      expect(service.budgetState()).toBe('degraded');
    });

    it('should drop to critical below 25 fps', () => {
      simulateFps(24);

      expect(service.budgetState()).toBe('critical');
    });

    it('should recover to optimal at exactly 55 fps after the degraded hold elapses', () => {
      holdFps(40, 15); // hold degraded for 15s
      simulateFps(55);

      expect(service.budgetState()).toBe('optimal');
    });

    it('should recover to optimal above 55 fps after the degraded hold elapses', () => {
      holdFps(40, 15);
      simulateFps(60);

      expect(service.budgetState()).toBe('optimal');
    });

    it('should not recover to optimal at 55 fps before the degraded hold elapses', () => {
      simulateFps(55);

      expect(service.budgetState()).toBe('degraded');
    });
  });

  describe('from critical state', () => {
    beforeEach(() => {
      simulateFpsSequence([44, 24]); // optimal → degraded → critical
    });

    it('should remain critical below 35 fps', () => {
      simulateFps(34);

      expect(service.budgetState()).toBe('critical');
    });

    it('should recover to degraded at exactly 35 fps after the critical hold elapses', () => {
      holdFps(20, 30); // hold critical for 30s
      simulateFps(35);

      expect(service.budgetState()).toBe('degraded');
    });

    it('should recover to degraded above 35 fps after the critical hold elapses', () => {
      holdFps(20, 30);
      simulateFps(40);

      expect(service.budgetState()).toBe('degraded');
    });

    it('should not recover to degraded at 40 fps before the critical hold elapses', () => {
      simulateFps(40);

      expect(service.budgetState()).toBe('critical');
    });
  });

  it('should update averageFps after a 1-second measurement window', () => {
    simulateFps(60);

    expect(service.averageFps()).toBe(60);
  });

  it('should report the most recent fps window', () => {
    simulateFpsSequence([60, 30]);

    expect(service.averageFps()).toBe(30);
  });

  it('should update budget configuration when in optimal state', () => {
    expect(service.budgetState()).toBe('optimal');
    expect(service.budgetConfig()).toEqual({
      tickRateMs: 1_000,
      hitTestingEnabled: true,
      deferHintEvents: false,
    });
  });

  it('should update budget configuration when in degraded state', () => {
    simulateFps(44); // optimal → degraded

    expect(service.budgetState()).toBe('degraded');
    expect(service.budgetConfig()).toEqual({
      tickRateMs: 2_000,
      hitTestingEnabled: true,
      deferHintEvents: false,
    });
  });

  it('should update budget configuration when in critical state', () => {
    simulateFpsSequence([44, 24]); // optimal → degraded → critical

    expect(service.budgetState()).toBe('critical');
    expect(service.budgetConfig()).toEqual({
      tickRateMs: 4_000,
      hitTestingEnabled: false,
      deferHintEvents: true,
    });
  });

  it('should ignore fps samples for three seconds after becoming visible', () => {
    let visibilityState: DocumentVisibilityState = 'visible';

    spyOnProperty(document, 'visibilityState', 'get').and.callFake(() => visibilityState);

    currentTimeMs = 5_000;
    (performance.now as jasmine.Spy).and.returnValue(currentTimeMs);
    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));

    simulateFpsSequence([10, 10, 10]);

    expect(service.budgetState()).toBe('optimal');
    expect(service.averageFps()).toBe(0);

    simulateFps(10);

    expect(service.budgetState()).toBe('degraded');
  });

  it('should cancel the pending requestAnimationFrame on destroy', () => {
    TestBed.inject(EnvironmentInjector).destroy();

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});
