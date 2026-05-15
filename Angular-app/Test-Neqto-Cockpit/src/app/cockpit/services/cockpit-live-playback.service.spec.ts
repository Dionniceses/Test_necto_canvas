import { TestBed } from '@angular/core/testing';
import { CockpitLivePlaybackService } from './cockpit-live-playback.service';

describe('CockpitLivePlaybackService', () => {
  let service: CockpitLivePlaybackService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CockpitLivePlaybackService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should expose live state by default', () => {
    expect(service.isPaused()).toBeFalse();
    expect(service.isLive()).toBeTrue();
    expect(service.bufferedEventCount()).toBe(0);
  });

  it('should mark playback as delayed when paused', () => {
    service.initializeTimeline(0);
    service.togglePause(100);

    expect(service.isPaused()).toBeTrue();
    expect(service.isLive()).toBeFalse();
    expect(service.bufferedEventCount()).toBe(0);
  });

  it('should jump timeline clock to now when resumed', () => {
    service.initializeTimeline(100);
    service.advanceTimelineClock(130);

    expect(service.timelineClockMs()).toBe(130);

    service.togglePause(130);
    service.advanceTimelineClock(200);

    expect(service.timelineClockMs()).toBe(130);

    service.togglePause(220);

    expect(service.timelineClockMs()).toBe(220);
    expect(service.isPaused()).toBeFalse();
    expect(service.isLive()).toBeTrue();
  });

  it('should jump to live time when go-live is triggered', () => {
    service.initializeTimeline(100);
    service.togglePause(130);
    service.advanceTimelineClock(250);

    expect(service.timelineClockMs()).toBe(100);

    service.goLive(300);

    expect(service.isPaused()).toBeFalse();
    expect(service.isLive()).toBeTrue();
    expect(service.bufferedEventCount()).toBe(0);
    expect(service.timelineClockMs()).toBe(300);
  });

  it('should freeze timeline clock while paused', () => {
    service.initializeTimeline(100);
    service.advanceTimelineClock(130);

    expect(service.timelineClockMs()).toBe(130);

    service.togglePause(130);
    service.advanceTimelineClock(200);

    expect(service.timelineClockMs()).toBe(130);
  });

  it('should reset to default state', () => {
    service.initializeTimeline(100);
    service.togglePause(130);

    service.reset();

    expect(service.isPaused()).toBeFalse();
    expect(service.isLive()).toBeTrue();
    expect(service.timelineClockMs()).toBe(0);
  });
});
