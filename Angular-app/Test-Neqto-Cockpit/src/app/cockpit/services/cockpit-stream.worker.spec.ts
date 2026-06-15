import {
  MAX_STORED_EVENTS,
  applyBudgetState,
  emitFromNdjsonLine,
  flushSendBuffer,
  isCockpitMockStreamEvent,
  parseNdjsonLine,
  resetWorkerState,
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

    expect(itemA?.ageMs).toBe(800);
    expect(itemB?.ageMs).toBe(0);
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
});
