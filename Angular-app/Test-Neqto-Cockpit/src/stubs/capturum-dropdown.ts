import { Component, forwardRef, input, output, NgModule } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { MapItem } from './capturum-api';

@Component({
  selector: 'cap-dropdown',
  template: `
    <select (change)="onSelect($event)" [disabled]="isDisabled">
      <option value="" disabled [selected]="!value">{{ placeholder() }}</option>
      @for (opt of options(); track opt.value) {
        <option [value]="opt.value" [selected]="opt.value === value">{{ opt.label }}</option>
      }
    </select>
  `,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CapDropdownComponent),
      multi: true,
    },
  ],
})
export class CapDropdownComponent implements ControlValueAccessor {
  readonly options = input<MapItem[]>([]);
  readonly placeholder = input<string>('');
  readonly panelStyleClass = input<string>('');
  readonly appendTo = input<string>('');

  readonly changeSelection = output<{ value: string | null }>();

  value: string | number | null = null;
  isDisabled = false;

  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(val: unknown): void {
    this.value = val as string | null;
  }

  registerOnChange(fn: (v: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.isDisabled = disabled;
  }

  onSelect(event: Event): void {
    const val = (event.target as HTMLSelectElement).value || null;
    this.value = val;
    this.onChange(val);
    this.onTouched();
    this.changeSelection.emit({ value: val });
  }
}

@NgModule({
  imports: [ReactiveFormsModule, CapDropdownComponent],
  exports: [CapDropdownComponent],
})
export class CapturumDropdownModule {}
