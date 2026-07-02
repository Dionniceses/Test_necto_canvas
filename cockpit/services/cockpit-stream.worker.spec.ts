import {
  MAX_STORED_EVENTS,
  applyBudgetState,
  emitFromNdjsonLine,
  flushSendBuffer,
  isCockpitMockStreamEvent,
  parseNdjsonLine,
  postRangeMeta,
  postRequestDetails,
  resetSession,
  resetWorkerState,
  subscribeDestination,
  syncPlayheadTime,
  ingestDestinationAggregate,
} from './cockpit-stream.worker';

describe('cockpit-stream.worker', () => {
  let postMessageSpy: jasmine.Spy;

  beforeEach(() => {
    resetWorkerState();
    postMessageSpy = spyOn(window, 'postMessage');
  });

  it('should parse valid NDJSON line', () => {
    const parsed = parseNdjsonLine('{"id":"req-1","payload_size":120}\n') as Record<string, unknown>;

    expect(parsed['id']).toBe('req-1');
    expect(parsed['payload_size']).toBe(120);
  });

  it('should ignore malformed NDJSON line parsing', () => {
    const parsed = parseNdjsonLine('{"id":"req-1"');

    expect(parsed).toBeNull();
  });

  it('should accept partial NDJSON stream events with id only', () => {
    expect(isCockpitMockStreamEvent({ id: 'req-1' })).toBeTrue();
    expect(isCockpitMockStreamEvent({ id: 12345, payload_size: 10 })).toBeTrue();
  });

  it('should reject invalid NDJSON event shapes', () => {
    expect(isCockpitMockStreamEvent({})).toBeFalse();
    expect(isCockpitMockStreamEvent({ id: true })).toBeFalse();
    expect(isCockpitMockStreamEvent({ id: 'req-1', ttfb: 'slow' })).toBeFalse();
    expect(isCockpitMockStreamEvent({ id: 12345, 'ttfb-hint': 'slow' })).toBeFalse();
  });

  it('should not post messages for malformed NDJSON lines', () => {
    emitFromNdjsonLine('{"id":"req-1"');
    flushSendBuffer();

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('should post parsed events for valid NDJSON lines', () => {
    emitFromNdjsonLine('{"id":"req-1","response_code":200}\n');
    flushSendBuffer();

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'BATCH_UPDATE',
      data: [
        jasmine.objectContaining({
          event: jasmine.objectContaining({ id: 'req-1', response_code: 200 }),
          ageMs: jasmine.any(Number),
        }),
      ],
    });
  });

  it('should post snapshot events immediately for snapshot NDJSON lines', () => {
    emitFromNdjsonLine('{"id":"req-1","destination":"bol.com"}\n', 'snapshot', 'snapshot-1');

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'snapshot-event',
      snapshotId: 'snapshot-1',
      event: jasmine.objectContaining({ id: 'req-1', destination: 'bol.com' }),
    });
  });

  it('should post range metadata messages', () => {
    const meta = {
      dateKey: '2026-01-01',
      serverNowTs: 1_767_225_600_000,
      availableRange: { fromTs: 1_767_225_600_000, toTs: 1_767_312_000_000 },
      downloadedRanges: [],
    };

    postRangeMeta(meta);

    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'range-meta', meta });
  });

  it('should normalize numeric string response_code values', () => {
    emitFromNdjsonLine('{"id":"req-1","response_code":"500"}\n');
    flushSendBuffer();

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'BATCH_UPDATE',
      data: [
        jasmine.objectContaining({
          event: jasmine.objectContaining({ id: 'req-1', response_code: 500 }),
          ageMs: jasmine.any(Number),
        }),
      ],
    });
  });

  it('should normalize camelCase responseCode values into response_code', () => {
    emitFromNdjsonLine('{"id":"req-1","responseCode":500}\n');
    flushSendBuffer();

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'BATCH_UPDATE',
      data: [
        jasmine.objectContaining({
          event: jasmine.objectContaining({ id: 'req-1', response_code: 500 }),
          ageMs: jasmine.any(Number),
        }),
      ],
    });
  });

  it('should merge properties of duplicate IDs within the same tick', () => {
    emitFromNdjsonLine('{"id":"req-1","destination":"/api/orders"}\n');
    emitFromNdjsonLine('{"id":"req-1","response_code":200}\n');
    flushSendBuffer();

    expect(postMessageSpy).toHaveBeenCalledOnceWith({
      type: 'BATCH_UPDATE',
      data: [
        jasmine.objectContaining({
          event: jasmine.objectContaining({ id: 'req-1', destination: '/api/orders', response_code: 200 }),
          ageMs: jasmine.any(Number),
        }),
      ],
    });
  });

  it('should clear the send buffer after a flush so a second flush does not re-post', () => {
    emitFromNdjsonLine('{"id":"req-1","response_code":200}\n');
    flushSendBuffer();
    flushSendBuffer();

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('should compute ageMs from ts differences when ts is present', () => {
    emitFromNdjsonLine('{"id":"req-a","ts":1000}\n');
    emitFromNdjsonLine('{"id":"req-b","ts":1800}\n');
    flushSendBuffer();

    const batch = (postMessageSpy.calls.mostRecent().args[0] as { data: { event: { id: string }; ageMs: number }[] })
      .data;
    const itemA = batch.find((item) => item.event.id === 'req-a');
    const itemB = batch.find((item) => item.event.id === 'req-b');

    expect(itemA).toBeDefined();
    expect(itemB).toBeDefined();

    if (!itemA || !itemB) {
      return;
    }

    expect(itemA.ageMs).toBe(800);
    expect(itemB.ageMs).toBe(0);
  });

  it('should publish request details for a recent destination event', () => {
    emitFromNdjsonLine('{"id":"req-1","destination":"bol.com","flow":"checkout"}\n');
    emitFromNdjsonLine('{"id":"req-1","response_code":500,"response_size":2048}\n');

    postRequestDetails('req-1');

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'request-details',
      requestId: 'req-1',
      details: jasmine.objectContaining({
        id: 'req-1',
        destination: 'bol.com',
        flow: 'checkout',
        response_code: 500,
        response_size: 2048,
      }),
    });
  });

  it('should keep destination updates to 50 recent events and 20 recent errors while metrics count all responses', () => {
    subscribeDestination('bol.com');
    // Set playhead high enough to avoid future filtering
    syncPlayheadTime(1_800_000_000_001, true);

    for (let index = 1; index <= 55; index += 1) {
      emitFromNdjsonLine(
        JSON.stringify({ id: `event-${index}`, destination: 'bol.com', response_code: 200, ts: 1_800_000_000 }) + '\n',
      );
    }

    for (let index = 1; index <= 25; index += 1) {
      emitFromNdjsonLine(
        JSON.stringify({ id: `error-${index}`, destination: 'bol.com', response_code: 500, ts: 1_800_000_000 }) + '\n',
      );
    }

    flushSendBuffer();

    const destinationMessages = postMessageSpy.calls
      .allArgs()
      .map((args) => args[0])
      .filter((message): message is { type: 'destination-update'; data: Record<string, unknown> } => {
        return (message as { type?: string }).type === 'destination-update';
      });
    const latestDestinationMessage = destinationMessages[destinationMessages.length - 1];

    expect(latestDestinationMessage).toBeDefined();

    if (!latestDestinationMessage) {
      return;
    }

    expect(latestDestinationMessage.data['processedResponsesLastWindow']).toBe(80);
    expect(latestDestinationMessage.data['errorRatePercentage']).toBe(31.3);
    expect((latestDestinationMessage.data['events'] as unknown[]).length).toBe(50);
    expect((latestDestinationMessage.data['errors'] as unknown[]).length).toBe(20);
  });

  describe('applyBudgetState', () => {
    it('should not buffer hint-only events when deferHintEvents is true', () => {
      applyBudgetState(1_000, true);
      emitFromNdjsonLine('{"id":"req-1","ttfb-hint":100}');
      flushSendBuffer();

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('should buffer a merged event when a response follows a deferred hint', () => {
      applyBudgetState(1_000, true);
      emitFromNdjsonLine('{"id":"req-1","ttfb-hint":100}');
      emitFromNdjsonLine('{"id":"req-1","response_code":200}');
      flushSendBuffer();

      expect(postMessageSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'BATCH_UPDATE',
          data: [
            jasmine.objectContaining({
              event: jasmine.objectContaining({ id: 'req-1', 'ttfb-hint': 100, response_code: 200 }),
            }),
          ],
        }),
      );
    });

    it('should buffer hint-only events normally when deferHintEvents is false', () => {
      applyBudgetState(1_000, false);
      emitFromNdjsonLine('{"id":"req-1","ttfb-hint":100}');
      flushSendBuffer();

      expect(postMessageSpy).toHaveBeenCalled();
    });

    it('should prune the oldest event when MAX_STORED_EVENTS is exceeded', () => {
      // This event should be evicted once the store exceeds MAX_STORED_EVENTS.
      emitFromNdjsonLine('{"id":"old-event","response_code":200}');

      // Push MAX_STORED_EVENTS more events so the store hits MAX_STORED_EVENTS + 1.
      for (let i = 0; i < MAX_STORED_EVENTS; i++) {
        emitFromNdjsonLine(`{"id":"filler-${i}","response_code":200}`);
      }

      // flushSendBuffer calls pruneEventStore after posting, evicting old-event.
      flushSendBuffer();

      // Emit a fresh event so we get a second flush that only contains new-event.
      emitFromNdjsonLine('{"id":"new-event","response_code":201}');
      flushSendBuffer();

      const batch = (postMessageSpy.calls.mostRecent().args[0] as { data: { event: { id: string } }[] }).data;
      const ids = batch.map((item) => item.event.id);

      expect(ids).not.toContain('old-event');
      expect(ids).toContain('new-event');
    });

    it('should buffer hint-only events again after resetWorkerState restores deferHintEvents to false', () => {
      applyBudgetState(1_000, true);
      resetWorkerState();

      // After reset deferHintEvents is false, so hint-only events should be buffered.
      emitFromNdjsonLine('{"id":"req-1","ttfb-hint":100}');
      flushSendBuffer();

      expect(postMessageSpy).toHaveBeenCalled();
    });
  });

  describe('Simulation Time', () => {
    const baseTs = 1_800_000_000_000; // Some point in the future

    it('should ignore live events when not in live mode', () => {
      subscribeDestination('bol.com');
      resetSession(baseTs, false); // Simulation mode

      emitFromNdjsonLine(
        JSON.stringify({ id: 'live-1', destination: 'bol.com', response_code: 200, ts: baseTs / 1000 }) + '\n',
        'live',
      );
      flushSendBuffer();

      const updates = postMessageSpy.calls
        .allArgs()
        .filter((args) => args[0].type === 'destination-update')
        .map((args) => args[0]);
      const latestUpdate = updates[updates.length - 1];

      expect(latestUpdate.data.processedResponsesLastWindow).toBe(0);
    });

    it('should aggregate snapshot events in simulation mode when ingested', () => {
      subscribeDestination('bol.com');
      resetSession(baseTs, false);

      ingestDestinationAggregate(
        'snap-1',
        {
          id: 'snap-1',
          destination: 'bol.com',
          response_code: 200,
          ts: baseTs / 1000,
        },
        'snapshot',
      );
      flushSendBuffer();

      const updates = postMessageSpy.calls
        .allArgs()
        .filter((args) => args[0].type === 'destination-update')
        .map((args) => args[0]);
      const latestUpdate = updates[updates.length - 1];

      expect(latestUpdate.data.processedResponsesLastWindow).toBe(1);
    });

    it('should calculate processedWindowMinutes correctly', () => {
      subscribeDestination('bol.com');
      resetSession(baseTs, false);
      syncPlayheadTime(baseTs + 5 * 60 * 1000, false); // 5 minutes later

      ingestDestinationAggregate(
        'event-1',
        {
          id: 'event-1',
          destination: 'bol.com',
          response_code: 200,
          ts: baseTs / 1000,
        },
        'snapshot',
      );
      flushSendBuffer();

      const updates = postMessageSpy.calls
        .allArgs()
        .filter((args) => args[0].type === 'destination-update')
        .map((args) => args[0]);
      const latestUpdate = updates[updates.length - 1];

      expect(latestUpdate.data.processedWindowMinutes).toBe(5);
    });

    it('should allow processedWindowMinutes to grow beyond 30 minutes without a cap', () => {
      subscribeDestination('bol.com');
      resetSession(baseTs, false);
      syncPlayheadTime(baseTs + 45 * 60 * 1000, false); // 45 minutes later

      ingestDestinationAggregate(
        'event-1',
        {
          id: 'event-1',
          destination: 'bol.com',
          response_code: 200,
          ts: baseTs / 1000,
        },
        'snapshot',
      );
      flushSendBuffer();

      const updates = postMessageSpy.calls
        .allArgs()
        .filter((args) => args[0].type === 'destination-update')
        .map((args) => args[0]);
      const latestUpdate = updates[updates.length - 1];

      expect(latestUpdate.data.processedWindowMinutes).toBe(45);
    });

    it('should accumulate metrics for all processed events since last reset without time-pruning', () => {
      subscribeDestination('bol.com');
      resetSession(baseTs - 60 * 60 * 1000, false); // Started an hour ago
      syncPlayheadTime(baseTs, false);

      // Event within window
      ingestDestinationAggregate(
        'recent',
        {
          id: 'recent',
          destination: 'bol.com',
          response_code: 200,
          ts: (baseTs - 5 * 60 * 1000) / 1000,
        },
        'snapshot',
      );

      // Event outside 30 minutes
      ingestDestinationAggregate(
        'old',
        {
          id: 'old',
          destination: 'bol.com',
          response_code: 200,
          ts: (baseTs - 35 * 60 * 1000) / 1000,
        },
        'snapshot',
      );

      flushSendBuffer();

      const updates = postMessageSpy.calls
        .allArgs()
        .filter((args) => args[0].type === 'destination-update')
        .map((args) => args[0]);
      const latestUpdate = updates[updates.length - 1];

      expect(latestUpdate.data.processedResponsesLastWindow).toBe(2);
    });

    it('should reset metrics on session reset', () => {
      subscribeDestination('bol.com');
      resetSession(baseTs, true);

      emitFromNdjsonLine(
        JSON.stringify({
          id: 'event-1',
          destination: 'bol.com',
          'ttfb-hint': 100,
          response_code: 200,
          ts: baseTs / 1000,
        }) + '\n',
      );
      flushSendBuffer();

      resetSession(baseTs + 10000, true);
      flushSendBuffer();

      const updates = postMessageSpy.calls
        .allArgs()
        .filter((args) => args[0].type === 'destination-update')
        .map((args) => args[0]);

      expect(updates[updates.length - 2].data.processedResponsesLastWindow).toBe(1);
      expect(updates[updates.length - 1].data.processedResponsesLastWindow).toBe(0);
    });
  });
});
