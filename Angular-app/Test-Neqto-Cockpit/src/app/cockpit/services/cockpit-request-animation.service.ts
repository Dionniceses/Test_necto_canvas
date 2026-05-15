import { Injectable } from '@angular/core';
import {
  CockpitAnimationEndpoints,
  CockpitAnimationFrame,
  CockpitAnimationTickResult,
  CockpitRequestAnimation,
  CockpitRequestAnimationContext,
} from '../interfaces/cockpit-request-animation.interface';
import { CockpitMockStreamEvent } from '../interfaces/cockpit-stream.interface';

@Injectable({
  providedIn: 'root',
})
export class CockpitRequestAnimationService {
  readonly #hintHoldProgress = 0.96;
  readonly #minimumAnimationDurationMs = 80;
  readonly #maximumAnimationDurationMs = 90000;

  readonly #requestContexts = new Map<string, CockpitRequestAnimationContext>();
  readonly #activeRequestAnimations = new Map<string, CockpitRequestAnimation>();

  reset(): void {
    this.#requestContexts.clear();
    this.#activeRequestAnimations.clear();
  }

  ingestEvent(event: CockpitMockStreamEvent, nowMs: number): void {
    const requestId = String(event.id);
    const requestContext = this.#requestContexts.get(requestId) ?? {
      startedAtMs: nowMs,
    };

    const destination = typeof event.destination === 'string' ? event.destination.trim() : '';

    if (destination) {
      requestContext.destinationKey = destination.toLowerCase();
    }

    this.#requestContexts.set(requestId, requestContext);

    const hintedTtfbMs = this.#resolveHintTtfbMs(event);

    if (hintedTtfbMs !== null) {
      this.#upsertRequestAnimation(requestId, requestContext, hintedTtfbMs, false, nowMs);
    }

    const finalTtfbMs = this.#resolveFinalTtfbMs(event);

    if (finalTtfbMs !== null) {
      this.#upsertRequestAnimation(requestId, requestContext, finalTtfbMs, true, nowMs);
    }
  }

  render(
    nowMs: number,
    resolveEndpoints: (destinationKey: string) => CockpitAnimationEndpoints | null,
  ): CockpitAnimationTickResult {
    if (this.#activeRequestAnimations.size === 0) {
      return {
        frames: [],
        completedRequestIds: [],
      };
    }

    const frames: CockpitAnimationFrame[] = [];
    const completedRequestIds: string[] = [];

    for (const animation of this.#activeRequestAnimations.values()) {
      const endpoints = resolveEndpoints(animation.destinationKey);

      if (!endpoints) {
        continue;
      }

      const isCompleted = this.#advanceAnimation(animation, nowMs);

      frames.push({
        requestId: animation.requestId,
        destinationKey: animation.destinationKey,
        x: endpoints.sourceX + (endpoints.targetX - endpoints.sourceX) * animation.currentProgress,
        y: endpoints.sourceY + (endpoints.targetY - endpoints.sourceY) * animation.currentProgress,
      });

      if (isCompleted) {
        completedRequestIds.push(animation.requestId);
      }
    }

    for (const requestId of completedRequestIds) {
      this.#activeRequestAnimations.delete(requestId);
      this.#requestContexts.delete(requestId);
    }

    return {
      frames,
      completedRequestIds,
    };
  }

  #upsertRequestAnimation(
    requestId: string,
    requestContext: CockpitRequestAnimationContext,
    durationMs: number,
    hasFinalTtfb: boolean,
    nowMs: number,
  ): void {
    const destinationKey = requestContext.destinationKey;

    if (!destinationKey) {
      return;
    }

    const normalizedDurationMs = this.#normalizeAnimationDuration(durationMs);
    const existingAnimation = this.#activeRequestAnimations.get(requestId);

    if (existingAnimation) {
      this.#retimeRequestAnimation(existingAnimation, normalizedDurationMs, hasFinalTtfb, nowMs);

      return;
    }

    this.#activeRequestAnimations.set(requestId, {
      requestId,
      destinationKey,
      originTimestampMs: requestContext.startedAtMs,
      durationMs: normalizedDurationMs,
      hasFinalTtfb,
      currentProgress: 0,
    });
  }

  #retimeRequestAnimation(
    animation: CockpitRequestAnimation,
    durationMs: number,
    hasFinalTtfb: boolean,
    nowMs: number,
  ): void {
    animation.durationMs = durationMs;
    animation.originTimestampMs = nowMs - animation.currentProgress * durationMs;

    if (hasFinalTtfb) {
      animation.hasFinalTtfb = true;
    }
  }

  #advanceAnimation(animation: CockpitRequestAnimation, nowMs: number): boolean {
    const elapsedMs = Math.max(0, nowMs - animation.originTimestampMs);
    const rawProgress = elapsedMs / animation.durationMs;
    const boundedProgress = animation.hasFinalTtfb
      ? Math.min(rawProgress, 1)
      : Math.min(rawProgress, this.#hintHoldProgress);

    animation.currentProgress = Math.max(animation.currentProgress, boundedProgress);

    return animation.hasFinalTtfb && animation.currentProgress >= 1;
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

  #normalizeAnimationDuration(durationMs: number): number {
    const roundedDurationMs = Math.round(durationMs);

    if (!Number.isFinite(roundedDurationMs)) {
      return this.#minimumAnimationDurationMs;
    }

    return Math.min(this.#maximumAnimationDurationMs, Math.max(this.#minimumAnimationDurationMs, roundedDurationMs));
  }
}
