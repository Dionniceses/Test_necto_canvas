// Monitors rendering framerates and dynamically throttles canvas updates to ensure stable application performance.
import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { AdvancedSettingsService } from './advanced-settings.service';

export type BudgetState = 'optimal' | 'degraded' | 'critical';

export interface BudgetConfig {
  tickRateMs: number;
  hitTestingEnabled: boolean;
  deferHintEvents: boolean;
}

const VISIBILITY_RECOVERY_MS = 3_000;

@Injectable({
  providedIn: 'root',
})
export class PerformanceBudgetService {
  // Drop thresholds (fps falls below → transition down)
  readonly #degradedDropFps = 45; // optimal → degraded
  readonly #criticalDropFps = 25; // degraded → critical

  // Recovery thresholds (fps rises to or above → transition up)
  readonly #degradedRecoverFps = 35; // critical → degraded
  readonly #optimalRecoverFps = 55; // degraded → optimal

  // Minimum time to hold a downgraded state before allowing upward recovery
  readonly #degradedHoldMs = 15_000;
  readonly #criticalHoldMs = 30_000;

  #advancedSetting = inject(AdvancedSettingsService);

  readonly #configs: Record<BudgetState, BudgetConfig> = {
    optimal: {
      tickRateMs: 1000,
      hitTestingEnabled: true,
      deferHintEvents: false,
    },
    degraded: {
      tickRateMs: 2000,
      hitTestingEnabled: true,
      deferHintEvents: false,
    },
    critical: {
      tickRateMs: 4000,
      hitTestingEnabled: false,
      deferHintEvents: true,
    },
  };

  readonly #ngZone = inject(NgZone);
  readonly #destroyRef = inject(DestroyRef);

  readonly budgetState = signal<BudgetState>('optimal');
  readonly budgetConfig = computed(() => this.#configs[this.budgetState()]);
  readonly averageFps = signal<number>(0);
  readonly isTimelineScrollDisabled = computed(() => this.budgetState() === 'critical');

  #frameCount = 0;
  #windowStartMs = 0;
  #rafId: number | null = null;
  #currentState: BudgetState = 'optimal';
  #stateEnteredAtMs = 0;
  #ignoreFpsUntilMs = 0;
  #isVisibilitySuppressed = false;
  #didIgnoreFpsSample = false;

  readonly #visibilityChangeHandler = (): void => {
    this.#handleVisibilityChange();
  };

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }

    this.#ngZone.runOutsideAngular(() => {
      this.#windowStartMs = performance.now();
      document.addEventListener('visibilitychange', this.#visibilityChangeHandler);
      this.#schedule();
    });

    this.#destroyRef.onDestroy(() => {
      this.#cancelScheduled();
      document.removeEventListener('visibilitychange', this.#visibilityChangeHandler);
    });
  }

  #schedule(): void {
    this.#rafId = requestAnimationFrame(this.#onFrame);
  }

  readonly #onFrame = (timestampMs: number): void => {
    if (this.#shouldIgnoreFpsSample(timestampMs)) {
      this.#resetMeasurementWindow(timestampMs);
      this.#didIgnoreFpsSample = true;
      this.#schedule();

      return;
    }

    if (this.#didIgnoreFpsSample) {
      this.#resetMeasurementWindow(timestampMs);
      this.#didIgnoreFpsSample = false;
      this.#schedule();

      return;
    }

    this.#frameCount++;

    const elapsedMs = timestampMs - this.#windowStartMs;

    if (elapsedMs >= 1000) {
      const fps = (this.#frameCount * 1000) / elapsedMs;

      this.#frameCount = 0;
      this.#windowStartMs = timestampMs;
      this.#evaluateBudget(fps);
    }

    this.#schedule();
  };

  #handleVisibilityChange(): void {
    const nowMs = performance.now();

    this.#resetMeasurementWindow(nowMs);
    this.#isVisibilitySuppressed = this.#isDocumentHidden();
    this.#ignoreFpsUntilMs = this.#isVisibilitySuppressed ? Number.POSITIVE_INFINITY : nowMs + VISIBILITY_RECOVERY_MS;
  }

  #shouldIgnoreFpsSample(timestampMs: number): boolean {
    return this.#isVisibilitySuppressed || timestampMs < this.#ignoreFpsUntilMs;
  }

  #resetMeasurementWindow(timestampMs: number): void {
    this.#frameCount = 0;
    this.#windowStartMs = timestampMs;
  }

  #isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  #evaluateBudget(fps: number): void {
    const nextState = this.#resolveNextState(fps);

    if (nextState !== this.#currentState) {
      this.#currentState = nextState;
      this.#stateEnteredAtMs = this.#windowStartMs;
      this.budgetState.set(nextState);
    }

    this.averageFps.set(Math.round(fps));
  }

  #resolveNextState(fps: number): BudgetState {
    if (this.#advancedSetting.performance() === undefined) {
      switch (this.#currentState) {
        case 'optimal':
          return fps < this.#degradedDropFps ? 'degraded' : 'optimal';
        case 'degraded': {
          if (fps < this.#criticalDropFps) return 'critical';
          const heldMs = this.#windowStartMs - this.#stateEnteredAtMs;

          if (fps >= this.#optimalRecoverFps && heldMs >= this.#degradedHoldMs) return 'optimal';

          return 'degraded';
        }
        case 'critical': {
          const heldMs = this.#windowStartMs - this.#stateEnteredAtMs;

          if (fps >= this.#degradedRecoverFps && heldMs >= this.#criticalHoldMs) return 'degraded';

          return 'critical';
        }
        default:
          return this.#currentState;
      }
    } else if (this.#advancedSetting.performance() === true) {
      return 'critical';
    } else {
      return 'optimal';
    }
  }

  #cancelScheduled(): void {
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }
}
