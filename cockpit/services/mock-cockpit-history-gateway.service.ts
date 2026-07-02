// Acts as the integration gateway to query snapshots and open live event streams from the mock backend.
import { Injectable, inject } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { CockpitHistoryGateway } from '../interfaces/cockpit-history-gateway.interface';
import { COCKPIT_MOCK_STREAM_PATH, CockpitStreamedEvent } from '../interfaces/cockpit-stream.interface';
import {
  CockpitRangeMeta,
  CockpitSnapshotResult,
  CockpitTimelineCursor,
  CockpitTimelineRange,
} from '../interfaces/cockpit-timeline.interface';
import { StreamWorkerService } from './stream-worker.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MOCK_WINDOW_MS = 30 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class MockCockpitHistoryGateway implements CockpitHistoryGateway {
  readonly #streamWorkerService = inject(StreamWorkerService);
  readonly #mockStreamPath = COCKPIT_MOCK_STREAM_PATH;
  readonly #localMockServerOrigin = 'http://localhost:8788';

  #activeDate = new Date();
  #snapshotCounter = 0;
  #lastAlertTime = 0;
  readonly #ALERT_COOLDOWN_MS = 5000;

  openLiveStream(date: Date): Observable<CockpitStreamedEvent> {
    this.#activeDate = new Date(date);
    this.#streamWorkerService.openNdjsonStream(this.#resolveMockStreamUrl());

    return this.#streamWorkerService.eventEnvelopes$;
  }

  getRangeMeta(date: Date): Observable<CockpitRangeMeta> {
    this.#activeDate = new Date(date);

    const dayRange = this.#dayRange(date);
    const serverNowTs = this.#clamp(Date.now(), dayRange);
    const meta: CockpitRangeMeta = {
      dateKey: this.#dateKey(date),
      serverNowTs,
      availableRange: {
        fromTs: dayRange.fromTs,
        toTs: this.#isToday(date) ? serverNowTs : dayRange.toTs,
      },
      downloadedRanges: [],
    };

    this.#streamWorkerService.publishRangeMeta(meta);

    return of(meta);
  }

  loadBefore(cursor: CockpitTimelineCursor, limit: number): Observable<CockpitSnapshotResult> {
    const dayRange = this.#dayRange(this.#activeDate);
    const toTs = this.#clamp(cursor.ts, dayRange);
    const fromTs = Math.max(dayRange.fromTs, toTs - this.#resolveCursorWindowMs(limit));

    return this.#startSnapshot('before', { fromTs, toTs }, limit);
  }

  loadAfter(cursor: CockpitTimelineCursor, limit: number): Observable<CockpitSnapshotResult> {
    const dayRange = this.#dayRange(this.#activeDate);
    const fromTs = this.#clamp(cursor.ts, dayRange);
    const toTs = Math.min(dayRange.toTs, fromTs + this.#resolveCursorWindowMs(limit));

    return this.#startSnapshot('after', { fromTs, toTs }, limit);
  }

  loadRange(fromTs: number, toTs: number, limit: number): Observable<CockpitSnapshotResult> {
    const dayRange = this.#dayRange(this.#activeDate);
    const range = {
      fromTs: this.#clamp(Math.min(fromTs, toTs), dayRange),
      toTs: this.#clamp(Math.max(fromTs, toTs), dayRange),
    };

    return this.#startSnapshot('range', range, limit);
  }

  #startSnapshot(
    direction: 'before' | 'after' | 'range',
    range: CockpitTimelineRange,
    limit: number,
  ): Observable<CockpitSnapshotResult> {
    const snapshotId = [
      this.#dateKey(this.#activeDate),
      direction,
      Math.round(range.fromTs),
      Math.round(range.toTs),
      this.#snapshotCounter++,
    ].join(':');

    // Fetch snapshot data from mock server
    const snapshotUrl = new URL(`${this.#localMockServerOrigin}/mock/cockpit/snapshot`);

    snapshotUrl.searchParams.set('from', String(Math.round(range.fromTs)));
    snapshotUrl.searchParams.set('limit', String(limit));
    snapshotUrl.searchParams.set('snapshotId', snapshotId);

    console.log(`[Cockpit] Fetching snapshot: ${snapshotUrl.toString()}`);

    return this.#streamWorkerService
      .startSnapshot({
        type: 'start-snapshot',
        snapshotId,
        url: snapshotUrl.toString(),
        range,
        limit,
        cursorBefore: undefined,
        cursorAfter: undefined,
      })
      .pipe(
        tap((result) => {
          if (result.error) {
            console.error(`[Cockpit] Snapshot request failed`);
            const now = Date.now();

            if (now - this.#lastAlertTime >= this.#ALERT_COOLDOWN_MS) {
              this.#lastAlertTime = now;
              alert('No connection was established, so no historical playback is possible');
            }
          }
        }),
      );
  }

  #resolveCursorWindowMs(limit: number): number {
    return Math.max(MOCK_WINDOW_MS, Math.min(4 * MOCK_WINDOW_MS, limit * 2_000));
  }

  #resolveMockStreamUrl(): string {
    if (typeof window === 'undefined') {
      return this.#mockStreamPath;
    }

    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';

    return isLocalHost ? `${this.#localMockServerOrigin}${this.#mockStreamPath}` : this.#mockStreamPath;
  }

  #dateKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  #dayRange(date: Date): CockpitTimelineRange {
    const fromTs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

    return { fromTs, toTs: fromTs + DAY_MS - 1 };
  }

  #isToday(date: Date): boolean {
    return this.#dayRange(date).fromTs === this.#dayRange(new Date()).fromTs;
  }

  #clamp(timestampMs: number, range: CockpitTimelineRange): number {
    return Math.min(range.toTs, Math.max(range.fromTs, timestampMs));
  }
}
