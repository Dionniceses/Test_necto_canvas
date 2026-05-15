import { Component, input, output } from '@angular/core';
import { CapturumButtonComponent } from '@capturum/ui/button';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-pause-live',
  imports: [CapturumButtonComponent, TranslateModule],
  templateUrl: './pause-live.component.html',
  styleUrl: './pause-live.component.scss',
})
export class PauseLiveComponent {
  readonly isPaused = input<boolean>(false);
  readonly isLive = input<boolean>(true);
  readonly bufferedEventCount = input<number>(0);
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
