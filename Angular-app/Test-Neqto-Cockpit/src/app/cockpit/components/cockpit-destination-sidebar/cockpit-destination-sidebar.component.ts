import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Drawer } from 'primeng/drawer';
import {
  CockpitDestinationSidebarData,
  CockpitDestinationSidebarListItem,
} from '../../interfaces/cockpit-destination-sidebar.interface';
import {
  DestinationSidebarEventState,
  DestinationSidebarState,
} from '../../interfaces/cockpit-destination-sidebar-state.interface';
import { CockpitMockStreamEvent } from '../../interfaces/cockpit-stream.interface';
import { StreamWorkerService } from '../../services/stream-worker.service';

@Component({
  selector: 'app-cockpit-destination-sidebar',
  imports: [Drawer],
  templateUrl: './cockpit-destination-sidebar.component.html',
  styleUrl: './cockpit-destination-sidebar.component.scss',
})
export class CockpitDestinationSidebarComponent {
  visible = input(false);
  destinationName = input<string | null>(null);
  visibleChange = output<boolean>();

  sidebarData = signal<CockpitDestinationSidebarData | null>(null);

  #destroyRef = inject(DestroyRef);
  #streamWorkerService = inject(StreamWorkerService);
  #destinationStateByKey = new Map<string, DestinationSidebarState>();
  #destinationKeyByRequestId = new Map<string, string>();
  #selectedDestinationKey: string | null = null;

  readonly #timeWindowMinutes = 30;
  readonly #timeWindowMs = this.#timeWindowMinutes * 60 * 1000;
  readonly #maxEventItems = 50;
  readonly #maxErrorItems = 20;
  readonly #maxStoredEvents = 500;

  constructor() {
    effect(() => {
      const destinationName = this.destinationName();
      const destinationKey = this.#normalizeDestinationKey(destinationName);

      this.#selectedDestinationKey = destinationKey;

      if (!destinationKey) {
        this.sidebarData.set(null);

        return;
      }

      this.#refreshSidebarData();
    });

    this.#streamWorkerService.streamEvents$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe((event) => {
      this.#ingestEvent(event);
    });
  }

  onVisibleChange(visible: boolean): void {
    this.visibleChange.emit(visible);
  }

  onRequestClick(requestId: string): void {
    this.#streamWorkerService.selectRequest(requestId);
  }

  #ingestEvent(event: CockpitMockStreamEvent): void {
    const requestId = String(event.id).trim();
    const destinationName = typeof event.destination === 'string' ? event.destination.trim() : '';
    const destinationKey = this.#resolveDestinationKey(requestId, destinationName);

    if (!destinationKey || !requestId) {
      return;
    }

    const state = this.#destinationStateByKey.get(destinationKey) ?? {
      destinationName: destinationName || this.destinationName()?.trim() || 'Unknown destination',
      events: [],
    };
    const existingIndex = state.events.findIndex((entry) => entry.requestId === requestId);

    if (existingIndex >= 0) {
      state.events.splice(existingIndex, 1);
    }

    if (destinationName) {
      state.destinationName = destinationName;
    }

    state.events.unshift({
      requestId,
      timestampMs: this.#resolveEventTimestampMs(event),
      responseCode: this.#resolveResponseCode(
        event.response_code ?? event['responseCode'] ?? event['status_code'] ?? event['status'],
      ),
      flow: typeof event.flow === 'string' && event.flow.trim() ? event.flow.trim() : null,
    });

    if (state.events.length > this.#maxStoredEvents) {
      state.events.length = this.#maxStoredEvents;
    }

    this.#destinationStateByKey.set(destinationKey, state);

    if (this.#selectedDestinationKey === destinationKey) {
      this.#refreshSidebarData();
    }
  }

  #refreshSidebarData(): void {
    const selectedDestinationKey = this.#selectedDestinationKey;

    if (!selectedDestinationKey) {
      this.sidebarData.set(null);

      return;
    }

    const state = this.#destinationStateByKey.get(selectedDestinationKey);

    if (!state) {
      this.sidebarData.set({
        metricsLoading: true,
        errorRatePercentage: null,
        processedResponsesLastWindow: 0,
        processedWindowMinutes: this.#timeWindowMinutes,
        eventsLoading: true,
        errorsLoading: true,
        events: [],
        errors: [],
      });

      return;
    }

    const nowMs = Date.now();
    const relevantEvents = state.events.filter(
      (entry) => entry.responseCode !== null && nowMs - entry.timestampMs <= this.#timeWindowMs,
    );
    const totalResponses = relevantEvents.length;
    const errorResponses = relevantEvents.filter((entry) => (entry.responseCode ?? 0) > 399).length;
    const events = state.events
      .filter((entry) => entry.responseCode !== null)
      .slice(0, this.#maxEventItems)
      .map((entry) => this.#toListItem(entry));
    const errors = state.events
      .filter((entry) => (entry.responseCode ?? 0) > 399)
      .slice(0, this.#maxErrorItems)
      .map((entry) => this.#toListItem(entry));

    this.sidebarData.set({
      metricsLoading: totalResponses === 0,
      errorRatePercentage: totalResponses === 0 ? null : Number(((errorResponses / totalResponses) * 100).toFixed(1)),
      processedResponsesLastWindow: totalResponses,
      processedWindowMinutes: this.#timeWindowMinutes,
      eventsLoading: events.length === 0,
      errorsLoading: state.events.length === 0,
      events,
      errors,
    });
  }

  #toListItem(entry: DestinationSidebarEventState): CockpitDestinationSidebarListItem {
    return {
      requestId: entry.requestId,
      responseCode: entry.responseCode,
      flow: entry.flow,
      timestampLabel: new Date(entry.timestampMs).toLocaleTimeString(),
    };
  }

  #normalizeDestinationKey(destinationName: string | null): string | null {
    if (!destinationName) {
      return null;
    }

    const normalized = destinationName.trim().toLowerCase();

    return normalized ? normalized : null;
  }

  #resolveEventTimestampMs(event: CockpitMockStreamEvent): number {
    if (typeof event.ts !== 'number' || !Number.isFinite(event.ts)) {
      return Date.now();
    }

    if (event.ts > 1_000_000_000_000) {
      return event.ts;
    }

    return event.ts * 1000;
  }

  #resolveResponseCode(responseCode: unknown): number | null {
    if (typeof responseCode === 'number') {
      return Number.isFinite(responseCode) ? responseCode : null;
    }

    if (typeof responseCode !== 'string') {
      return null;
    }

    const trimmed = responseCode.trim();

    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);

    return Number.isFinite(parsed) ? parsed : null;
  }

  #resolveDestinationKey(requestId: string, destinationName: string): string | null {
    if (!requestId) {
      return null;
    }

    const destinationKey = this.#normalizeDestinationKey(destinationName);

    if (destinationKey) {
      this.#destinationKeyByRequestId.set(requestId, destinationKey);

      return destinationKey;
    }

    return this.#destinationKeyByRequestId.get(requestId) ?? null;
  }
}
