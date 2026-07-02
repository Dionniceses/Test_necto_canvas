import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CockpitTimelineRange } from '../../interfaces/cockpit-timeline.interface';

@Component({
  selector: 'app-timeline-bar',
  imports: [],
  templateUrl: './timeline-bar.component.html',
  styleUrl: './timeline-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineBarComponent {
  readonly availableRange = input<CockpitTimelineRange | null>(null);
  readonly downloadedRanges = input<CockpitTimelineRange[]>([]);
  readonly playheadTs = input(Date.now());
  readonly liveTs = input(Date.now());

  readonly scrubStart = output<void>();
  readonly scrub = output<number>();
  readonly scrubEnd = output<number>();
  readonly goLive = output<void>();

  readonly hoverPercent = signal<number | null>(null);
  readonly #isDragging = signal(false);

  readonly #effectiveRange = computed<CockpitTimelineRange>(() => {
    const availableRange = this.availableRange();

    if (availableRange) {
      return availableRange;
    }

    const liveTs = this.liveTs();
    const dayStartTs = new Date(
      new Date(liveTs).getFullYear(),
      new Date(liveTs).getMonth(),
      new Date(liveTs).getDate(),
    ).getTime();

    return { fromTs: dayStartTs, toTs: Math.max(dayStartTs + 1, liveTs) };
  });

  readonly downloadedSegments = computed(() => {
    const range = this.#effectiveRange();
    const spanMs = Math.max(1, range.toTs - range.fromTs);

    return this.downloadedRanges()
      .map((downloadedRange, index) => {
        const fromTs = Math.max(range.fromTs, downloadedRange.fromTs);
        const toTs = Math.min(range.toTs, downloadedRange.toTs);

        if (toTs < fromTs) {
          return null;
        }

        return {
          id: `${fromTs}-${toTs}-${index}`,
          left: ((fromTs - range.fromTs) / spanMs) * 100,
          width: Math.max(0.4, ((toTs - fromTs) / spanMs) * 100),
        };
      })
      .filter((segment): segment is { id: string; left: number; width: number } => segment !== null);
  });

  readonly playheadPercent = computed(() => this.#timestampToPercent(this.playheadTs()));
  readonly livePercent = computed(() => this.#timestampToPercent(this.liveTs()));
  readonly playheadTime = computed(() => this.#formatShort(new Date(this.playheadTs())));
  readonly hoverTime = computed(() => {
    const pct = this.hoverPercent();

    if (pct === null) return null;
    const ms = this.#percentToTimestamp(pct);

    return this.#formatShort(new Date(ms));
  });

  onTrackMouseMove(event: MouseEvent): void {
    const pct = this.#eventToPercent(event);

    this.hoverPercent.set(pct);
  }

  onTrackMouseLeave(): void {
    this.hoverPercent.set(null);
  }

  onTrackPointerDown(event: PointerEvent): void {
    const timestampMs = this.#eventToTimestamp(event);

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.#isDragging.set(true);
    this.scrubStart.emit();
    this.scrub.emit(timestampMs);
    event.preventDefault();
  }

  onTrackPointerMove(event: PointerEvent): void {
    if (!this.#isDragging()) {
      return;
    }

    this.scrub.emit(this.#eventToTimestamp(event));
    event.preventDefault();
  }

  onTrackPointerUp(event: PointerEvent): void {
    if (!this.#isDragging()) {
      return;
    }

    this.#isDragging.set(false);
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    this.scrubEnd.emit(this.#eventToTimestamp(event));
    event.preventDefault();
  }

  onTrackPointerCancel(event: PointerEvent): void {
    if (!this.#isDragging()) {
      return;
    }

    this.#isDragging.set(false);
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    this.scrubEnd.emit(this.playheadTs());
  }

  onGoLive(): void {
    this.goLive.emit();
  }

  #eventToTimestamp(event: MouseEvent): number {
    return this.#percentToTimestamp(this.#eventToPercent(event));
  }

  #eventToPercent(event: MouseEvent): number {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();

    return Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
  }

  #timestampToPercent(timestampMs: number): number {
    const range = this.#effectiveRange();
    const spanMs = Math.max(1, range.toTs - range.fromTs);

    return Math.max(0, Math.min(100, ((timestampMs - range.fromTs) / spanMs) * 100));
  }

  #percentToTimestamp(percent: number): number {
    const range = this.#effectiveRange();

    return range.fromTs + (percent / 100) * (range.toTs - range.fromTs);
  }

  #formatShort(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');

    return `${h}:${m}`;
  }
}
