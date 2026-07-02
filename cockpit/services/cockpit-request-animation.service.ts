// Manages and interpolates active request payload particle animations moving across destination nodes on the canvas.
import { Injectable } from '@angular/core';
import {
  CockpitAnimationEndpoints,
  CockpitAnimationFrame,
  CockpitAnimationTickResult,
  CockpitRequestAnimation,
} from '../interfaces/cockpit-request-animation.interface';
import { CockpitMockStreamEvent } from '../interfaces/cockpit-stream.interface';

@Injectable({
  providedIn: 'root',
})
export class CockpitRequestAnimationService {
  readonly #hintHoldProgress = 0.86;
  readonly #minimumAnimationDurationMs = 80;
  readonly #maximumAnimationDurationMs = 900000;
  readonly #maxFinalizedRequestIds = 10000;

  readonly #requestAnimations = new Map<string, CockpitRequestAnimation>();
  readonly #parkedHintAnimations = new Map<string, CockpitRequestAnimation>();
  readonly #visibleRequestIds = new Set<string>();
  readonly #finalizedRequestIds = new Set<string>();

  reset(): void {
    this.#requestAnimations.clear();
    this.#parkedHintAnimations.clear();
    this.#visibleRequestIds.clear();
    this.#finalizedRequestIds.clear();
  }

  ingestEvent(event: CockpitMockStreamEvent, nowMs: number, visualDurationMultiplier = 1): void {
    const requestId = String(event.id);
    const finalTtfbMs = this.#resolveFinalTtfbMs(event);

    // A request advances base -> hint -> final exactly once. The stream worker replays
    // batched events on independent timers and can deliver a stale partial event
    // (destination/hint only, no final ttfb) AFTER the final event has already been
    // processed. Letting that stale event through resurrects a hint animation that parks
    // at the hold threshold and never receives a final ttfb again, leaving the ball frozen
    // near its destination. Ignore partial events for requests that were already finalized;
    // the finalizing event always carries the destination too, so nothing is lost.
    if (finalTtfbMs === null && this.#finalizedRequestIds.has(requestId)) {
      return;
    }

    const parkedRequestAnimation = this.#parkedHintAnimations.get(requestId);
    const requestAnimation =
      this.#requestAnimations.get(requestId) ??
      parkedRequestAnimation ??
      this.#createRequestAnimation(requestId, nowMs);
    const eventTimestampMs = this.#resolveEventTimestampMs(event, nowMs);
    const normalizedVisualDurationMultiplier = this.#normalizeVisualDurationMultiplier(visualDurationMultiplier);

    const destination = typeof event.destination === 'string' ? event.destination.trim() : '';

    if (destination) {
      requestAnimation.destinationKey = destination.toLowerCase();
      requestAnimation.originTimestampMs = Math.min(requestAnimation.originTimestampMs, eventTimestampMs);
    }

    const hintedTtfbMs = this.#resolveHintTtfbMs(event);

    if (hintedTtfbMs !== null) {
      this.#setRequestAnimationDuration(requestAnimation, hintedTtfbMs, false, normalizedVisualDurationMultiplier);
    }

    if (finalTtfbMs !== null) {
      this.#markRequestFinalized(requestId);

      const hadFinalTtfbBefore = requestAnimation.hasFinalTtfb;

      this.#setRequestAnimationDuration(requestAnimation, finalTtfbMs, true, normalizedVisualDurationMultiplier);
      // When final event arrives for a parked or in-progress hint animation, rebase origin
      // so the animation continues smoothly from its current visual progress
      if (!hadFinalTtfbBefore) {
        const currentProgress = parkedRequestAnimation
          ? this.#hintHoldProgress
          : Math.min(requestAnimation.currentProgress, this.#hintHoldProgress);

        requestAnimation.originTimestampMs = nowMs - currentProgress * requestAnimation.durationMs;
      }
    }

    if (finalTtfbMs !== null || !parkedRequestAnimation) {
      this.#parkedHintAnimations.delete(requestId);
      this.#requestAnimations.set(requestId, requestAnimation);
    } else {
      this.#parkedHintAnimations.set(requestId, requestAnimation);
    }
  }

  render(
    nowMs: number,
    resolveEndpoints: (destinationKey: string) => CockpitAnimationEndpoints | null,
  ): CockpitAnimationTickResult {
    // Check every tick for parked animations stuck at 86% that now have a response.
    // Under high event load, retiming may not trigger reliably when the final event arrives,
    // so this safety net enforces the retiming in the next render cycle.
    this.#enforceParkedAnimationRetiming(nowMs);

    if (this.#requestAnimations.size === 0) {
      return {
        frames: [],
        completedRequestIds: [],
      };
    }

    const frames: CockpitAnimationFrame[] = [];
    const completedRequestIds: string[] = [];

    // Yield frames for parked animations so they follow destination nodes if they move
    for (const animation of this.#parkedHintAnimations.values()) {
      if (!animation.destinationKey) {
        continue;
      }

      const endpoints = resolveEndpoints(animation.destinationKey);

      if (endpoints) {
        const progress = this.#hintHoldProgress;

        frames.push({
          requestId: animation.requestId,
          destinationKey: animation.destinationKey,
          x: endpoints.sourceX + (endpoints.targetX - endpoints.sourceX) * progress,
          y: endpoints.sourceY + (endpoints.targetY - endpoints.sourceY) * progress,
        });
      }
    }

    for (const animation of this.#requestAnimations.values()) {
      if (!animation.destinationKey || animation.durationMs <= 0) {
        this.#markCompletedIfPreviouslyVisible(animation.requestId, completedRequestIds);

        continue;
      }

      const progress = this.#resolveAnimationProgress(animation, nowMs);

      if (progress === null) {
        this.#markCompletedIfPreviouslyVisible(animation.requestId, completedRequestIds);
        this.#requestAnimations.delete(animation.requestId);

        continue;
      }

      const endpoints = resolveEndpoints(animation.destinationKey);

      if (!endpoints) {
        this.#markCompletedIfPreviouslyVisible(animation.requestId, completedRequestIds);

        continue;
      }

      animation.currentProgress = progress;
      this.#visibleRequestIds.add(animation.requestId);
      frames.push({
        requestId: animation.requestId,
        destinationKey: animation.destinationKey,
        x: endpoints.sourceX + (endpoints.targetX - endpoints.sourceX) * progress,
        y: endpoints.sourceY + (endpoints.targetY - endpoints.sourceY) * progress,
      });

      if (this.#shouldParkHintAnimation(animation)) {
        this.#requestAnimations.delete(animation.requestId);
        this.#parkedHintAnimations.set(animation.requestId, animation);
      }
    }

    return {
      frames,
      completedRequestIds,
    };
  }

  #createRequestAnimation(requestId: string, timestampMs: number): CockpitRequestAnimation {
    return {
      requestId,
      destinationKey: '',
      originTimestampMs: timestampMs,
      durationMs: 0,
      hasFinalTtfb: false,
      currentProgress: 0,
    };
  }

  #setRequestAnimationDuration(
    animation: CockpitRequestAnimation,
    durationMs: number,
    hasFinalTtfb: boolean,
    visualDurationMultiplier: number,
  ): void {
    animation.durationMs = this.#normalizeAnimationDuration(durationMs * visualDurationMultiplier);

    if (hasFinalTtfb) {
      animation.hasFinalTtfb = true;
    }
  }

  #resolveAnimationProgress(animation: CockpitRequestAnimation, nowMs: number): number | null {
    const elapsedMs = nowMs - animation.originTimestampMs;

    if (elapsedMs < 0) {
      return null;
    }

    const rawProgress = elapsedMs / animation.durationMs;

    if (this.#hasCompletedFinalAnimation(animation, nowMs)) {
      return null;
    }

    return animation.hasFinalTtfb ? rawProgress : Math.min(rawProgress, this.#hintHoldProgress);
  }

  #shouldParkHintAnimation(animation: CockpitRequestAnimation): boolean {
    return !animation.hasFinalTtfb && animation.currentProgress >= this.#hintHoldProgress;
  }

  #hasCompletedFinalAnimation(animation: CockpitRequestAnimation, nowMs: number): boolean {
    return animation.hasFinalTtfb && nowMs - animation.originTimestampMs >= animation.durationMs;
  }

  #markCompletedIfPreviouslyVisible(requestId: string, completedRequestIds: string[]): void {
    if (!this.#visibleRequestIds.has(requestId)) {
      return;
    }

    completedRequestIds.push(requestId);
    this.#visibleRequestIds.delete(requestId);
    this.#parkedHintAnimations.delete(requestId);
  }

  #markRequestFinalized(requestId: string): void {
    if (this.#finalizedRequestIds.has(requestId)) {
      return;
    }

    this.#finalizedRequestIds.add(requestId);

    if (this.#finalizedRequestIds.size <= this.#maxFinalizedRequestIds) {
      return;
    }

    const oldestRequestId = this.#finalizedRequestIds.values().next().value;

    if (oldestRequestId !== undefined) {
      this.#finalizedRequestIds.delete(oldestRequestId);
    }
  }

  #enforceParkedAnimationRetiming(nowMs: number): void {
    const parkedRequestIdsToProcess: string[] = [];

    for (const [requestId, animation] of this.#parkedHintAnimations.entries()) {
      if (animation.hasFinalTtfb) {
        parkedRequestIdsToProcess.push(requestId);
      }
    }

    for (const requestId of parkedRequestIdsToProcess) {
      const animation = this.#parkedHintAnimations.get(requestId);

      if (!animation) {
        continue;
      }

      // Rebase origin so the animation continues smoothly from 86% progress
      animation.originTimestampMs = nowMs - this.#hintHoldProgress * animation.durationMs;

      this.#parkedHintAnimations.delete(requestId);
      this.#requestAnimations.set(requestId, animation);
    }
  }

  #resolveHintTtfbMs(event: CockpitMockStreamEvent): number | null {
    if (typeof event['ttfb-hint'] === 'number') {
      return event['ttfb-hint'];
    }

    if (typeof event.ttfb_hint === 'number') {
      return event.ttfb_hint;
    }

    return null;
  }

  #resolveFinalTtfbMs(event: CockpitMockStreamEvent): number | null {
    if (typeof event.ttfb === 'number') {
      return event.ttfb;
    }

    return null;
  }

  #resolveEventTimestampMs(event: CockpitMockStreamEvent, fallbackTs: number): number {
    if (typeof event.ts !== 'number' || !Number.isFinite(event.ts)) {
      return fallbackTs;
    }

    return event.ts > 1_000_000_000_000 ? event.ts : event.ts * 1_000;
  }

  #normalizeAnimationDuration(durationMs: number): number {
    const roundedDurationMs = Math.round(durationMs);

    if (!Number.isFinite(roundedDurationMs)) {
      return this.#minimumAnimationDurationMs;
    }

    return Math.min(this.#maximumAnimationDurationMs, Math.max(this.#minimumAnimationDurationMs, roundedDurationMs));
  }

  #normalizeVisualDurationMultiplier(multiplier: number): number {
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }
}
