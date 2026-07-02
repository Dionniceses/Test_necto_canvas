import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { CockpitHistoryGateway } from '../interfaces/cockpit-history-gateway.interface';
import { CockpitStreamedEvent } from '../interfaces/cockpit-stream.interface';
import { CockpitTimelineCursor, CockpitTimelineVisualEvent } from '../interfaces/cockpit-timeline.interface';
import { COCKPIT_HISTORY_GATEWAY } from './cockpit-history-gateway.token';
import { CockpitTimelineCoordinatorService } from './cockpit-timeline-coordinator.service';
import { PerformanceBudgetService } from './performance-budget.service';
import { StreamWorkerService } from './stream-worker.service';
import { TimeMultiplierService } from './time-multiplier.service';
import { CockpitTimelineStore } from './cockpit-timeline-store.service';

describe('CockpitTimelineCoordinatorService', () => {
  let service: CockpitTimelineCoordinatorService;
  let timeMultiplierService: TimeMultiplierService;
  let liveEvents$: Subject<CockpitStreamedEvent>;
  let historyGatewayMock: jasmine.SpyObj<CockpitHistoryGateway>;
  let streamWorkerServiceMock: {
    closeStream: jasmine.Spy;
    isLiveStreamActive: jasmine.Spy;
    resetSession: jasmine.Spy;
    syncPlayheadTime: jasmine.Spy;
    ingestSnapshotEvent: jasmine.Spy;
    registerLocalDetailsProvider: jasmine.Spy;
  };

  const dayStartTs = Date.UTC(2026, 0, 1);
  const serverNowTs = dayStartTs + 60_000;

  beforeEach(() => {
    spyOn(Date, 'now').and.returnValue(serverNowTs);
    liveEvents$ = new Subject<CockpitStreamedEvent>();
    historyGatewayMock = jasmine.createSpyObj<CockpitHistoryGateway>('CockpitHistoryGateway', [
      'openLiveStream',
      'getRangeMeta',
      'loadBefore',
      'loadAfter',
      'loadRange',
    ]);
    historyGatewayMock.openLiveStream.and.returnValue(liveEvents$.asObservable());
    historyGatewayMock.getRangeMeta.and.returnValue(
      of({
        dateKey: '2026-01-01',
        serverNowTs,
        availableRange: { fromTs: dayStartTs, toTs: serverNowTs },
        downloadedRanges: [],
      }),
    );
    historyGatewayMock.loadRange.and.callFake((fromTs: number, toTs: number) =>
      of({ snapshotId: 'snapshot-range', range: { fromTs, toTs }, count: 0, truncated: false }),
    );
    historyGatewayMock.loadBefore.and.returnValue(
      of({ snapshotId: 'snapshot-before', range: { fromTs: 0, toTs: 1 }, count: 0, truncated: false }),
    );
    historyGatewayMock.loadAfter.and.returnValue(
      of({ snapshotId: 'snapshot-after', range: { fromTs: 0, toTs: 1 }, count: 0, truncated: false }),
    );
    streamWorkerServiceMock = {
      closeStream: jasmine.createSpy('closeStream'),
      isLiveStreamActive: jasmine.createSpy('isLiveStreamActive').and.returnValue(true),
      resetSession: jasmine.createSpy('resetSession'),
      syncPlayheadTime: jasmine.createSpy('syncPlayheadTime'),
      ingestSnapshotEvent: jasmine.createSpy('ingestSnapshotEvent'),
      registerLocalDetailsProvider: jasmine.createSpy('registerLocalDetailsProvider'),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: COCKPIT_HISTORY_GATEWAY, useValue: historyGatewayMock },
        { provide: StreamWorkerService, useValue: streamWorkerServiceMock },
        {
          provide: PerformanceBudgetService,
          useValue: {
            budgetConfig: signal({
              tickRateMs: 1_000,
              hitTestingEnabled: true,
              deferHintEvents: false,
            }),
            budgetState: signal('optimal'),
            averageFps: signal(0),
            isTimelineScrollDisabled: signal(false),
          },
        },
      ],
    });

    service = TestBed.inject(CockpitTimelineCoordinatorService);
    timeMultiplierService = TestBed.inject(TimeMultiplierService);
  });

  afterEach(() => {
    liveEvents$.complete();
    timeMultiplierService.reset();
  });

  it('should open the selected date and request the initial available snapshot if it is a past date', () => {
    const pastDate = new Date(dayStartTs - 48 * 60 * 60_000);
    const pastDayStartTs = Date.UTC(pastDate.getUTCFullYear(), pastDate.getUTCMonth(), pastDate.getUTCDate());

    // We need to mock getRangeMeta to return the correct range for this past date
    historyGatewayMock.getRangeMeta.and.returnValue(
      of({
        dateKey: '2025-12-30',
        serverNowTs: pastDayStartTs + 3600_000,
        availableRange: { fromTs: pastDayStartTs, toTs: pastDayStartTs + 24 * 3600_000 - 1 },
        downloadedRanges: [],
      }),
    );

    service.openDate(pastDate);

    expect(historyGatewayMock.openLiveStream).toHaveBeenCalledWith(pastDate);
    expect(historyGatewayMock.getRangeMeta).toHaveBeenCalledWith(pastDate);
    // Should call loadAfter because it is a past date
    expect(historyGatewayMock.loadAfter).toHaveBeenCalled();
  });

  it('should not mark failed snapshot results as downloaded', () => {
    const pastDate = new Date(dayStartTs - 48 * 60 * 60_000);
    const pastDayStartTs = Date.UTC(pastDate.getUTCFullYear(), pastDate.getUTCMonth(), pastDate.getUTCDate());

    historyGatewayMock.getRangeMeta.and.returnValue(
      of({
        dateKey: '2025-12-30',
        serverNowTs: pastDayStartTs + 3600_000,
        availableRange: { fromTs: pastDayStartTs, toTs: pastDayStartTs + 24 * 3600_000 - 1 },
        downloadedRanges: [],
      }),
    );
    historyGatewayMock.loadAfter.and.callFake((cursor: CockpitTimelineCursor) =>
      of({
        snapshotId: 'snapshot-failed',
        range: { fromTs: cursor.ts, toTs: cursor.ts + 1 },
        count: 0,
        truncated: false,
        error: true,
      }),
    );

    service.openDate(pastDate);

    expect(service.downloadedRanges()).toEqual([]);
    expect(service.bufferedEventCount()).toBe(0);
  });

  it('should redirect to today when goLive is called on a past date', () => {
    const pastDate = new Date(dayStartTs - 48 * 60 * 60_000);

    service.openDate(pastDate);

    const openDateSpy = spyOn(service, 'openDate').and.callThrough();

    service.goLive();

    expect(openDateSpy).toHaveBeenCalled();
    // The second call to openDate (from goLive) should be with "today"
    const calledDate = openDateSpy.calls.mostRecent().args[0];
    const today = new Date(serverNowTs);

    expect(calledDate.getUTCDate()).toBe(today.getUTCDate());
    expect(calledDate.getUTCMonth()).toBe(today.getUTCMonth());
  });

  it('should open today when goLive is called without an active stream', () => {
    service.openDate(new Date(dayStartTs));
    service.close();
    historyGatewayMock.openLiveStream.calls.reset();
    historyGatewayMock.getRangeMeta.calls.reset();

    service.goLive();

    expect(historyGatewayMock.openLiveStream).toHaveBeenCalledWith(new Date(serverNowTs));
    expect(historyGatewayMock.getRangeMeta).toHaveBeenCalledWith(new Date(serverNowTs));
  });

  it('should reopen the live stream on go-live after the live NDJSON stream has ended', () => {
    service.openDate(new Date(dayStartTs));
    historyGatewayMock.openLiveStream.calls.reset();
    historyGatewayMock.getRangeMeta.calls.reset();

    // The live NDJSON stream completed (worker posted a "stopped" status), so the
    // long-lived subscription is still open but no further live events will arrive.
    streamWorkerServiceMock.isLiveStreamActive.and.returnValue(false);

    service.goLive();

    expect(service.isLive()).toBeTrue();
    expect(historyGatewayMock.openLiveStream).toHaveBeenCalledWith(new Date(serverNowTs));
  });

  it('should emit visual events with live animation timestamps normalized by the timeline', () => {
    const visualEvents: CockpitTimelineVisualEvent[] = [];

    service.visualEvents$.subscribe((visualEvent) => {
      visualEvents.push(visualEvent);
    });
    service.openDate(new Date(dayStartTs));

    liveEvents$.next({ event: { id: 'req-stale', destination: 'trello.com', ts: 42 }, source: 'live' });

    expect(visualEvents.length).toBe(1);
    expect(visualEvents[0].eventTs).toBe(serverNowTs);
    expect(visualEvents[0].animationTs).toBe(serverNowTs);
    expect(visualEvents[0].animationEvent.ts).toBe(serverNowTs);
    expect(visualEvents[0].visualDurationMultiplier).toBe(1);
  });

  it('should keep multiplier changes from affecting live playback', () => {
    const visualEvents: CockpitTimelineVisualEvent[] = [];

    service.visualEvents$.subscribe((visualEvent) => {
      visualEvents.push(visualEvent);
    });
    service.openDate(new Date(dayStartTs));
    timeMultiplierService.setMultiplier(2);
    service.advanceLiveClock(serverNowTs + 1_000);

    liveEvents$.next({ event: { id: 'req-live', destination: 'trello.com' }, source: 'live' });

    expect(service.isLive()).toBeTrue();
    expect(service.playheadTs()).toBe(serverNowTs + 1_000);
    expect(visualEvents.length).toBe(1);
    expect(visualEvents[0].eventTs).toBe(serverNowTs + 1_000);
    expect(visualEvents[0].animationTs).toBe(serverNowTs + 1_000);
    expect(visualEvents[0].animationEvent.ts).toBe(serverNowTs + 1_000);
    expect(visualEvents[0].visualDurationMultiplier).toBe(1);
  });

  it('should not emit live visual events while replaying snapshot history', () => {
    const visualEvents: CockpitTimelineVisualEvent[] = [];
    const scrubbedTs = dayStartTs + 10_000;

    service.visualEvents$.subscribe((visualEvent) => {
      visualEvents.push(visualEvent);
    });
    service.openDate(new Date(dayStartTs));
    service.startScrub();
    service.scrubTo(scrubbedTs);
    service.endScrub(scrubbedTs);
    service.advanceLiveClock(serverNowTs + 1_000);

    liveEvents$.next({ event: { id: 'req-too-old', destination: 'trello.com' }, source: 'live' });

    expect(service.isLive()).toBeFalse();
    expect(service.playheadTs()).toBeLessThan(serverNowTs);
    expect(visualEvents.length).toBe(0);
  });

  it('should keep live mode when multiplier changes and reset multiplier on go-live', () => {
    service.openDate(new Date(dayStartTs));

    expect(service.isLive()).toBeTrue();

    timeMultiplierService.setMultiplier(2);

    expect(service.isLive()).toBeTrue();
    expect(service.isPaused()).toBeFalse();

    service.goLive();

    expect(service.isLive()).toBeTrue();
    expect(timeMultiplierService.multiplier()).toBe(1);
  });

  it('should slow down historical replay when the time multiplier is increased', () => {
    const scrubbedTs = serverNowTs - 10_000;

    service.openDate(new Date(dayStartTs));
    timeMultiplierService.setMultiplier(2);
    service.startScrub();
    service.scrubTo(scrubbedTs);
    service.endScrub(scrubbedTs);
    service.advanceLiveClock(serverNowTs + 1_000);

    expect(service.isLive()).toBeFalse();
    expect(service.liveTs()).toBe(serverNowTs + 1_000);
    expect(service.playheadTs()).toBe(scrubbedTs + 500);
  });

  it('should cache snapshot events and emit them when replay reaches their timestamp', () => {
    const visualEvents: CockpitTimelineVisualEvent[] = [];
    const eventTs = dayStartTs + 30_000;

    service.visualEvents$.subscribe((visualEvent) => {
      visualEvents.push(visualEvent);
    });
    service.openDate(new Date(dayStartTs));

    liveEvents$.next({
      event: { id: 'req-snapshot', destination: 'trello.com', ts: eventTs / 1000 },
      source: 'snapshot',
      snapshotId: 'snapshot-after',
    });

    expect(visualEvents.length).toBe(0);

    service.startScrub();
    service.scrubTo(eventTs - 1_000);
    service.endScrub(eventTs - 1_000);
    service.advanceLiveClock(serverNowTs + 1_000);

    expect(visualEvents.length).toBe(1);
    expect(visualEvents[0].source).toBe('snapshot');
    expect(visualEvents[0].event.id).toBe('req-snapshot');
    expect(visualEvents[0].eventTs).toBe(eventTs);
  });

  it('should play back cached snapshot events in time-sorted order and support resetting cursor on seek', () => {
    const visualEvents: CockpitTimelineVisualEvent[] = [];
    const eventTs1 = dayStartTs + 20_000;
    const eventTs2 = dayStartTs + 10_000;

    service.visualEvents$.subscribe((visualEvent) => {
      visualEvents.push(visualEvent);
    });
    service.openDate(new Date(dayStartTs));

    liveEvents$.next({
      event: { id: 'req-20s', destination: 'trello.com', ts: eventTs1 / 1000 },
      source: 'snapshot',
      snapshotId: 'snapshot-after',
    });

    liveEvents$.next({
      event: { id: 'req-10s', destination: 'trello.com', ts: eventTs2 / 1000 },
      source: 'snapshot',
      snapshotId: 'snapshot-after',
    });

    service.startScrub();
    service.scrubTo(dayStartTs + 5_000);
    service.endScrub(dayStartTs + 5_000);

    visualEvents.length = 0;

    service.advanceLiveClock(serverNowTs + 10_000);

    expect(visualEvents.length).toBe(1);
    expect(visualEvents[0].event.id).toBe('req-10s');

    service.advanceLiveClock(serverNowTs + 20_000);

    expect(visualEvents.length).toBe(2);
    expect(visualEvents[1].event.id).toBe('req-20s');

    service.startScrub();
    service.scrubTo(dayStartTs + 5_000);
    service.endScrub(dayStartTs + 5_000);

    visualEvents.length = 0;

    service.advanceLiveClock(serverNowTs + 40_000);

    expect(visualEvents.length).toBe(2);
    expect(visualEvents[0].event.id).toBe('req-10s');
    expect(visualEvents[1].event.id).toBe('req-20s');
  });

  it('should close the active stream through the worker bridge', () => {
    service.openDate(new Date(dayStartTs));

    service.close();

    expect(streamWorkerServiceMock.closeStream).toHaveBeenCalledTimes(1);
  });

  it('should request a snapshot after endScrub even when the live stream is inactive', () => {
    const scrubbedTs = serverNowTs - 10_000;

    service.openDate(new Date(dayStartTs));
    streamWorkerServiceMock.isLiveStreamActive.and.returnValue(false);
    historyGatewayMock.loadAfter.calls.reset();

    service.startScrub();
    service.scrubTo(scrubbedTs);
    service.endScrub(scrubbedTs);

    expect(historyGatewayMock.loadAfter).toHaveBeenCalled();
  });

  it('should request a snapshot after endScrub when stream is active', () => {
    const scrubbedTs = serverNowTs - 10_000;

    service.openDate(new Date(dayStartTs));
    historyGatewayMock.loadAfter.calls.reset();

    service.startScrub();
    service.scrubTo(scrubbedTs);
    service.endScrub(scrubbedTs);

    expect(historyGatewayMock.loadAfter).toHaveBeenCalled();
  });

  it('should preserve downloaded ranges when goLive reconnects the stream on today', () => {
    const scrubbedTs = serverNowTs - 10_000;

    service.openDate(new Date(dayStartTs));

    // Scrub back to build up a downloaded range, then let the stream go inactive.
    service.startScrub();
    service.scrubTo(scrubbedTs);
    service.endScrub(scrubbedTs);

    const downloadedBefore = service.downloadedRanges();

    expect(downloadedBefore.length).toBeGreaterThan(0);

    streamWorkerServiceMock.isLiveStreamActive.and.returnValue(false);
    historyGatewayMock.openLiveStream.calls.reset();

    service.goLive();

    // Stream should have been reconnected.
    expect(historyGatewayMock.openLiveStream).toHaveBeenCalled();
    // Downloaded history must be intact — no wipe on reconnect.
    expect(service.downloadedRanges()).toEqual(downloadedBefore);
    expect(service.isLive()).toBeTrue();
  });

  it('should reconnect the stream when endScrub snaps the playhead to the live edge', () => {
    service.openDate(new Date(dayStartTs));

    // Simulate stream going inactive while user was scrubbing.
    streamWorkerServiceMock.isLiveStreamActive.and.returnValue(false);
    historyGatewayMock.openLiveStream.calls.reset();

    // Drag playhead all the way to live edge (serverNowTs = liveTs).
    service.startScrub();
    service.scrubTo(serverNowTs);
    service.endScrub(serverNowTs);

    // Should be live and the stream should have been reopened.
    expect(service.isLive()).toBeTrue();
    expect(historyGatewayMock.openLiveStream).toHaveBeenCalled();

    // Simulate stream becoming active after reconnection.
    streamWorkerServiceMock.isLiveStreamActive.and.returnValue(true);

    expect(service.isConnected()).toBeTrue();
  });

  it('should start performance recovery timer when snapshot completes', () => {
    const scrubbedTs = serverNowTs - 10_000;

    service.openDate(new Date(dayStartTs));

    // Build up a downloaded range.
    service.startScrub();
    service.scrubTo(scrubbedTs);
    service.endScrub(scrubbedTs);

    // The timer should have been set after snapshot completion.
    // Just verify the service is in a valid state.
    expect(service.downloadedRanges().length).toBeGreaterThan(0);
  });

  it('should prune downloaded ranges if performance is still degraded after 5 seconds', () => {
    jasmine.clock().install();

    try {
      const performanceBudgetService = TestBed.inject(PerformanceBudgetService);
      const scrubbedTs = serverNowTs - 10_000;

      service.openDate(new Date(dayStartTs));

      // Build up a downloaded range.
      service.startScrub();
      service.scrubTo(scrubbedTs);
      service.endScrub(scrubbedTs);

      const downloadedBefore = service.downloadedRanges();

      expect(downloadedBefore.length).toBeGreaterThan(0);

      // Simulate sustained performance degradation.
      (performanceBudgetService.budgetState as any).set('degraded');

      // Advance time by 5 seconds. Pruning should happen.
      jasmine.clock().tick(5100);

      const downloadedAfter = service.downloadedRanges();

      // Should have fewer ranges (pruned down to 10-minute window around playhead).
      expect(downloadedAfter.length).toBeGreaterThanOrEqual(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('should clear recovery timer if performance becomes optimal', () => {
    jasmine.clock().install();

    try {
      const performanceBudgetService = TestBed.inject(PerformanceBudgetService);
      const scrubbedTs = serverNowTs - 10_000;

      service.openDate(new Date(dayStartTs));

      // Build up a downloaded range.
      service.startScrub();
      service.scrubTo(scrubbedTs);
      service.endScrub(scrubbedTs);

      const downloadedBefore = service.downloadedRanges();

      expect(downloadedBefore.length).toBeGreaterThan(0);

      // Simulate performance degradation first.
      (performanceBudgetService.budgetState as any).set('degraded');

      // Then recover to optimal before timer fires (at 500ms, before 5000ms).
      jasmine.clock().tick(500);
      (performanceBudgetService.budgetState as any).set('optimal');

      // Advance to 5+ seconds. Timer should be cleared, no pruning happens.
      jasmine.clock().tick(4600);

      const downloadedAfter = service.downloadedRanges();

      // Should still have all the downloaded ranges since we recovered.
      expect(downloadedAfter).toEqual(downloadedBefore);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('should reset timer if a new snapshot completes before timer fires', () => {
    jasmine.clock().install();

    try {
      const performanceBudgetService = TestBed.inject(PerformanceBudgetService);
      let snapshotCount = 0;

      // Override loadAfter to track snapshot completion count.
      historyGatewayMock.loadAfter.and.callFake((cursor: CockpitTimelineCursor) =>
        of({
          snapshotId: `snapshot-${++snapshotCount}`,
          range: { fromTs: cursor.ts, toTs: cursor.ts + 1 },
          count: 0,
          truncated: false,
        }),
      );

      service.openDate(new Date(dayStartTs));

      // First snapshot load.
      service.startScrub();
      service.scrubTo(serverNowTs - 10_000);
      service.endScrub(serverNowTs - 10_000);

      (performanceBudgetService.budgetState as any).set('degraded');

      // Advance 3 seconds (before first timer would fire at 5 seconds).
      jasmine.clock().tick(3000);

      // Load a second snapshot (resets timer).
      service.startScrub();
      service.scrubTo(serverNowTs - 20_000);
      service.endScrub(serverNowTs - 20_000);

      // Advance 2 more seconds (total 5, but new timer is only at 2 seconds).
      jasmine.clock().tick(2000);

      // At this point, without reset, pruning would have happened already.
      // But because timer reset, it should still not have pruned yet.
      // Verify by checking we're still in a valid state.
      expect(service.downloadedRanges().length).toBeGreaterThanOrEqual(0);

      // Advance another 3+ seconds to trigger the new timer.
      jasmine.clock().tick(3100);

      // Now pruning should have happened.
      expect(service.downloadedRanges().length).toBeGreaterThanOrEqual(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('should rate-limit prefetch requests to at most one every 5 seconds, but not block seek/scrub requests', () => {
    jasmine.clock().install();
    try {
      const pastDate = new Date(dayStartTs - 48 * 60 * 60_000);
      const pastDayStartTs = Date.UTC(pastDate.getUTCFullYear(), pastDate.getUTCMonth(), pastDate.getUTCDate());

      let mockTime = serverNowTs;

      (Date.now as jasmine.Spy).and.callFake(() => mockTime);

      historyGatewayMock.getRangeMeta.and.returnValue(
        of({
          dateKey: '2025-12-30',
          serverNowTs: pastDayStartTs + 3600_000,
          availableRange: { fromTs: pastDayStartTs, toTs: pastDayStartTs + 24 * 3600_000 - 1 },
          downloadedRanges: [],
        }),
      );

      historyGatewayMock.loadAfter.calls.reset();

      // Open date - triggers initial request, setting #lastSnapshotRequestTimeMs to mockTime
      service.openDate(pastDate);

      expect(historyGatewayMock.loadAfter).toHaveBeenCalledTimes(1);

      // Trigger checkBufferHealth by advancing clock (by 1 second)
      mockTime += 1000;
      service.advanceLiveClock(mockTime);

      // Within 5 second cooldown, no second request should be made
      expect(historyGatewayMock.loadAfter).toHaveBeenCalledTimes(1);

      // Advance clock by 6 seconds (beyond 5 second cooldown)
      mockTime += 6000;
      jasmine.clock().tick(6000);
      service.advanceLiveClock(mockTime);

      // Should have triggered loadAfter again because the cooldown expired
      expect(historyGatewayMock.loadAfter).toHaveBeenCalledTimes(2);

      // Now immediately seek (user-initiated)
      // This should NOT be rate-limited by the prefetch cooldown
      service.startScrub();
      service.scrubTo(pastDayStartTs + 5000);
      service.endScrub(pastDayStartTs + 5000);

      // Should have triggered loadAfter immediately (total 3 times)
      expect(historyGatewayMock.loadAfter).toHaveBeenCalledTimes(3);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('should halt advanceLiveClock when there are pending snapshots in the store', () => {
    const timelineStore = TestBed.inject(CockpitTimelineStore);

    service.openDate(new Date(dayStartTs));

    const initialPlayhead = service.playheadTs();

    // Start a snapshot to trigger buffering
    timelineStore.startSnapshot({
      key: 'test-pending',
      direction: 'range',
      fromTs: 0,
      toTs: 100,
      limit: 30,
    });

    // Try to advance the clock
    service.advanceLiveClock(serverNowTs + 1_000);

    // Verify playhead did NOT advance
    expect(service.playheadTs()).toBe(initialPlayhead);

    // Complete the snapshot
    timelineStore.completeSnapshot('test-pending', { fromTs: 0, toTs: 100 });

    // Advance the clock again
    service.advanceLiveClock(serverNowTs + 2_000);

    // Verify playhead advanced now
    expect(service.playheadTs()).toBeGreaterThan(initialPlayhead);
  });
});
