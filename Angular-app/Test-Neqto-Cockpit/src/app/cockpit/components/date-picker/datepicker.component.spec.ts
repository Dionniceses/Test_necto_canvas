import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DatepickerComponent } from './datepicker.component';

describe('DatepickerComponent', () => {
  let component: DatepickerComponent;
  let fixture: ComponentFixture<DatepickerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatepickerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DatepickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialise with today as the selected date', () => {
    const today = new Date();
    const selected = component.selectedDate.value!;

    expect(selected.getFullYear()).toBe(today.getFullYear());
    expect(selected.getMonth()).toBe(today.getMonth());
    expect(selected.getDate()).toBe(today.getDate());
  });

  it('should not allow going past today (next-day disabled on today)', () => {
    const today = new Date();
    component.selectedDate.setValue(today);
    fixture.detectChanges();

    expect(component.isNextDayDisabled()).toBeTrue();
  });

  it('should not allow going before minDate (prev-day disabled on minDate)', () => {
    const minDate = component.minDate();
    component.selectedDate.setValue(minDate);
    fixture.detectChanges();

    expect(component.isPreviousDayDisabled()).toBeTrue();
  });

  it('should enable prev-day button when selected date is after minDate', () => {
    const dayAfterMin = new Date(component.minDate());
    dayAfterMin.setDate(dayAfterMin.getDate() + 1);
    component.selectedDate.setValue(dayAfterMin);
    fixture.detectChanges();

    expect(component.isPreviousDayDisabled()).toBeFalse();
  });

  it('should enable next-day button when selected date is before today', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    component.selectedDate.setValue(yesterday);
    fixture.detectChanges();

    expect(component.isNextDayDisabled()).toBeFalse();
  });

  it('should navigate to the previous day when previousDay() is called', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    component.selectedDate.setValue(yesterday);
    fixture.detectChanges();

    const dayBefore = new Date(yesterday);
    dayBefore.setDate(dayBefore.getDate() - 1);

    component.previousDay();

    const result = component.selectedDate.value!;
    expect(result.getDate()).toBe(dayBefore.getDate());
    expect(result.getMonth()).toBe(dayBefore.getMonth());
  });

  it('should navigate to the next day when nextDay() is called', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    component.selectedDate.setValue(twoDaysAgo);
    fixture.detectChanges();

    const tomorrow = new Date(twoDaysAgo);
    tomorrow.setDate(tomorrow.getDate() + 1);

    component.nextDay();

    const result = component.selectedDate.value!;
    expect(result.getDate()).toBe(tomorrow.getDate());
    expect(result.getMonth()).toBe(tomorrow.getMonth());
  });

  it('should not navigate past today when nextDay() is called on today', () => {
    const today = new Date();
    component.selectedDate.setValue(today);
    fixture.detectChanges();

    component.nextDay();

    const result = component.selectedDate.value!;
    expect(result.getDate()).toBe(today.getDate());
  });

  it('should not navigate before minDate when previousDay() is called on minDate', () => {
    const minDate = component.minDate();
    component.selectedDate.setValue(minDate);
    fixture.detectChanges();

    component.previousDay();

    const result = component.selectedDate.value!;
    expect(result.getDate()).toBe(minDate.getDate());
  });

  it('should emit dateChange when the selected date changes', () => {
    const dateChangeSpy = spyOn(component.dateChange, 'emit');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    component.selectedDate.setValue(yesterday);

    expect(dateChangeSpy).toHaveBeenCalledOnceWith(yesterday);
  });

  it('should emit dateChange when navigating to the previous day', () => {
    const dateChangeSpy = spyOn(component.dateChange, 'emit');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    component.selectedDate.setValue(yesterday);
    dateChangeSpy.calls.reset();

    component.previousDay();

    expect(dateChangeSpy).toHaveBeenCalledTimes(1);
  });

  it('should disable the prev button in the DOM when at minDate', () => {
    component.selectedDate.setValue(component.minDate());
    fixture.detectChanges();

    const prevBtn = fixture.nativeElement.querySelector('.prev-btn') as HTMLButtonElement;
    expect(prevBtn.disabled).toBeTrue();
  });

  it('should disable the next button in the DOM when at today', () => {
    component.selectedDate.setValue(new Date());
    fixture.detectChanges();

    const nextBtn = fixture.nativeElement.querySelector('.next-btn') as HTMLButtonElement;
    expect(nextBtn.disabled).toBeTrue();
  });
});
