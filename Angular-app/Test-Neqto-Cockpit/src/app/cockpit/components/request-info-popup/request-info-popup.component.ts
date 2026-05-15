import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CapturumButtonComponent } from '@capturum/ui/button';
import { TranslateModule } from '@ngx-translate/core';
import { CockpitRequestDetails } from '../../interfaces/cockpit-request-details.interface';
import { StreamWorkerService } from '../../services/stream-worker.service';
import { httpStatusCodeGroupedOptions } from '../../../../shared/utils/map-item.util';

const httpStatusLabelByCode = httpStatusCodeGroupedOptions().reduce<Record<number, string>>((labelsByCode, group) => {
  for (const item of group.items) {
    const responseCode = Number(item.value);

    if (!Number.isNaN(responseCode)) {
      labelsByCode[responseCode] = item.label;
    }
  }

  return labelsByCode;
}, {});

@Component({
  selector: 'app-request-info-popup',
  imports: [CapturumButtonComponent, TranslateModule],
  templateUrl: './request-info-popup.component.html',
  styleUrl: './request-info-popup.component.scss',
})
export class RequestInfoPopupComponent {
  readonly requestDetails = signal<CockpitRequestDetails | null>(null);
  readonly isAdvancedExpanded = signal(false);

  #activeRequestId: string | null = null;
  #destroyRef = inject(DestroyRef);
  #streamWorkerService = inject(StreamWorkerService);

  readonly responseCode = computed<number | null>(() => {
    const details = this.requestDetails();

    if (typeof details?.response_code !== 'number') {
      return null;
    }

    return details.response_code;
  });

  readonly responseStatusLabel = computed<string | null>(() => {
    const responseCode = this.responseCode();

    if (responseCode === null) {
      return null;
    }

    return httpStatusLabelByCode[responseCode] ?? `${responseCode} Unknown`;
  });

  readonly flow = computed<string | null>(() => this.#resolveStringField(this.requestDetails(), 'flow'));

  readonly destination = computed<string | null>(() => this.#resolveStringField(this.requestDetails(), 'destination'));

  readonly ttfbDisplay = computed<string | null>(() => {
    const details = this.requestDetails();

    if (!details) {
      return null;
    }

    if (typeof details.ttfb === 'number') {
      return `${details.ttfb} ms`;
    }

    const hintTtfb = this.#resolveHintTtfb(details);

    if (hintTtfb === null) {
      return null;
    }

    return `${hintTtfb} ms (hint)`;
  });

  readonly payloadSizeDisplay = computed<string | null>(() => {
    const payloadSize = this.#resolveNumberField(this.requestDetails(), 'payload_size');

    if (payloadSize === null) {
      return null;
    }

    return this.#formatBytes(payloadSize);
  });

  readonly responseSizeDisplay = computed<string | null>(() => {
    const responseSize = this.#resolveNumberField(this.requestDetails(), 'response_size');

    if (responseSize === null) {
      return null;
    }

    return this.#formatBytes(responseSize);
  });

  readonly hasAdvancedDetails = computed<boolean>(
    () => this.ttfbDisplay() !== null || this.payloadSizeDisplay() !== null || this.responseSizeDisplay() !== null,
  );

  constructor() {
    this.#streamWorkerService.selectedRequestId$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe((requestId) => {
      if (this.#activeRequestId !== requestId) {
        this.isAdvancedExpanded.set(false);
      }

      this.#activeRequestId = requestId;
      this.requestDetails.set(requestId ? { id: requestId } : null);
    });

    this.#streamWorkerService.selectedRequestDetails$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((requestDetails) => {
        if (!this.#activeRequestId) {
          this.requestDetails.set(null);

          return;
        }

        if (requestDetails && String(requestDetails.id) !== this.#activeRequestId) {
          return;
        }

        this.requestDetails.set(requestDetails ?? { id: this.#activeRequestId });
      });
  }

  onToggleAdvanced(): void {
    this.isAdvancedExpanded.update((isAdvancedExpanded) => !isAdvancedExpanded);
  }

  onClose(): void {
    this.#streamWorkerService.selectRequest(null);
  }

  #resolveStringField(details: CockpitRequestDetails | null, field: 'flow' | 'destination'): string | null {
    const value = details?.[field];

    if (typeof value !== 'string') {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue ? normalizedValue : null;
  }

  #resolveNumberField(details: CockpitRequestDetails | null, field: 'payload_size' | 'response_size'): number | null {
    const value = details?.[field];

    if (typeof value !== 'number' || value < 0) {
      return null;
    }

    return value;
  }

  #resolveHintTtfb(details: CockpitRequestDetails): number | null {
    if (typeof details['ttfb-hint'] === 'number') {
      return details['ttfb-hint'];
    }

    if (typeof details.ttfb_hint === 'number') {
      return details.ttfb_hint;
    }

    return null;
  }

  #formatBytes(byteCount: number): string {
    return `${byteCount.toLocaleString()} bytes`;
  }
}
