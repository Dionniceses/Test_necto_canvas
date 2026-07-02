import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-pause-live',
  imports: [TranslateModule],
  templateUrl: './pause-live.component.html',
  styleUrl: './pause-live.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PauseLiveComponent {
  readonly isPaused = input<boolean>(false);
  readonly isLive = input<boolean>(true);
  readonly isConnected = input<boolean>(true);
  readonly fps = input<number>(0);

  readonly pauseToggled = output<void>();
  readonly goLive = output<void>();

  onTogglePause(): void {
    this.pauseToggled.emit();
  }

  onGoLive(): void {
    this.goLive.emit();
  }
}
