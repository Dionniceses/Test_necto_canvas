import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, NgZone, signal } from '@angular/core';
import { PerformanceBudgetService } from '../../services/performance-budget.service';

@Component({
  selector: 'app-timeline-bar',
  imports: [],
  templateUrl: './timeline-bar.component.html',
  styleUrl: './timeline-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineBarComponent {
  /** Hour the timeline window starts at each day (default 01:00). */
  readonly startHour = signal(1);

  /** Hover position (0-100 %) on the track, null when not hovering. */
  readonly hoverPercent = signal<number | null>(null);

  readonly #nowMs = signal(Date.now());
  readonly #destroyRef = inject(DestroyRef);
  readonly #zone = inject(NgZone);
  readonly #budgetService = inject(PerformanceBudgetService);

  /** Epoch ms of today at startHour:00:00. */
  readonly #startMs = computed(() => {
    const now = new Date(this.#nowMs());
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), this.startHour(), 0, 0, 0).getTime();
  });

  /** Total minutes the timeline spans (startHour to now). */
  readonly totalMinutes = computed(() =>
    Math.max(1, Math.floor((this.#nowMs() - this.#startMs()) / 60_000)),
  );

  /** Lag in ms driven by the current performance-budget tick rate. */
  readonly #lagMs = computed(() => this.#budgetService.budgetConfig().tickRateMs);

  /** Playhead time: now minus lag, formatted HH:mm (24h). */
  readonly playheadTime = computed(() =>
    this.#formatShort(new Date(this.#nowMs() - this.#lagMs())),
  );

  /** Hover tooltip time: absolute clock time at hovered position, HH:mm. */
  readonly hoverTime = computed(() => {
    const pct = this.hoverPercent();
    if (pct === null) return null;
    const ms = this.#startMs() + (pct / 100) * (this.#nowMs() - this.#startMs());
    return this.#formatShort(new Date(ms));
  });

  constructor() {
    this.#zone.runOutsideAngular(() => {
      const id = setInterval(() => this.#nowMs.set(Date.now()), 10_000);
      this.#destroyRef.onDestroy(() => clearInterval(id));
    });
  }

  onTrackMouseMove(event: MouseEvent): void {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    // Position update via CSS variable — bypasses Angular binding entirely.
    el.style.setProperty('--hover-pct', pct + '%');
    this.hoverPercent.set(pct);
  }

  onTrackMouseLeave(): void {
    this.hoverPercent.set(null);
  }

  /** HH:mm (24h). */
  #formatShort(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}
