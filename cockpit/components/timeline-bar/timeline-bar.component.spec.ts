import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelineBarComponent } from './timeline-bar.component';

describe('TimelineBarComponent', () => {
  let component: TimelineBarComponent;
  let fixture: ComponentFixture<TimelineBarComponent>;
  const rangeStartTs = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  const rangeEndTs = Date.UTC(2026, 0, 1, 1, 0, 0, 0);

  const createTrackMouseEvent = (clientX: number): MouseEvent =>
    ({
      clientX,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0, width: 100 }),
      },
    }) as unknown as MouseEvent;

  const createTrackPointerEvent = (clientX: number): PointerEvent =>
    ({
      clientX,
      pointerId: 1,
      preventDefault: jasmine.createSpy('preventDefault'),
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0, width: 100 }),
        setPointerCapture: jasmine.createSpy('setPointerCapture'),
        releasePointerCapture: jasmine.createSpy('releasePointerCapture'),
      },
    }) as unknown as PointerEvent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelineBarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelineBarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('availableRange', { fromTs: rangeStartTs, toTs: rangeEndTs });
    fixture.componentRef.setInput('downloadedRanges', [{ fromTs: rangeStartTs, toTs: rangeStartTs + 30 * 60_000 }]);
    fixture.componentRef.setInput('playheadTs', rangeStartTs + 15 * 60_000);
    fixture.componentRef.setInput('liveTs', rangeEndTs);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start with no hover position', () => {
    expect(component.hoverPercent()).toBeNull();
  });

  it('should compute playhead percent from the controlled range', () => {
    expect(component.playheadPercent()).toBe(25);
  });

  it('should set hoverPercent when onTrackMouseMove() is called', () => {
    const fakeEvent = createTrackMouseEvent(50);

    component.onTrackMouseMove(fakeEvent);

    expect(component.hoverPercent()).toBe(50);
  });

  it('should clamp hoverPercent to 0 at the left edge', () => {
    const fakeEvent = createTrackMouseEvent(-20);

    component.onTrackMouseMove(fakeEvent);

    expect(component.hoverPercent()).toBe(0);
  });

  it('should clamp hoverPercent to 100 at the right edge', () => {
    const fakeEvent = createTrackMouseEvent(200);

    component.onTrackMouseMove(fakeEvent);

    expect(component.hoverPercent()).toBe(100);
  });

  it('should clear hoverPercent on mouse leave', () => {
    component.hoverPercent.set(42);

    component.onTrackMouseLeave();

    expect(component.hoverPercent()).toBeNull();
  });

  it('should return null for hoverTime when not hovering', () => {
    expect(component.hoverTime()).toBeNull();
  });

  it('should return a HH:mm formatted hoverTime when hovering', () => {
    component.hoverPercent.set(50);

    expect(component.hoverTime()).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should return a HH:mm formatted playheadTime', () => {
    expect(component.playheadTime()).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should render the track background and fill', () => {
    expect(fixture.nativeElement.querySelector('.timeline__track-bg')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.timeline__downloaded-segment')).not.toBeNull();
  });

  it('should render the playhead inside the track area', () => {
    expect(fixture.nativeElement.querySelector('.timeline__track-area .timeline__playhead')).not.toBeNull();
  });

  it('should not render hover marker when not hovering', () => {
    expect(fixture.nativeElement.querySelector('.timeline__hover-marker')).toBeNull();
  });

  it('should render hover marker and tooltip when hovering', () => {
    component.hoverPercent.set(30);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.timeline__hover-marker')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.timeline__hover-tooltip')).not.toBeNull();
  });

  it('should show a HH:mm time in the hover tooltip', () => {
    component.hoverPercent.set(30);
    fixture.detectChanges();

    const tooltip = fixture.nativeElement.querySelector('.timeline__hover-tooltip') as HTMLElement;

    expect(tooltip.textContent?.trim()).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should emit scrub events from pointer dragging', () => {
    const scrubStartSpy = spyOn(component.scrubStart, 'emit');
    const scrubSpy = spyOn(component.scrub, 'emit');
    const scrubEndSpy = spyOn(component.scrubEnd, 'emit');

    component.onTrackPointerDown(createTrackPointerEvent(25));
    component.onTrackPointerMove(createTrackPointerEvent(50));
    component.onTrackPointerUp(createTrackPointerEvent(75));

    expect(scrubStartSpy).toHaveBeenCalledTimes(1);
    expect(scrubSpy).toHaveBeenCalledWith(rangeStartTs + 15 * 60_000);
    expect(scrubSpy).toHaveBeenCalledWith(rangeStartTs + 30 * 60_000);
    expect(scrubEndSpy).toHaveBeenCalledWith(rangeStartTs + 45 * 60_000);
  });

  it('should emit goLive when live marker is activated', () => {
    const goLiveSpy = spyOn(component.goLive, 'emit');

    component.onGoLive();

    expect(goLiveSpy).toHaveBeenCalledTimes(1);
  });
});
