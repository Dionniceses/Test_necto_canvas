import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PerformanceBudgetService } from '../../services/performance-budget.service';
import { TimelineBarComponent } from './timeline-bar.component';

describe('TimelineBarComponent', () => {
  let component: TimelineBarComponent;
  let fixture: ComponentFixture<TimelineBarComponent>;
  let budgetServiceMock: jasmine.SpyObj<PerformanceBudgetService>;

  beforeEach(async () => {
    budgetServiceMock = jasmine.createSpyObj('PerformanceBudgetService', [], {
      budgetConfig: jasmine.createSpy().and.returnValue({ tickRateMs: 1_000, hitTestingEnabled: true, deferHintEvents: false }),
    });

    await TestBed.configureTestingModule({
      imports: [TimelineBarComponent],
      providers: [{ provide: PerformanceBudgetService, useValue: budgetServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelineBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start with no hover position', () => {
    expect(component.hoverPercent()).toBeNull();
  });

  it('should default to startHour 1 (01:00)', () => {
    expect(component.startHour()).toBe(1);
  });

  it('should expose a positive totalMinutes computed from 01:00 to now', () => {
    expect(component.totalMinutes()).toBeGreaterThan(0);
  });

  it('should set hoverPercent when onTrackMouseMove() is called', () => {
    const fakeEvent = { clientX: 50, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } } as unknown as MouseEvent;

    component.onTrackMouseMove(fakeEvent);

    expect(component.hoverPercent()).toBe(50);
  });

  it('should clamp hoverPercent to 0 at the left edge', () => {
    const fakeEvent = { clientX: -20, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } } as unknown as MouseEvent;

    component.onTrackMouseMove(fakeEvent);

    expect(component.hoverPercent()).toBe(0);
  });

  it('should clamp hoverPercent to 100 at the right edge', () => {
    const fakeEvent = { clientX: 200, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } } as unknown as MouseEvent;

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
    expect(fixture.nativeElement.querySelector('.timeline__track-fill')).not.toBeNull();
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
});

  it('should return a non-empty playheadTime string', () => {
    expect(typeof component.playheadTime()).toBe('string');
    expect(component.playheadTime().length).toBeGreaterThan(0);
  });

  it('should render the track background and fill', () => {
    const bg = fixture.nativeElement.querySelector('.timeline__track-bg') as HTMLElement | null;
    const fill = fixture.nativeElement.querySelector('.timeline__track-fill') as HTMLElement | null;

    expect(bg).not.toBeNull();
    expect(fill).not.toBeNull();
  });

  it('should render the playhead', () => {
    expect(fixture.nativeElement.querySelector('.timeline__playhead')).not.toBeNull();
  });

  it('should not render hover marker when not hovering', () => {
    expect(fixture.nativeElement.querySelector('.timeline__hover-marker')).toBeNull();
  });

  it('should render hover marker when hovering', () => {
    component.hoverPercent.set(30);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.timeline__hover-marker')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.timeline__hover-tooltip')).not.toBeNull();
  });
});


