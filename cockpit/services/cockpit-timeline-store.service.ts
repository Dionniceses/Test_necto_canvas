// Stores and manages reactive state for the cockpit timeline, including playhead positions and downloaded ranges.
import { Injectable, computed, signal } from '@angular/core';
import { CockpitMockStreamEvent, CockpitStreamEventSource } from '../interfaces/cockpit-stream.interface';
import {
  CockpitPendingSnapshot,
  CockpitRangeMeta,
  CockpitSnapshotDirection,
  CockpitTimelineMode,
  CockpitTimelineRange,
} from '../interfaces/cockpit-timeline.interface';

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_PIN_TOLERANCE_MS = 1_000;
const LIVE_EVENT_TIMESTAMP_DRIFT_MS = 15 * 60_000;

@Injectable({
  providedIn: 'root',
})
export class CockpitTimelineStore {
  readonly #selectedDate = signal<Date>(new Date());
  readonly #availableRange = signal<CockpitTimelineRange | null>(null);
  readonly #downloadedRanges = signal<CockpitTimelineRange[]>([]);
  readonly #pendingSnapshots = signal<CockpitPendingSnapshot[]>([]);
  readonly #playheadTs = signal(Date.now());
  readonly #liveTs = signal(Date.now());
  readonly #mode = signal<CockpitTimelineMode>('live');
  #lastAdvanceWallTs: number | null = null;

  readonly selectedDate = this.#selectedDate.asReadonly();
  readonly isToday = computed(() => this.dateKey(this.#selectedDate()) === this.dateKey(new Date(Date.now())));
  readonly availableRange = this.#availableRange.asReadonly();
  readonly downloadedRanges = this.#downloadedRanges.asReadonly();
  readonly pendingSnapshots = this.#pendingSnapshots.asReadonly();
  readonly playheadTs = this.#playheadTs.asReadonly();
  readonly liveTs = this.#liveTs.asReadonly();
  readonly mode = this.#mode.asReadonly();
  readonly isPaused = computed(() => this.#mode() === 'paused');
  readonly isLive = computed(() => this.#mode() === 'live');
  readonly bufferedEventCount = computed(() => this.#pendingSnapshots().length);

  initializeForDate(date: Date, nowTs = Date.now()): void {
    const selectedDate = new Date(date);
    const availableRange = this.#resolveDefaultRangeForDate(selectedDate, nowTs);

    const now = new Date(nowTs);
    const relativeLiveDate = new Date(selectedDate);

    relativeLiveDate.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
    const liveTs = this.#clampToRange(relativeLiveDate.getTime(), availableRange);

    this.#selectedDate.set(selectedDate);
    this.#availableRange.set(availableRange);
    this.#downloadedRanges.set([]);
    this.#pendingSnapshots.set([]);
    this.#liveTs.set(liveTs);
    this.#playheadTs.set(liveTs);

    const isToday = this.dateKey(selectedDate) === this.dateKey(new Date(nowTs));

    this.#mode.set(isToday ? 'live' : 'replay');
    this.#lastAdvanceWallTs = nowTs;
  }

  applyRangeMeta(meta: CockpitRangeMeta): void {
    const availableRange = this.#normalizeRange(meta.availableRange);
    const liveTs = this.#clampToRange(meta.serverNowTs, availableRange);

    this.#availableRange.set(availableRange);
    this.#liveTs.set(liveTs);

    if (this.#mode() === 'live') {
      this.#playheadTs.set(liveTs);
    }
  }

  advanceLiveClock(nowTs = Date.now(), historicalMultiplier = 1): void {
    const deltaMs = this.#resolveAdvanceDelta(nowTs);
    const availableRange = this.#availableRange();

    if (!availableRange) {
      this.#setLiveTs(nowTs);

      return;
    }

    this.#extendAvailableRangeTo(nowTs);
    this.#setLiveTs(this.#clampToRange(nowTs, this.#availableRange() ?? availableRange));

    if (this.#mode() !== 'replay' || deltaMs <= 0) {
      return;
    }

    const replayDeltaMs = deltaMs * this.#normalizeHistoricalMultiplier(historicalMultiplier);

    this.#playheadTs.set(this.#clampToAvailableRange(this.#playheadTs() + replayDeltaMs));
  }

  ingestEvent(event: CockpitMockStreamEvent, source: CockpitStreamEventSource): number {
    const eventTs =
      source === 'live'
        ? this.#resolveLiveEventTimestampMs(event, this.#liveTs())
        : this.resolveEventTimestampMs(event, this.#liveTs());

    if (source === 'live') {
      this.#extendAvailableRangeTo(eventTs);
      this.#setLiveTs(Math.max(this.#liveTs(), eventTs));
    }

    return eventTs;
  }

  togglePause(): void {
    if (this.#mode() === 'paused') {
      const nextMode = this.#isPinnedToLive(this.#playheadTs()) ? 'live' : 'replay';

      this.#mode.set(nextMode);

      if (nextMode === 'live') {
        this.#playheadTs.set(this.#liveTs());
      }

      return;
    }

    if (this.#mode() !== 'scrubbing') {
      this.#mode.set('paused');
    }
  }

  goLive(): void {
    this.#mode.set('live');
    this.#playheadTs.set(this.#liveTs());
  }

  startScrub(): void {
    this.#mode.set('scrubbing');
  }

  scrubTo(playheadTs: number): void {
    this.#playheadTs.set(this.#clampToAvailableRange(playheadTs));
  }

  endScrub(playheadTs: number): void {
    const nextPlayheadTs = this.#clampToAvailableRange(playheadTs);

    this.#playheadTs.set(nextPlayheadTs);

    if (this.#isPinnedToLive(nextPlayheadTs)) {
      this.#mode.set('live');
      this.#playheadTs.set(this.#liveTs());

      return;
    }

    this.#mode.set('replay');
  }

  startSnapshot(snapshot: Omit<CockpitPendingSnapshot, 'requestedAtTs'>): boolean {
    if (this.#pendingSnapshots().some((pendingSnapshot) => pendingSnapshot.key === snapshot.key)) {
      return false;
    }

    this.#pendingSnapshots.update((pendingSnapshots) => [
      ...pendingSnapshots,
      {
        ...snapshot,
        requestedAtTs: Date.now(),
      },
    ]);

    return true;
  }

  completeSnapshot(snapshotKey: string, range: CockpitTimelineRange): void {
    this.#pendingSnapshots.update((pendingSnapshots) =>
      pendingSnapshots.filter((pendingSnapshot) => pendingSnapshot.key !== snapshotKey),
    );
    this.#addDownloadedRange(range);
  }

  failSnapshot(snapshotKey: string): void {
    this.#pendingSnapshots.update((pendingSnapshots) =>
      pendingSnapshots.filter((pendingSnapshot) => pendingSnapshot.key !== snapshotKey),
    );
  }

  pruneHistory(keepRange: CockpitTimelineRange): void {
    this.#downloadedRanges.update((ranges) => {
      const pruned = ranges
        .map((r) => {
          const fromTs = Math.max(r.fromTs, keepRange.fromTs);
          const toTs = Math.min(r.toTs, keepRange.toTs);

          if (toTs <= fromTs) {
            return null;
          }

          return { fromTs, toTs };
        })
        .filter((r): r is CockpitTimelineRange => r !== null);

      if (
        pruned.length === ranges.length &&
        pruned.every((r, i) => r.fromTs === ranges[i].fromTs && r.toTs === ranges[i].toTs)
      ) {
        return ranges;
      }

      return pruned;
    });
  }

  clearDownloadedRanges(): void {
    this.#downloadedRanges.set([]);
  }

  isRangeDownloaded(fromTs: number, toTs: number): boolean {
    const requestedRange = this.#normalizeRange({ fromTs, toTs });

    return this.#downloadedRanges().some(
      (downloadedRange) =>
        downloadedRange.fromTs <= requestedRange.fromTs && downloadedRange.toTs >= requestedRange.toTs,
    );
  }

  isTimestampDownloaded(timestampMs: number): boolean {
    return this.#downloadedRanges().some(
      (downloadedRange) => downloadedRange.fromTs <= timestampMs && downloadedRange.toTs >= timestampMs,
    );
  }

  buildSnapshotKey(direction: CockpitSnapshotDirection, fromTs: number, toTs: number, limit: number): string {
    return [this.dateKey(), direction, Math.round(fromTs), Math.round(toTs), limit].join(':');
  }

  dateKey(date = this.#selectedDate()): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  dayRange(date = this.#selectedDate()): CockpitTimelineRange {
    const fromTs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

    return { fromTs, toTs: fromTs + DAY_MS - 1 };
  }

  resolveEventTimestampMs(event: CockpitMockStreamEvent, fallbackTs = Date.now()): number {
    if (typeof event.ts !== 'number' || !Number.isFinite(event.ts)) {
      return fallbackTs;
    }

    return event.ts > 1_000_000_000_000 ? event.ts : event.ts * 1_000;
  }

  #resolveLiveEventTimestampMs(event: CockpitMockStreamEvent, fallbackTs: number): number {
    const eventTs = this.resolveEventTimestampMs(event, fallbackTs);
    const selectedDayRange = this.dayRange();
    const isInsideSelectedDay = eventTs >= selectedDayRange.fromTs && eventTs <= selectedDayRange.toTs;
    const isNearLiveClock = Math.abs(eventTs - fallbackTs) <= LIVE_EVENT_TIMESTAMP_DRIFT_MS;

    return isInsideSelectedDay && isNearLiveClock ? eventTs : fallbackTs;
  }

  #setLiveTs(liveTs: number): void {
    this.#liveTs.set(liveTs);

    if (this.#mode() === 'live') {
      this.#playheadTs.set(liveTs);
    }
  }

  #resolveAdvanceDelta(nowTs: number): number {
    const previousAdvanceTs = this.#lastAdvanceWallTs;

    this.#lastAdvanceWallTs = nowTs;

    return previousAdvanceTs === null ? 0 : Math.max(0, nowTs - previousAdvanceTs);
  }

  #normalizeHistoricalMultiplier(multiplier: number): number {
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  #isPinnedToLive(playheadTs: number): boolean {
    return Math.abs(this.#liveTs() - playheadTs) <= LIVE_PIN_TOLERANCE_MS;
  }

  #addDownloadedRange(range: CockpitTimelineRange): void {
    const normalizedRange = this.#normalizeRange(range);

    if (this.#downloadedRanges().some((downloadedRange) => this.#containsRange(downloadedRange, normalizedRange))) {
      return;
    }

    this.#downloadedRanges.update((downloadedRanges) =>
      this.#mergeRangeIntoSortedRanges(downloadedRanges, normalizedRange),
    );
  }

  #containsRange(container: CockpitTimelineRange, range: CockpitTimelineRange): boolean {
    return container.fromTs <= range.fromTs && container.toTs >= range.toTs;
  }

  #mergeRangeIntoSortedRanges(
    downloadedRanges: CockpitTimelineRange[],
    range: CockpitTimelineRange,
  ): CockpitTimelineRange[] {
    const nextRanges: CockpitTimelineRange[] = [];
    let rangeToInsert = { ...range };
    let didInsert = false;

    for (const downloadedRange of downloadedRanges) {
      if (downloadedRange.toTs + 1 < rangeToInsert.fromTs) {
        nextRanges.push(downloadedRange);

        continue;
      }

      if (rangeToInsert.toTs + 1 < downloadedRange.fromTs) {
        if (!didInsert) {
          nextRanges.push(rangeToInsert);
          didInsert = true;
        }

        nextRanges.push(downloadedRange);

        continue;
      }

      rangeToInsert = {
        fromTs: Math.min(rangeToInsert.fromTs, downloadedRange.fromTs),
        toTs: Math.max(rangeToInsert.toTs, downloadedRange.toTs),
      };
    }

    if (!didInsert) {
      nextRanges.push(rangeToInsert);
    }

    return nextRanges;
  }

  #extendAvailableRangeTo(timestampMs: number): void {
    const availableRange = this.#availableRange();

    if (!availableRange) {
      return;
    }

    const selectedDayRange = this.dayRange();

    if (timestampMs < selectedDayRange.fromTs || timestampMs > selectedDayRange.toTs) {
      return;
    }

    const nextRange = {
      fromTs: Math.min(availableRange.fromTs, timestampMs),
      toTs: Math.max(availableRange.toTs, timestampMs),
    };

    if (nextRange.fromTs === availableRange.fromTs && nextRange.toTs === availableRange.toTs) {
      return;
    }

    this.#availableRange.set(nextRange);
  }

  #resolveDefaultRangeForDate(date: Date, nowTs: number): CockpitTimelineRange {
    const dayRange = this.dayRange(date);
    const todayRange = this.dayRange(new Date(nowTs));
    const isToday = dayRange.fromTs === todayRange.fromTs;

    return {
      fromTs: dayRange.fromTs,
      toTs: isToday ? this.#clampToRange(nowTs, dayRange) : dayRange.toTs,
    };
  }

  #clampToAvailableRange(timestampMs: number): number {
    const availableRange = this.#availableRange();

    if (!availableRange) {
      return timestampMs;
    }

    return this.#clampToRange(timestampMs, availableRange);
  }

  #clampToRange(timestampMs: number, range: CockpitTimelineRange): number {
    return Math.min(range.toTs, Math.max(range.fromTs, timestampMs));
  }

  #normalizeRange(range: CockpitTimelineRange): CockpitTimelineRange {
    return range.fromTs <= range.toTs
      ? { fromTs: range.fromTs, toTs: range.toTs }
      : { fromTs: range.toTs, toTs: range.fromTs };
  }
}
