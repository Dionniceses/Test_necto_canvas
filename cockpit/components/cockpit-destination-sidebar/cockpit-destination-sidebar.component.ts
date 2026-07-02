import { Component, ViewEncapsulation, inject, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { CockpitDestinationSidebarData } from '../../interfaces/cockpit-destination-sidebar.interface';
import { StreamWorkerService } from '../../services/stream-worker.service';
import { HttpStatusPipe } from '@features/cockpit/pipes/http-status.pipe';

@Component({
  selector: 'app-cockpit-destination-sidebar',
  imports: [TranslateModule, HttpStatusPipe],
  templateUrl: './cockpit-destination-sidebar.component.html',
  styleUrl: './cockpit-destination-sidebar.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class CockpitDestinationSidebarComponent {
  visible = input(false);
  destinationName = input<string | null>(null);
  visibleChange = output<boolean>();
  closed = output<void>();

  #streamWorkerService = inject(StreamWorkerService);

  sidebarData = toSignal(
    toObservable(this.destinationName).pipe(
      map((destinationName) => destinationName?.trim() ?? ''),
      distinctUntilChanged(),
      switchMap((destinationName) => {
        if (!destinationName) {
          return of<CockpitDestinationSidebarData | null>(null);
        }

        return this.#streamWorkerService.observeDestination(destinationName).pipe(startWith(null));
      }),
    ),
    { initialValue: null },
  );

  onVisibleChange(visible: boolean): void {
    this.visibleChange.emit(visible);
  }

  onClose(): void {
    this.closed.emit();
  }

  onRequestClick(requestId: string): void {
    this.#streamWorkerService.selectRequest(requestId);
  }

  isSuccessStatus(responseCode: number | null): boolean {
    return responseCode !== null && responseCode >= 200 && responseCode < 300;
  }

  isAmberStatus(responseCode: number | null): boolean {
    return (
      responseCode !== null &&
      ((responseCode >= 100 && responseCode < 200) || (responseCode >= 300 && responseCode < 400))
    );
  }

  isErrorStatus(responseCode: number | null): boolean {
    return responseCode !== null && responseCode >= 400;
  }
}
