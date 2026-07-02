// Controls the time multiplier / playback speed divider for historical timeline replay.
import { Injectable, computed, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class TimeMultiplierService {
  readonly defaultMultiplier = 1;
  readonly minMultiplier = 1;
  readonly maxMultiplier = 40;
  readonly step = 1;

  readonly #divider = signal(this.defaultMultiplier);

  readonly divider = this.#divider.asReadonly();
  readonly multiplier = computed(() => 1 / this.#divider());
  readonly multiplierLabel = computed(() => `1/${this.#divider()}`);

  setMultiplier(multiplier: number): void {
    this.#divider.set(this.#normalizeDivider(multiplier));
  }

  reset(): void {
    this.#divider.set(this.defaultMultiplier);
  }

  #normalizeDivider(divider: number): number {
    if (!Number.isFinite(divider)) {
      return this.defaultMultiplier;
    }

    const clampedDivider = Math.min(this.maxMultiplier, Math.max(this.minMultiplier, divider));
    const steppedDivider = Math.round(clampedDivider / this.step) * this.step;

    return Number(steppedDivider.toFixed(2));
  }
}
