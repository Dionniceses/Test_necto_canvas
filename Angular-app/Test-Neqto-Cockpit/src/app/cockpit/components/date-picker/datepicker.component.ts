import { Component, computed, output, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { DatePickerModule } from 'primeng/datepicker';

@Component({
  selector: 'app-datepicker',
  imports: [ReactiveFormsModule, DatePickerModule],
  templateUrl: './datepicker.component.html',
  styleUrl: './datepicker.component.scss',
})
export class DatepickerComponent {
  readonly dateChange = output<Date>();

  readonly selectedDate = new FormControl<Date | null>(new Date());
  readonly #selectedDateSignal = signal<Date | null>(new Date());

  readonly maxDate = new Date();

  readonly minDate = computed(() => {
    const thirtyDaysAgo = new Date(this.maxDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return thirtyDaysAgo;
  });

  readonly isPreviousDayDisabled = computed(() => {
    const selected = this.#selectedDateSignal();
    if (!selected) return false;

    const prevMidnight = new Date(selected);
    prevMidnight.setDate(prevMidnight.getDate() - 1);
    prevMidnight.setHours(0, 0, 0, 0);

    const minMidnight = new Date(this.minDate());
    minMidnight.setHours(0, 0, 0, 0);

    return prevMidnight.getTime() < minMidnight.getTime();
  });

  readonly isNextDayDisabled = computed(() => {
    const selected = this.#selectedDateSignal();
    if (!selected) return false;

    const nextMidnight = new Date(selected);
    nextMidnight.setDate(nextMidnight.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);

    const maxMidnight = new Date(this.maxDate);
    maxMidnight.setHours(0, 0, 0, 0);

    return nextMidnight.getTime() > maxMidnight.getTime();
  });

  constructor() {
    this.selectedDate.valueChanges.subscribe((value) => {
      this.#selectedDateSignal.set(value);
      if (value) {
        this.dateChange.emit(value);
      }
    });
  }

  previousDay(): void {
    if (this.isPreviousDayDisabled()) return;

    const current = this.selectedDate.value ?? new Date();
    const newDate = new Date(current);
    newDate.setDate(newDate.getDate() - 1);
    this.selectedDate.setValue(newDate);
  }

  nextDay(): void {
    if (this.isNextDayDisabled()) return;

    const current = this.selectedDate.value ?? new Date();
    const newDate = new Date(current);
    newDate.setDate(newDate.getDate() + 1);
    this.selectedDate.setValue(newDate);
  }
}
