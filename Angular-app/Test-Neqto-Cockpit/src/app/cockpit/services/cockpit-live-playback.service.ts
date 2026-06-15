import { computed, Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class CockpitLivePlaybackService {
  #isPaused = signal(false);
  #timelineClockMs = signal(0);
  #bufferedEventCount = signal(0);
  #lastFrameWallClockMs: number | null = null;

  readonly isPaused = this.#isPaused.asReadonly();
  readonly isLive = computed(() => !this.#isPaused());
  readonly bufferedEventCount = this.#bufferedEventCount.asReadonly();
  readonly timelineClockMs = this.#timelineClockMs.asReadonly();

  initializeTimeline(nowMs: number): void {
    this.#syncTimelineTo(nowMs);
  }

  reset(): void {
    this.#isPaused.set(false);
    this.#timelineClockMs.set(0);
    this.#lastFrameWallClockMs = null;
  }

  togglePause(nowMs: number): void {
    this.#isPaused.update((isPaused) => !isPaused);

    if (!this.#isPaused()) {
      // Resume from the current live point instead of replaying missed events.
      this.#syncTimelineTo(nowMs);
    }
  }

  goLive(nowMs: number): void {
    this.#isPaused.set(false);
    this.#syncTimelineTo(nowMs);
  }

  advanceTimelineClock(nowMs: number): void {
    if (this.#lastFrameWallClockMs === null) {
      this.#syncTimelineTo(nowMs);

      return;
    }

    const deltaMs = Math.max(0, nowMs - this.#lastFrameWallClockMs);

    this.#lastFrameWallClockMs = nowMs;

    if (!this.#isPaused()) {
      this.#timelineClockMs.update((timelineClockMs) => timelineClockMs + deltaMs);
    }
  }

  #syncTimelineTo(nowMs: number): void {
    this.#timelineClockMs.set(nowMs);
    this.#lastFrameWallClockMs = nowMs;
  }
}
