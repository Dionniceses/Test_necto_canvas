import { TestBed } from '@angular/core/testing';
import { CockpitRequestAnimationService } from './cockpit-request-animation.service';

describe('CockpitRequestAnimationService', () => {
  let service: CockpitRequestAnimationService;

  const resolveLinearEndpoints = () => ({
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 0,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CockpitRequestAnimationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start animation from hinted ttfb once destination is known', () => {
    service.ingestEvent({ id: 1, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 1, 'ttfb-hint': 1000 }, 0);

    const tick = service.render(500, resolveLinearEndpoints);

    expect(tick.frames.length).toBe(1);
    expect(tick.frames[0].requestId).toBe('1');
    expect(tick.frames[0].destinationKey).toBe('trello.com');
    expect(tick.frames[0].x).toBeCloseTo(50, 5);
    expect(tick.completedRequestIds.length).toBe(0);
  });

  it('should hold hinted animation near destination until final ttfb arrives', () => {
    service.ingestEvent({ id: 2, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 2, ttfb_hint: 100 }, 0);

    const tick = service.render(1000, resolveLinearEndpoints);

    expect(tick.frames.length).toBe(1);
    expect(tick.frames[0].x).toBeCloseTo(86, 5);
    expect(tick.completedRequestIds.length).toBe(0);
  });

  it('should retime existing animation when final ttfb arrives for same request', () => {
    service.ingestEvent({ id: 3, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 3, 'ttfb-hint': 1000 }, 0);

    service.render(500, resolveLinearEndpoints);

    service.ingestEvent({ id: 3, ttfb: 2000 }, 500);

    const tick = service.render(900, resolveLinearEndpoints);

    expect(tick.frames.length).toBe(1);
    expect(tick.frames[0].x).toBeCloseTo(70, 5);
    expect(tick.completedRequestIds.length).toBe(0);
  });

  it('should complete and clean up animation after final ttfb reaches destination', () => {
    const resolveEndpoints = jasmine.createSpy('resolveEndpoints').and.callFake(resolveLinearEndpoints);

    service.ingestEvent({ id: 4, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 4, 'ttfb-hint': 1000 }, 0);
    service.render(500, resolveEndpoints);
    resolveEndpoints.calls.reset();

    service.ingestEvent({ id: 4, ttfb: 1000 }, 500);

    const completedTick = service.render(1000, resolveEndpoints);

    resolveEndpoints.calls.reset();

    const postCompleteTick = service.render(1010, resolveEndpoints);

    expect(completedTick.completedRequestIds).toEqual(['4']);
    expect(postCompleteTick.frames.length).toBe(0);
    expect(postCompleteTick.completedRequestIds.length).toBe(0);
    expect(resolveEndpoints).not.toHaveBeenCalled();
  });

  it('should resume a parked hinted animation when the final ttfb arrives', () => {
    const resolveEndpoints = jasmine.createSpy('resolveEndpoints').and.callFake(resolveLinearEndpoints);

    service.ingestEvent({ id: 7, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 7, 'ttfb-hint': 100 }, 0);

    const heldTick = service.render(1_000, resolveEndpoints);
    const parkedTick = service.render(5_000, resolveEndpoints);

    // Final event arrives late, after the ball has parked near its destination.
    service.ingestEvent({ id: 7, response_code: 200, ttfb: 1_000 }, 5_000);

    const resumedTick = service.render(5_000, resolveEndpoints);
    const completedTick = service.render(5_140, resolveEndpoints);
    const postCompleteTick = service.render(5_200, resolveEndpoints);

    expect(heldTick.frames.length).toBe(1);
    expect(heldTick.frames[0].x).toBeCloseTo(86, 5);
    expect(parkedTick.frames.length).toBe(0);
    // Resumes from the hold position instead of jumping straight to completion.
    expect(resumedTick.frames.length).toBe(1);
    expect(resumedTick.frames[0].x).toBeCloseTo(86, 5);
    expect(resumedTick.completedRequestIds.length).toBe(0);
    // Then runs the rest of the way to the destination and completes.
    expect(completedTick.completedRequestIds).toEqual(['7']);
    expect(postCompleteTick.frames.length).toBe(0);
    expect(postCompleteTick.completedRequestIds.length).toBe(0);
  });

  it('should ignore a stale partial event delivered after the request was finalized', () => {
    // Request 9 runs its full lifecycle and reaches its destination.
    service.ingestEvent({ id: 9, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 9, 'ttfb-hint': 100 }, 0);
    service.ingestEvent({ id: 9, response_code: 200, ttfb: 100 }, 0);

    service.render(50, resolveLinearEndpoints);
    const completedTick = service.render(200, resolveLinearEndpoints);

    expect(completedTick.completedRequestIds).toContain('9');

    // The stream worker can replay a stale {destination + hint} batch AFTER the final
    // event, because batched events are emitted on independent timers and may reorder.
    // It must not resurrect a hint animation that parks near the destination forever.
    service.ingestEvent({ id: 9, destination: 'trello.com' }, 300);
    service.ingestEvent({ id: 9, 'ttfb-hint': 100 }, 300);

    const afterStaleTick = service.render(100_000, resolveLinearEndpoints);

    expect(afterStaleTick.frames.length).toBe(0);
    expect(afterStaleTick.completedRequestIds.length).toBe(0);
  });

  it('should clear all internal state on reset', () => {
    service.ingestEvent({ id: 5, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 5, 'ttfb-hint': 100 }, 0);

    service.reset();

    const tick = service.render(50, resolveLinearEndpoints);

    expect(tick.frames.length).toBe(0);
    expect(tick.completedRequestIds.length).toBe(0);
  });

  it('should use timeline time directly for animation progress', () => {
    service.ingestEvent({ id: 6, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 6, 'ttfb-hint': 1000 }, 0);

    const tick = service.render(500, resolveLinearEndpoints);

    expect(tick.frames.length).toBe(1);
    expect(tick.frames[0].x).toBeCloseTo(50, 5);
  });

  it('should apply visual multiplier to the displayed duration only', () => {
    service.ingestEvent({ id: 8, destination: 'trello.com' }, 0, 3);
    service.ingestEvent({ id: 8, 'ttfb-hint': 1000 }, 0, 3);

    const tick = service.render(500, resolveLinearEndpoints);

    expect(tick.frames.length).toBe(1);
    expect(tick.frames[0].x).toBeCloseTo(16.67, 2);
  });
});
