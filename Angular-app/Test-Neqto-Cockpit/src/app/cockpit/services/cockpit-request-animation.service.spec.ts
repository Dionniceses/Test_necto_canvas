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
    service.ingestEvent({ id: 1, 'ttfb-hint': 100 }, 0);

    const tick = service.render(50, resolveLinearEndpoints);

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
    expect(tick.frames[0].x).toBeCloseTo(96, 5);
    expect(tick.completedRequestIds.length).toBe(0);
  });

  it('should retime existing animation when final ttfb arrives for same request', () => {
    service.ingestEvent({ id: 3, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 3, 'ttfb-hint': 100 }, 0);

    service.render(50, resolveLinearEndpoints);

    service.ingestEvent({ id: 3, ttfb: 200 }, 50);

    const tick = service.render(90, resolveLinearEndpoints);

    expect(tick.frames.length).toBe(1);
    expect(tick.frames[0].x).toBeCloseTo(70, 5);
    expect(tick.completedRequestIds.length).toBe(0);
  });

  it('should complete and clean up animation after final ttfb reaches destination', () => {
    service.ingestEvent({ id: 4, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 4, 'ttfb-hint': 100 }, 0);
    service.render(50, resolveLinearEndpoints);

    service.ingestEvent({ id: 4, ttfb: 100 }, 50);

    const completedTick = service.render(150, resolveLinearEndpoints);
    const postCompleteTick = service.render(160, resolveLinearEndpoints);

    expect(completedTick.completedRequestIds).toEqual(['4']);
    expect(postCompleteTick.frames.length).toBe(0);
  });

  it('should clear all internal state on reset', () => {
    service.ingestEvent({ id: 5, destination: 'trello.com' }, 0);
    service.ingestEvent({ id: 5, 'ttfb-hint': 100 }, 0);

    service.reset();

    const tick = service.render(50, resolveLinearEndpoints);

    expect(tick.frames.length).toBe(0);
    expect(tick.completedRequestIds.length).toBe(0);
  });
});
