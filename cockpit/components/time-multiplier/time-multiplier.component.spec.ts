import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TimeMultiplierService } from '../../services/time-multiplier.service';
import { TimeMultiplierComponent } from './time-multiplier.component';

describe('TimeMultiplierComponent', () => {
  let component: TimeMultiplierComponent;
  let fixture: ComponentFixture<TimeMultiplierComponent>;
  let timeMultiplierService: TimeMultiplierService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimeMultiplierComponent, TranslateModule.forRoot()],
    }).compileComponents();

    timeMultiplierService = TestBed.inject(TimeMultiplierService);
    fixture = TestBed.createComponent(TimeMultiplierComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    timeMultiplierService.reset();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the current multiplier label', () => {
    timeMultiplierService.setMultiplier(2);
    fixture.detectChanges();

    const value = fixture.nativeElement.querySelector('.time-multiplier-value') as HTMLOutputElement;

    expect(value.textContent?.trim()).toBe('1/2');
  });

  it('should update the service when the slider changes', () => {
    const slider = fixture.nativeElement.querySelector('.time-multiplier-slider') as HTMLInputElement;

    slider.value = '3';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(timeMultiplierService.divider()).toBe(3);
    expect(timeMultiplierService.multiplier()).toBe(1 / 3);
  });
});
