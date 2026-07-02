import { TestBed } from '@angular/core/testing';
import { CockpitTimelineStore } from './cockpit-timeline-store.service';

describe('CockpitTimelineStore', () => {
  let store: CockpitTimelineStore;
  const dayStartTs = Date.UTC(2026, 0, 1);

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(CockpitTimelineStore);
    store.initializeForDate(new Date(dayStartTs), dayStartTs + 60_000);
  });

  it('should initialize a UTC day range and pin the playhead to live if nowTs is on the same day', () => {
    expect(store.availableRange()).toEqual({ fromTs: dayStartTs, toTs: dayStartTs + 60_000 });
    expect(store.playheadTs()).toBe(store.liveTs());
    expect(store.isLive()).toBeTrue();
  });

  it('should use UTC day boundaries even when local time would be a different day', () => {
    const utcDayStartTs = Date.UTC(2026, 5, 3);

    expect(store.dayRange(new Date(Date.UTC(2026, 5, 3, 23, 30)))).toEqual({
      fromTs: utcDayStartTs,
      toTs: utcDayStartTs + 24 * 60 * 60_000 - 1,
    });
  });

  it('should initialize in replay mode if the selected date is in the past compared to nowTs', () => {
    const pastDate = new Date(dayStartTs - 24 * 60 * 60_000);

    store.initializeForDate(pastDate, dayStartTs);

    expect(store.isLive()).toBeFalse();
    expect(store.mode()).toBe('replay');
  });

  it('should keep playhead pinned while live events advance liveTs', () => {
    const eventTs = dayStartTs + 5 * 60_000;

    store.ingestEvent({ id: 'req-1', ts: eventTs }, 'live');

    expect(store.liveTs()).toBe(eventTs);
    expect(store.playheadTs()).toBe(eventTs);
    expect(store.isTimestampDownloaded(eventTs)).toBeFalse();
  });

  it('should extend the available range as today live time advances', () => {
    const nextLiveTs = dayStartTs + 2 * 60_000;

    store.advanceLiveClock(nextLiveTs);

    expect(store.availableRange()).toEqual({ fromTs: dayStartTs, toTs: nextLiveTs });
    expect(store.liveTs()).toBe(nextLiveTs);
    expect(store.playheadTs()).toBe(nextLiveTs);
  });

  it('should use current live time for unusable live event timestamps', () => {
    const nextLiveTs = dayStartTs + 2 * 60_000;

    store.advanceLiveClock(nextLiveTs);
    const eventTs = store.ingestEvent({ id: 'req-relative-ts', ts: 42 }, 'live');

    expect(eventTs).toBe(nextLiveTs);
    expect(store.liveTs()).toBe(nextLiveTs);
    expect(store.isTimestampDownloaded(nextLiveTs)).toBeFalse();
  });

  it('should not mark live stream data as downloaded history', () => {
    const firstEventTs = dayStartTs + 61_000;
    const secondEventTs = dayStartTs + 62_000;

    store.ingestEvent({ id: 'req-bucket-1', ts: firstEventTs }, 'live');
    store.ingestEvent({ id: 'req-bucket-2', ts: secondEventTs }, 'live');

    expect(store.downloadedRanges()).toEqual([]);
  });

  it('should freeze playhead while paused and keep receiving live time without caching replay ranges', () => {
    const pausedAtTs = store.playheadTs();
    const eventTs = dayStartTs + 10 * 60_000;

    store.togglePause();
    store.ingestEvent({ id: 'req-2', ts: eventTs }, 'live');

    expect(store.isPaused()).toBeTrue();
    expect(store.playheadTs()).toBe(pausedAtTs);
    expect(store.liveTs()).toBe(eventTs);
    expect(store.isTimestampDownloaded(eventTs)).toBeFalse();
  });

  it('should play from a scrubbed timestamp in replay mode', () => {
    const liveTs = dayStartTs + 10 * 60_000;
    const scrubbedTs = dayStartTs + 5 * 60_000;

    store.advanceLiveClock(liveTs);
    store.completeSnapshot('active-range', { fromTs: dayStartTs, toTs: liveTs });

    store.startScrub();
    store.scrubTo(scrubbedTs);
    store.endScrub(scrubbedTs);

    expect(store.mode()).toBe('replay');
    expect(store.isPaused()).toBeFalse();
    expect(store.isLive()).toBeFalse();
    expect(store.playheadTs()).toBe(scrubbedTs);

    store.advanceLiveClock(liveTs + 1_000);

    expect(store.mode()).toBe('replay');
    expect(store.liveTs()).toBe(liveTs + 1_000);
    expect(store.playheadTs()).toBe(scrubbedTs + 1_000);
  });

  it('should stay in replay after scrubbing into history until go-live is requested', () => {
    const liveTs = dayStartTs + 10 * 60_000;
    const scrubbedTs = dayStartTs + 5 * 60_000;

    store.advanceLiveClock(liveTs);
    store.completeSnapshot('active-range', { fromTs: dayStartTs, toTs: liveTs });
    store.startScrub();
    store.scrubTo(scrubbedTs);
    store.endScrub(scrubbedTs);

    expect(store.mode()).toBe('replay');
    expect(store.isLive()).toBeFalse();

    store.advanceLiveClock(liveTs + 1_000);

    expect(store.mode()).toBe('replay');
    expect(store.playheadTs()).toBe(scrubbedTs + 1_000);

    store.goLive();

    expect(store.isLive()).toBeTrue();
    expect(store.playheadTs()).toBe(store.liveTs());
  });

  it('should advance replay playback by the historical multiplier', () => {
    const liveTs = dayStartTs + 10 * 60_000;
    const scrubbedTs = dayStartTs + 5 * 60_000;

    store.advanceLiveClock(liveTs);
    store.completeSnapshot('active-range', { fromTs: dayStartTs, toTs: liveTs });
    store.startScrub();
    store.scrubTo(scrubbedTs);
    store.endScrub(scrubbedTs);
    store.advanceLiveClock(liveTs + 1_000, 3);

    expect(store.mode()).toBe('replay');
    expect(store.liveTs()).toBe(liveTs + 1_000);
    expect(store.playheadTs()).toBe(scrubbedTs + 3_000);
  });

  it('should dedupe pending snapshots and complete them into downloaded ranges', () => {
    const snapshot = {
      key: 'range:1',
      direction: 'range' as const,
      fromTs: dayStartTs,
      toTs: dayStartTs + 60_000,
      limit: 100,
    };

    expect(store.startSnapshot(snapshot)).toBeTrue();
    expect(store.startSnapshot(snapshot)).toBeFalse();
    expect(store.pendingSnapshots().length).toBe(1);

    store.completeSnapshot(snapshot.key, { fromTs: snapshot.fromTs, toTs: snapshot.toTs });

    expect(store.pendingSnapshots().length).toBe(0);
    expect(store.isRangeDownloaded(snapshot.fromTs, snapshot.toTs)).toBeTrue();
  });

  it('should allow overlapping range requests (edge case: can cause duplicate events from mock server)', () => {
    // Scenario: User clicks near downloaded range boundary
    // Downloaded range: [1000, 2000]
    // User clicks at ts=900, buffer window requests: [750, 1150]
    // This overlaps but isRangeDownloaded() only checks full containment, not overlap
    // Result: New request allowed → mock server returns overlapping events with different IDs

    const downloadedRange = { fromTs: 1000, toTs: 2000 };
    const overlappingRequest = { fromTs: 750, toTs: 1150 };

    // Complete initial snapshot
    store.completeSnapshot('range:first', downloadedRange);

    expect(store.isRangeDownloaded(downloadedRange.fromTs, downloadedRange.toTs)).toBeTrue();

    // This should fail but currently passes (isRangeDownloaded checks containment, not overlap)
    expect(store.isRangeDownloaded(overlappingRequest.fromTs, overlappingRequest.toTs)).toBeFalse();

    // This allows a new snapshot request for overlapping range
    // Mock server would generate events with different IDs than the first snapshot
    // Frontend deduplication relies on event IDs matching, so duplicates can appear
  });
});
