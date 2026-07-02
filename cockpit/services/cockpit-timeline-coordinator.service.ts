// Coordinates timeline actions, seeking, real-time playback, and historical snapshot request throttling.
import { DestroyRef, Injectable, effect, inject, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription } from 'rxjs';
import { CockpitHistoryGateway } from '../interfaces/cockpit-history-gateway.interface';
import { CockpitMockStreamEvent, CockpitStreamEventSource } from '../interfaces/cockpit-stream.interface';
import {
  CockpitCachedSnapshotEvent,
  CockpitSnapshotDirection,
  CockpitTimelineCursor,
  CockpitTimelineVisualEvent,
} from '../interfaces/cockpit-timeline.interface';
import { COCKPIT_HISTORY_GATEWAY } from './cockpit-history-gateway.token';
import { CockpitTimelineStore } from './cockpit-timeline-store.service';
import { StreamWorkerService } from './stream-worker.service';
import { TimeMultiplierService } from './time-multiplier.service';
import { PerformanceBudgetService } from './performance-budget.service';
import { AdvancedSettingsService } from './advanced-settings.service';

const BUFFER_THRESHOLD_MS = 30_000;
const BUFFER_WINDOW_MS = 120_000;
const PERFORMANCE_RECOVERY_DELAY_MS = 5000; // Wait 5 seconds after snapshot loads before checking if we should prune
const SNAPSHOT_COOLDOWN_MS = 5_000;

@Injectable({
  providedIn: 'root',
})
export class CockpitTimelineCoordinatorService {
  readonly #destroyRef = inject(DestroyRef);
  readonly #historyGateway: CockpitHistoryGateway = inject(COCKPIT_HISTORY_GATEWAY);
  readonly #timelineStore = inject(CockpitTimelineStore);
  readonly #streamWorkerService = inject(StreamWorkerService);
  readonly #timeMultiplierService = inject(TimeMultiplierService);
  readonly #performanceBudgetService = inject(PerformanceBudgetService);
  readonly #advancedSetting = inject(AdvancedSettingsService);

  readonly #visualEventSubject = new Subject<CockpitTimelineVisualEvent>();
  readonly visualEvents$ = this.#visualEventSubject.asObservable();

  readonly isPaused = this.#timelineStore.isPaused;
  readonly isLive = this.#timelineStore.isLive;
  readonly isConnected = this.#streamWorkerService.isLiveStreamActive;
  readonly bufferedEventCount = this.#timelineStore.bufferedEventCount;
  readonly availableRange = this.#timelineStore.availableRange;
  readonly downloadedRanges = this.#timelineStore.downloadedRanges;
  readonly playheadTs = this.#timelineStore.playheadTs;
  readonly liveTs = this.#timelineStore.liveTs;
  readonly selectedDate = this.#timelineStore.selectedDate;
  readonly optimalSnapshotLimit = computed(() => this.#advancedSetting.controlsnapshotsize());
  readonly degradedSnapshotLimit = computed(() => this.#advancedSetting.controlsnapshotsize() / 2);

  readonly #sessionResetSubject = new Subject<void>();
  readonly sessionReset$ = this.#sessionResetSubject.asObservable();

  #streamSubscription: Subscription | null = null;
  #rangeMetaSubscription: Subscription | null = null;
  #cachedSnapshotEventsByRequestId = new Map<string, CockpitCachedSnapshotEvent>();
  #completedSnapshotIds = new Set<string>();
  #emittedSnapshotRequestIds = new Set<string>();
  #lastHistoricalPlaybackTs: number | null = null;
  #sortedSnapshotEvents: CockpitCachedSnapshotEvent[] = [];
  #playbackPointer = 0;
  #snapshotEventSequence = 0;
  #performanceRecoveryTimeoutId: any = null;
  #lastSnapshotRequestTimeMs = 0;

  constructor() {
    this.#setupPerformanceWatch();
    this.#streamWorkerService.registerLocalDetailsProvider?.((requestId) => {
      return this.#cachedSnapshotEventsByRequestId.get(requestId)?.event ?? null;
    });
  }

  openDate(date: Date): void {
    this.#resetSnapshotPlaybackCache();
    this.#timelineStore.initializeForDate(date, Date.now());
    this.#connectToStream(date);
    this.#loadRangeMeta(date);

    this.#streamWorkerService.resetSession(this.#timelineStore.playheadTs(), this.#timelineStore.isLive());
    this.#sessionResetSubject.next();
  }

  close(): void {
    this.#streamSubscription?.unsubscribe();
    this.#streamSubscription = null;
    this.#rangeMetaSubscription?.unsubscribe();
    this.#rangeMetaSubscription = null;
    this.#streamWorkerService.closeStream();
    this.#resetSnapshotPlaybackCache();
    if (this.#performanceRecoveryTimeoutId) {
      clearTimeout(this.#performanceRecoveryTimeoutId);
    }
  }

  togglePause(): void {
    this.#timelineStore.togglePause();
  }

  goLive(): void {
    const today = new Date(Date.now());

    if (!this.#timelineStore.isToday()) {
      // Switching to a different date — full reset required.
      this.#timeMultiplierService.reset();
      this.openDate(today);

      return;
    }

    this.#timeMultiplierService.reset();

    if (this.#shouldOpenLiveStream()) {
      // Reconnect the stream without wiping already-downloaded history.
      this.#connectToStream(today);
      this.#loadRangeMeta(today);
    }

    this.#timelineStore.goLive();
    this.#lastHistoricalPlaybackTs = null;

    this.#streamWorkerService.resetSession(this.#timelineStore.playheadTs(), true);
    this.#sessionResetSubject.next();
  }

  #shouldOpenLiveStream(): boolean {
    return (
      !this.#streamSubscription || this.#streamSubscription.closed || !this.#streamWorkerService.isLiveStreamActive()
    );
  }

  startScrub(): void {
    this.#timelineStore.startScrub();
  }

  scrubTo(playheadTs: number): void {
    this.#timelineStore.scrubTo(playheadTs);
    this.#streamWorkerService.syncPlayheadTime(playheadTs, this.#timelineStore.isLive());
  }

  endScrub(playheadTs: number): void {
    this.#timelineStore.endScrub(playheadTs);

    this.#streamWorkerService.resetSession(playheadTs, this.#timelineStore.isLive());
    this.#sessionResetSubject.next();

    if (this.#timelineStore.isLive()) {
      this.#lastHistoricalPlaybackTs = null;

      // The stream may have ended while scrubbing; reconnect if needed.
      if (this.#shouldOpenLiveStream()) {
        const today = new Date(Date.now());

        this.#connectToStream(today);
        this.#loadRangeMeta(today);
      }

      return;
    }

    this.#resetHistoricalPlaybackCursor(this.#timelineStore.playheadTs());
    this.#requestSnapshotAroundPlayhead(playheadTs);
    this.#emitDueSnapshotEvents();
  }

  advanceLiveClock(nowTs = Date.now()): void {
    if (this.#timelineStore.pendingSnapshots().length > 0) {
      return;
    }

    const previousTs = this.#timelineStore.playheadTs();

    this.#timelineStore.advanceLiveClock(nowTs, this.#timeMultiplierService.multiplier());
    const currentTs = this.#timelineStore.playheadTs();

    this.#streamWorkerService.syncPlayheadTime(currentTs, this.#timelineStore.isLive());

    if (this.#timelineStore.mode() === 'replay' && !this.#timelineStore.isPaused()) {
      this.#checkBufferHealth(previousTs, currentTs);
    }

    this.#emitDueSnapshotEvents();
  }

  #checkBufferHealth(previousTs: number, currentTs: number): void {
    const now = Date.now();

    if (now - this.#lastSnapshotRequestTimeMs < SNAPSHOT_COOLDOWN_MS) {
      return;
    }

    // Avoid over-requesting if snapshots are already loading
    if (this.#timelineStore.pendingSnapshots().length > 0) {
      return;
    }

    const downloadedRanges = this.#timelineStore.downloadedRanges();

    if (downloadedRanges.length === 0) {
      this.#requestSnapshotAroundPlayhead(currentTs);

      return;
    }

    const direction = currentTs >= previousTs ? 'forward' : 'backward';
    const activeRange = downloadedRanges.find((r) => currentTs >= r.fromTs && currentTs <= r.toTs);

    if (!activeRange) {
      this.#requestSnapshotAroundPlayhead(currentTs);

      return;
    }

    if (direction === 'forward') {
      const distanceToEnd = activeRange.toTs - currentTs;

      if (distanceToEnd < BUFFER_THRESHOLD_MS) {
        this.#requestSnapshot('after', activeRange.toTs, activeRange.toTs + BUFFER_WINDOW_MS, { ts: activeRange.toTs });
      }
    } else {
      const distanceToStart = currentTs - activeRange.fromTs;

      if (distanceToStart < BUFFER_THRESHOLD_MS) {
        this.#requestSnapshot('before', activeRange.fromTs - BUFFER_WINDOW_MS, activeRange.fromTs, {
          ts: activeRange.fromTs,
        });
      }
    }
  }

  #setupPerformanceWatch(): void {
    // Clear any pending recovery timer if performance improves.
    effect(() => {
      const state = this.#performanceBudgetService.budgetState();

      if (state === 'optimal' && this.#performanceRecoveryTimeoutId) {
        clearTimeout(this.#performanceRecoveryTimeoutId);
        this.#performanceRecoveryTimeoutId = null;
      }

      if (state === 'critical' && this.#timelineStore.isLive()) {
        this.#timelineStore.clearDownloadedRanges();
      }
    });
  }

  #resetPerformanceRecoveryTimer(): void {
    // Cancel any pending timer and start a fresh one.
    if (this.#performanceRecoveryTimeoutId) {
      clearTimeout(this.#performanceRecoveryTimeoutId);
      this.#performanceRecoveryTimeoutId = null;
    }

    // Wait 5 seconds after snapshot load, then check if performance is still degraded.
    this.#performanceRecoveryTimeoutId = setTimeout(() => {
      this.#performanceRecoveryTimeoutId = null;

      if (this.#performanceBudgetService.budgetState() === 'degraded') {
        this.#pruneHistoryForPerformance();
      }
    }, PERFORMANCE_RECOVERY_DELAY_MS);
  }

  #pruneHistoryForPerformance(): void {
    const playheadTs = this.#timelineStore.playheadTs();
    // Keep 10 minutes around playhead (5 mins each way)
    // This must be larger than BUFFER_WINDOW_MS to avoid flickering
    const keepWindowMs = 10 * 60_000;
    const keepRange = {
      fromTs: playheadTs - keepWindowMs / 2,
      toTs: playheadTs + keepWindowMs / 2,
    };

    // 1. Prune local cache
    for (const [requestId, cachedEvent] of this.#cachedSnapshotEventsByRequestId.entries()) {
      if (cachedEvent.eventTs < keepRange.fromTs || cachedEvent.eventTs > keepRange.toTs) {
        this.#cachedSnapshotEventsByRequestId.delete(requestId);
        this.#emittedSnapshotRequestIds.delete(requestId);
      }
    }

    this.#rebuildSortedEvents();

    // 2. Prune store metadata
    this.#timelineStore.pruneHistory(keepRange);
  }

  #connectToStream(date: Date): void {
    this.#streamSubscription?.unsubscribe();
    this.#streamSubscription = this.#historyGateway
      .openLiveStream(date)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((streamedEvent) => {
        this.#processStreamEvent(streamedEvent.event, streamedEvent.source, streamedEvent.snapshotId);
      });
  }

  #loadRangeMeta(date: Date): void {
    this.#rangeMetaSubscription?.unsubscribe();
    this.#rangeMetaSubscription = this.#historyGateway
      .getRangeMeta(date)
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((meta) => {
        this.#timelineStore.applyRangeMeta(meta);
        this.#requestInitialSnapshot();
      });
  }

  #processStreamEvent(event: CockpitMockStreamEvent, source: CockpitStreamEventSource, snapshotId?: string): void {
    const eventTs = this.#timelineStore.ingestEvent(event, source);

    if (source === 'snapshot') {
      this.#cacheSnapshotEvent(event, eventTs, snapshotId ?? 'snapshot');

      return;
    }

    if (source === 'live' && !this.#timelineStore.isLive()) {
      return;
    }

    const animationTs = this.#resolveLiveAnimationTs();

    this.#visualEventSubject.next({
      event,
      source,
      eventTs,
      animationEvent: { ...event, ts: animationTs },
      animationTs,
      visualDurationMultiplier: 1,
    });
  }

  #resolveLiveAnimationTs(): number {
    return this.#timelineStore.liveTs();
  }

  #requestInitialSnapshot(): void {
    if (this.#timelineStore.isToday()) {
      return;
    }

    this.#requestSnapshotAroundPlayhead(this.#timelineStore.playheadTs());
  }

  #requestSnapshotAroundPlayhead(playheadTs: number): void {
    const availableRange = this.#timelineStore.availableRange();

    if (!availableRange) {
      return;
    }

    const fromTs = playheadTs;

    if (this.#timelineStore.isRangeDownloaded(fromTs, availableRange.toTs)) {
      return;
    }

    this.#requestSnapshot('after', fromTs, availableRange.toTs, { ts: fromTs });
  }

  #requestSnapshot(
    direction: CockpitSnapshotDirection,
    fromTs: number,
    toTs: number,
    cursor?: CockpitTimelineCursor,
  ): void {
    const limit =
      this.#performanceBudgetService.budgetState() === 'optimal'
        ? this.optimalSnapshotLimit()
        : this.degradedSnapshotLimit();

    const snapshotKey = this.#timelineStore.buildSnapshotKey(direction, fromTs, toTs, limit);
    const didStartSnapshot = this.#timelineStore.startSnapshot({
      key: snapshotKey,
      direction,
      fromTs,
      toTs,
      limit,
      cursor,
    });

    if (!didStartSnapshot) {
      return;
    }

    this.#lastSnapshotRequestTimeMs = Date.now();

    const snapshot$ =
      direction === 'before' && cursor
        ? this.#historyGateway.loadBefore(cursor, limit)
        : direction === 'after' && cursor
          ? this.#historyGateway.loadAfter(cursor, limit)
          : this.#historyGateway.loadRange(fromTs, toTs, limit);

    snapshot$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe({
      next: (result) => {
        if (result.error) {
          this.#removeCachedSnapshotEvents(result.snapshotId);
          this.#timelineStore.failSnapshot(snapshotKey);

          return;
        }

        this.#completedSnapshotIds.add(result.snapshotId);
        this.#timelineStore.completeSnapshot(snapshotKey, result.range);
        this.#rebuildSortedEvents();
        this.#resetPerformanceRecoveryTimer();
        this.#emitDueSnapshotEvents();

        // Auto-resume playback if paused and we just loaded snapshot data
        if (this.#timelineStore.isPaused() && this.#cachedSnapshotEventsByRequestId.size > 0) {
          this.#timelineStore.togglePause();
        }
      },
      error: () => this.#timelineStore.failSnapshot(snapshotKey),
    });
  }

  #removeCachedSnapshotEvents(snapshotId: string): void {
    for (const [requestId, cachedEvent] of this.#cachedSnapshotEventsByRequestId.entries()) {
      if (cachedEvent.snapshotId === snapshotId) {
        this.#cachedSnapshotEventsByRequestId.delete(requestId);
        this.#emittedSnapshotRequestIds.delete(requestId);
      }
    }

    this.#completedSnapshotIds.delete(snapshotId);
    this.#rebuildSortedEvents();
  }

  #cacheSnapshotEvent(event: CockpitMockStreamEvent, eventTs: number, snapshotId: string): void {
    const requestId = String(event.id).trim();

    if (!requestId) {
      return;
    }

    const existingEvent = this.#cachedSnapshotEventsByRequestId.get(requestId);

    this.#cachedSnapshotEventsByRequestId.set(requestId, {
      requestId,
      snapshotId,
      event: { ...event, id: requestId },
      eventTs,
      sequence: existingEvent?.sequence ?? this.#snapshotEventSequence++,
    });
  }

  #resetHistoricalPlaybackCursor(playheadTs: number): void {
    this.#lastHistoricalPlaybackTs = playheadTs;
    this.#emittedSnapshotRequestIds.clear();
    this.#resetPlaybackPointer();
  }

  #rebuildSortedEvents(): void {
    this.#sortedSnapshotEvents = [...this.#cachedSnapshotEventsByRequestId.values()].sort(
      (left, right) => left.eventTs - right.eventTs || left.sequence - right.sequence,
    );
    this.#resetPlaybackPointer();
  }

  #resetPlaybackPointer(): void {
    const playheadTs = this.#timelineStore.playheadTs();
    let low = 0;
    let high = this.#sortedSnapshotEvents.length - 1;
    let result = this.#sortedSnapshotEvents.length;

    while (low <= high) {
      const mid = (low + high) >> 1;

      if (this.#sortedSnapshotEvents[mid].eventTs >= playheadTs) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    this.#playbackPointer = result;
  }

  #emitDueSnapshotEvents(): void {
    if (this.#timelineStore.mode() !== 'replay') {
      return;
    }

    const currentPlayheadTs = this.#timelineStore.playheadTs();

    while (
      this.#playbackPointer < this.#sortedSnapshotEvents.length &&
      this.#sortedSnapshotEvents[this.#playbackPointer].eventTs <= currentPlayheadTs
    ) {
      const snapshotEvent = this.#sortedSnapshotEvents[this.#playbackPointer];

      if (
        this.#completedSnapshotIds.has(snapshotEvent.snapshotId) &&
        !this.#emittedSnapshotRequestIds.has(snapshotEvent.requestId)
      ) {
        this.#emittedSnapshotRequestIds.add(snapshotEvent.requestId);
        this.#streamWorkerService.ingestSnapshotEvent(snapshotEvent.event);
        this.#visualEventSubject.next({
          event: snapshotEvent.event,
          source: 'snapshot',
          eventTs: snapshotEvent.eventTs,
          animationEvent: snapshotEvent.event,
          animationTs: snapshotEvent.eventTs,
          visualDurationMultiplier: 1,
        });
      }

      this.#playbackPointer++;
    }

    this.#lastHistoricalPlaybackTs = currentPlayheadTs;
  }

  #resetSnapshotPlaybackCache(): void {
    this.#cachedSnapshotEventsByRequestId.clear();
    this.#sortedSnapshotEvents = [];
    this.#playbackPointer = 0;
    this.#completedSnapshotIds.clear();
    this.#emittedSnapshotRequestIds.clear();
    this.#lastHistoricalPlaybackTs = null;
    this.#snapshotEventSequence = 0;
  }
}
