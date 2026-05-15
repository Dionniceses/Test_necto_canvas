import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { CockpitRequestDetails } from '../interfaces/cockpit-request-details.interface';
import {
  CockpitMockStreamEvent,
  COCKPIT_MOCK_STREAM_PATH,
  CockpitStreamWorkerStartNdjsonMessage,
  CockpitStreamWorkerStopMessage,
  CockpitStreamWorkerOutgoingMessage,
  CockpitStreamWorkerUpdateBudgetStateMessage,
} from '../interfaces/cockpit-stream.interface';
import { BudgetConfig, BudgetState, PerformanceBudgetService } from './performance-budget.service';

@Injectable({
  providedIn: 'root',
})
export class StreamWorkerService {
  public readonly mockStreamPath = COCKPIT_MOCK_STREAM_PATH;
  public readonly localMockServerOrigin = 'http://localhost:8788';

  #streamSubject = new Subject<CockpitMockStreamEvent>();
  #streamErrorSubject = new Subject<Error>();
  #requestDetailsById = new Map<string, CockpitRequestDetails>();
  #pendingTimeoutIds = new Set<ReturnType<typeof setTimeout>>();
  #selectedRequestIdSubject = new BehaviorSubject<string | null>(null);
  #selectedRequestDetailsSubject = new BehaviorSubject<CockpitRequestDetails | null>(null);
  #stopMessage: CockpitStreamWorkerStopMessage = { type: 'stop' };

  public readonly streamErrors$ = this.#streamErrorSubject.asObservable();
  public readonly selectedRequestId$ = this.#selectedRequestIdSubject.asObservable();
  public readonly selectedRequestDetails$ = this.#selectedRequestDetailsSubject.asObservable();

  #streamWorker: Worker | null = null;
  #bridgeStarted = false;
  #destroyRef = inject(DestroyRef);
  #performanceBudgetService = inject(PerformanceBudgetService);

  public readonly streamEvents$ = this.#streamSubject.asObservable();

  constructor() {
    this.#destroyRef.onDestroy(() => {
      for (const id of this.#pendingTimeoutIds) {
        clearTimeout(id);
      }

      this.#pendingTimeoutIds.clear();
      this.closeMockStream();
      this.resetRequestDetails();
      this.#streamSubject.complete();
      this.#streamErrorSubject.complete();
      this.#selectedRequestIdSubject.complete();
      this.#selectedRequestDetailsSubject.complete();
    });

    effect(() => {
      this.#sendBudgetStateToWorker(
        this.#performanceBudgetService.budgetState(),
        this.#performanceBudgetService.budgetConfig(),
      );
    });
  }

  public selectRequest(requestId: string | number | null): void {
    const normalizedRequestId = requestId === null ? null : String(requestId).trim();
    const nextRequestId = normalizedRequestId ? normalizedRequestId : null;

    this.#selectedRequestIdSubject.next(nextRequestId);

    if (!nextRequestId) {
      this.#selectedRequestDetailsSubject.next(null);

      return;
    }

    const selectedRequestDetails = this.#requestDetailsById.get(nextRequestId) ?? { id: nextRequestId };

    this.#selectedRequestDetailsSubject.next(this.#cloneRequestDetails(selectedRequestDetails));
  }

  public getRequestDetailsById(requestId: string | number): CockpitRequestDetails | null {
    const normalizedRequestId = String(requestId).trim();

    if (!normalizedRequestId) {
      return null;
    }

    const requestDetails = this.#requestDetailsById.get(normalizedRequestId) ?? null;

    return this.#cloneRequestDetails(requestDetails);
  }

  public resetRequestDetails(): void {
    this.#requestDetailsById.clear();
    this.#selectedRequestIdSubject.next(null);
    this.#selectedRequestDetailsSubject.next(null);
  }

  public openMockStream(): Observable<CockpitMockStreamEvent> {
    return this.openNdjsonStream(this.#resolveMockStreamUrl());
  }

  public openNdjsonStream(url: string, headers?: Record<string, string>): Observable<CockpitMockStreamEvent> {
    this.#ensureBridgeStarted();

    if (!this.#streamWorker) {
      this.#reportError('Web worker is unavailable. NDJSON stream cannot be opened.');

      return this.#streamSubject.asObservable();
    }

    const startNdjsonMessage: CockpitStreamWorkerStartNdjsonMessage = {
      type: 'start-ndjson',
      url,
      headers,
    };

    this.#streamWorker.postMessage(startNdjsonMessage);

    return this.#streamSubject.asObservable();
  }

  public closeMockStream(): void {
    if (this.#streamWorker) {
      this.#streamWorker.postMessage(this.#stopMessage);
    }

    this.#destroyWorker();
    this.#bridgeStarted = false;
  }

  #ensureBridgeStarted(): void {
    if (this.#bridgeStarted) {
      return;
    }

    this.#bridgeStarted = true;
    this.#initWorker();

    if (!this.#streamWorker) {
      this.#reportError('Web worker is unavailable. Cockpit stream cannot start.');
    }
  }

  #initWorker(): void {
    if (typeof Worker === 'undefined' || typeof window === 'undefined' || this.#streamWorker) {
      return;
    }

    try {
      this.#streamWorker = new Worker(new URL('./cockpit-stream.worker', import.meta.url), { type: 'module' });

      this.#streamWorker.onmessage = ({ data }: MessageEvent<CockpitStreamWorkerOutgoingMessage>) => {
        if (!data) {
          return;
        }

        if (data.type === 'event') {
          const requestId = this.#ingestRequestDetails(data.event);

          this.#streamSubject.next(data.event);
          this.#emitSelectedRequestDetailsIfChanged(requestId);

          return;
        }

        if (data.type === 'BATCH_UPDATE') {
          const maxAge = data.data.reduce((max, item) => Math.max(max, item.ageMs), 0);

          for (const { event, ageMs } of data.data) {
            const delay = Math.round(maxAge - ageMs);

            const ingestAndEmit = (): void => {
              const requestId = this.#ingestRequestDetails(event);

              this.#streamSubject.next(event);
              this.#emitSelectedRequestDetailsIfChanged(requestId);
            };

            if (delay <= 0) {
              ingestAndEmit();

              continue;
            }

            const timeoutId = setTimeout(() => {
              this.#pendingTimeoutIds.delete(timeoutId);
              ingestAndEmit();
            }, delay);

            this.#pendingTimeoutIds.add(timeoutId);
          }

          return;
        }

        if (data.type === 'status' && data.status === 'error') {
          this.#reportError(data.detail ?? 'Cockpit worker reported a stream error.');
        }
      };

      this.#streamWorker.onerror = () => {
        this.#reportError('Cockpit worker crashed while handling stream data.');
        this.closeMockStream();
      };

      this.#sendBudgetStateToWorker(
        this.#performanceBudgetService.budgetState(),
        this.#performanceBudgetService.budgetConfig(),
      );
    } catch {
      this.#streamWorker = null;
      this.#reportError('Failed to initialize cockpit web worker.');
    }
  }

  #reportError(message: string): void {
    this.#streamErrorSubject.next(new Error(message));
  }

  #sendBudgetStateToWorker(state: BudgetState, config: BudgetConfig): void {
    if (!this.#streamWorker) {
      return;
    }

    const message: CockpitStreamWorkerUpdateBudgetStateMessage = {
      type: 'update-budget-state',
      state,
      tickRateMs: config.tickRateMs,
      deferHintEvents: config.deferHintEvents,
    };

    this.#streamWorker.postMessage(message);
  }

  #ingestRequestDetails(event: CockpitMockStreamEvent): string {
    const requestId = String(event.id).trim();

    if (!requestId) {
      return '';
    }

    const requestDetails = this.#requestDetailsById.get(requestId) ?? { id: requestId };
    const mergedRequestDetails: CockpitRequestDetails = {
      ...requestDetails,
      ...event,
      id: requestId,
    };

    this.#requestDetailsById.set(requestId, mergedRequestDetails);

    return requestId;
  }

  #emitSelectedRequestDetailsIfChanged(changedRequestId: string): void {
    if (!changedRequestId) {
      return;
    }

    const selectedRequestId = this.#selectedRequestIdSubject.getValue();

    if (!selectedRequestId || selectedRequestId !== changedRequestId) {
      return;
    }

    const selectedRequestDetails = this.#requestDetailsById.get(selectedRequestId) ?? null;

    this.#selectedRequestDetailsSubject.next(this.#cloneRequestDetails(selectedRequestDetails));
  }

  #cloneRequestDetails(requestDetails: CockpitRequestDetails | null): CockpitRequestDetails | null {
    if (!requestDetails) {
      return null;
    }

    return { ...requestDetails };
  }

  #destroyWorker(): void {
    if (!this.#streamWorker) {
      return;
    }

    this.#streamWorker.terminate();
    this.#streamWorker = null;
  }

  #resolveMockStreamUrl(): string {
    if (typeof window === 'undefined') {
      return this.mockStreamPath;
    }

    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';

    if (isLocalHost) {
      return `${this.localMockServerOrigin}${this.mockStreamPath}`;
    }

    return this.mockStreamPath;
  }
}
