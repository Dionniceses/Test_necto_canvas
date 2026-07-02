import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { PixiCanvasComponent } from '@features/cockpit/components/pixi-canvas/pixi-canvas.component';
import { CockpitDestinationSidebarComponent } from '@features/cockpit/components/cockpit-destination-sidebar/cockpit-destination-sidebar.component';
import { RequestInfoPopupComponent } from '@features/cockpit/components/request-info-popup/request-info-popup.component';
import { PauseLiveComponent } from '../../components/pause-live/pause-live.component';
import { DatepickerComponent } from '../../components/date-picker/datepicker.component';
import { TimelineBarComponent } from '../../components/timeline-bar/timeline-bar.component';
import { TimeMultiplierComponent } from '../../components/time-multiplier/time-multiplier.component';
import { AdvancedSettingsComponent } from '@features/cockpit/components/advanced-settings/advanced-settings.component';
import { CockpitTimelineCoordinatorService } from '../../services/cockpit-timeline-coordinator.service';
import { PerformanceBudgetService } from '../../services/performance-budget.service';
import { CockpitTimelineStore } from '../../services/cockpit-timeline-store.service';

@Component({
  selector: 'app-cockpit-overview',
  imports: [
    PixiCanvasComponent,
    CockpitDestinationSidebarComponent,
    RequestInfoPopupComponent,
    PauseLiveComponent,
    DatepickerComponent,
    TimelineBarComponent,
    TimeMultiplierComponent,
    AdvancedSettingsComponent,
  ],
  templateUrl: './cockpit-overview.component.html',
  styleUrl: './cockpit-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CockpitOverviewComponent implements OnInit, OnDestroy {
  #timelineCoordinator = inject(CockpitTimelineCoordinatorService);
  #performanceBudgetService = inject(PerformanceBudgetService);
  #timelineStore = inject(CockpitTimelineStore);

  readonly isPaused = this.#timelineCoordinator.isPaused;
  readonly isLive = this.#timelineCoordinator.isLive;
  readonly isConnected = this.#timelineCoordinator.isConnected;
  readonly availableRange = this.#timelineCoordinator.availableRange;
  readonly downloadedRanges = this.#timelineCoordinator.downloadedRanges;
  readonly playheadTs = this.#timelineCoordinator.playheadTs;
  readonly liveTs = this.#timelineCoordinator.liveTs;
  readonly selectedDate = this.#timelineCoordinator.selectedDate;
  readonly currentFps = this.#performanceBudgetService.averageFps;
  readonly isBuffering = computed(() => this.#timelineStore.pendingSnapshots().length > 0);

  destinationSidebarVisible = signal(false);
  selectedDestinationName = signal<string | null>(null);

  ngOnInit(): void {
    this.onGoLive();
  }

  ngOnDestroy(): void {
    this.#timelineStore.clearDownloadedRanges();
  }

  onTogglePause(): void {
    this.#timelineCoordinator.togglePause();
  }

  onGoLive(): void {
    this.#timelineCoordinator.goLive();
  }

  onDateChange(date: Date): void {
    this.#timelineCoordinator.openDate(date);
  }

  onTimelineScrubStart(): void {
    this.#timelineCoordinator.startScrub();
  }

  onTimelineScrub(playheadTs: number): void {
    this.#timelineCoordinator.scrubTo(playheadTs);
  }

  onTimelineScrubEnd(playheadTs: number): void {
    this.#timelineCoordinator.endScrub(playheadTs);
  }

  onDestinationSidebarVisibleChange(visible: boolean): void {
    this.destinationSidebarVisible.set(visible);

    if (!visible) {
      this.selectedDestinationName.set(null);
    }
  }

  onDestinationSelected(name: string | null): void {
    this.selectedDestinationName.set(name);
    this.destinationSidebarVisible.set(!!name);
  }
}
