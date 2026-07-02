import { TestBed } from '@angular/core/testing';
import { TimeMultiplierService } from './time-multiplier.service';

describe('TimeMultiplierService', () => {
  let service: TimeMultiplierService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TimeMultiplierService);
  });

  afterEach(() => {
    service.reset();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should default to normal playback speed', () => {
    expect(service.divider()).toBe(1);
    expect(service.multiplier()).toBe(1);
    expect(service.multiplierLabel()).toBe('1/1');
  });

  it('should clamp multiplier input to the supported range', () => {
    service.setMultiplier(100);

    expect(service.divider()).toBe(service.maxMultiplier);
    expect(service.multiplier()).toBe(1 / service.maxMultiplier);

    service.setMultiplier(-1);

    expect(service.divider()).toBe(1);
    expect(service.multiplier()).toBe(1);
  });

  it('should snap multiplier input to the configured step', () => {
    service.setMultiplier(1.37);

    expect(service.divider()).toBe(1);
    expect(service.multiplier()).toBe(1);
    expect(service.multiplierLabel()).toBe('1/1');
  });
});
