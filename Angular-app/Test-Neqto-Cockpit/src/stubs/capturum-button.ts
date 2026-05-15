import { Component, input, output } from '@angular/core';

@Component({
  selector: 'cap-button',
  template: `<button [disabled]="disabled()" (click)="onClick.emit()" [class]="styleClass()">{{ label() }}</button>`,
})
export class CapturumButtonComponent {
  readonly label = input<string>('');
  readonly disabled = input<boolean>(false);
  readonly styleClass = input<string>('');

  readonly onClick = output<void>();
}
