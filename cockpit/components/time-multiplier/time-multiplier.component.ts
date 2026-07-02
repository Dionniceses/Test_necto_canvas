import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { TimeMultiplierService } from '../../services/time-multiplier.service';

@Component({
  selector: 'app-time-multiplier',
  imports: [TranslateModule],
  templateUrl: './time-multiplier.component.html',
  styleUrl: './time-multiplier.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimeMultiplierComponent {
  readonly #timeMultiplierService = inject(TimeMultiplierService);

  readonly minMultiplier = this.#timeMultiplierService.minMultiplier;
  readonly maxMultiplier = this.#timeMultiplierService.maxMultiplier;
  readonly step = this.#timeMultiplierService.step;
  readonly divider = this.#timeMultiplierService.divider;
  readonly multiplierLabel = this.#timeMultiplierService.multiplierLabel;

  onMultiplierInput(event: Event): void {
    const input = event.target as HTMLInputElement;

    this.#timeMultiplierService.setMultiplier(input.valueAsNumber);
  }
}
