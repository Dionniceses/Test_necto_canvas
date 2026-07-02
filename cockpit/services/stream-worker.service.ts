// Acts as the communication bridge between the Angular main thread and the background stream processing Web Worker.
import { DestroyRef, Injectable, effect, inject, signal, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject, throwError } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { CockpitDestinationSidebarData } from '../interfaces/cockpit-destination-sidebar.interface';
import { CockpitRequestDetails } from '../interfaces/cockpit-request-details.interface';
import {
  CockpitMockStreamEvent,
  CockpitStreamEventSource,
  CockpitStreamedEvent,
  CockpitStreamWorkerGetRequestDetailsMessage,
  CockpitStreamWorkerReleaseRequestDetailsMessage,
  CockpitStreamWorkerStartSnapshotMessage,
  CockpitStreamWorkerStartNdjsonMessage,
  CockpitStreamWorkerStopMessage,
  CockpitStreamWorkerOutgoingMessage,
  CockpitStreamWorkerSubscribeDestinationMessage,
  CockpitStreamWorkerUnsubscribeDestinationMessage,
  CockpitStreamWorkerUpdateBudgetStateMessage,
  CockpitWorkerIncomingMessageType,
  CockpitWorkerOutgoingMessageType,
} from '../interfaces/cockpit-stream.interface';
import { CockpitRangeMeta, CockpitSnapshotResult } from '../interfaces/cockpit-timeline.interface';
import { BudgetConfig, BudgetState, PerformanceBudgetService } from './performance-budget.service';

@Injectable({
  providedIn: 'root',
})
export class StreamWorkerService {
  #streamSubject = new Subject<CockpitMockStreamEvent>();
  #eventEnvelopeSubject = new Subject<CockpitStreamedEvent>();
  #streamErrorSubject = new Subject<Error>();
  #snapshotCompleteSubject = new Subject<CockpitSnapshotResult>();
  #rangeMetaSubject = new Subject<CockpitRangeMeta>();
  #requestDetailsById = new Map<string, CockpitRequestDetails>();
  #pendingTimeoutIds = new Set<ReturnType<typeof setTimeout>>();
  #selectedRequestIdSubject = new BehaviorSubject<string | null>(null);
  #selectedRequestDetailsSubject = new BehaviorSubject<CockpitRequestDetails | null>(null);
  #stopMessage: CockpitStreamWorkerStopMessage = { type: 'stop' };
  #pendingEvictionRequestIds = new Set<string>();
  #visibleRequestIds = new Set<string>();
  #destinationSubjectsByKey = new Map<string, Subject<CockpitDestinationSidebarData>>();
  #destinationRefCountsByKey = new Map<string, number>();
  #destinationNamesByKey = new Map<string, string>();
  #localDetailsProvider: ((id: string) => CockpitMockStreamEvent | null) | null = null;

  public readonly streamErrors$ = this.#streamErrorSubject.asObservable();
  public readonly selectedRequestId$ = this.#selectedRequestIdSubject.asObservable();
  public readonly selectedRequestDetails$ = this.#selectedRequestDetailsSubject.asObservable();
  public readonly eventEnvelopes$ = this.#eventEnvelopeSubject.asObservable();
  public readonly snapshotComplete$ = this.#snapshotCompleteSubject.asObservable();
  public readonly rangeMeta$ = this.#rangeMetaSubject.asObservable();

  #streamWorker: Worker | null = null;
  #bridgeStarted = false;
  #destroyRef = inject(DestroyRef);
  #ngZone = inject(NgZone);
  #performanceBudgetService = inject(PerformanceBudgetService);
  readonly #isLiveStreamActive = signal(false);

  public readonly streamEvents$ = this.#streamSubject.asObservable();
  public readonly isLiveStreamActive = this.#isLiveStreamActive.asReadonly();

  constructor() {
    this.#destroyRef.onDestroy(() => {
      for (const id of this.#pendingTimeoutIds) {
        clearTimeout(id);
      }

      this.#pendingTimeoutIds.clear();
      this.closeStream();
      this.resetRequestDetails();
      this.#streamSubject.complete();
      this.#eventEnvelopeSubject.complete();
      this.#streamErrorSubject.complete();
      this.#snapshotCompleteSubject.complete();
      this.#rangeMetaSubject.complete();
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

  public registerLocalDetailsProvider(provider: (id: string) => CockpitMockStreamEvent | null): void {
    this.#localDetailsProvider = provider;
  }

  public selectRequest(requestId: string | number | null): void {
    const normalizedRequestId = requestId === null ? null : String(requestId).trim();
    const nextRequestId = normalizedRequestId ? normalizedRequestId : null;
    const previousRequestId = this.#selectedRequestIdSubject.value;

    if (previousRequestId && previousRequestId !== nextRequestId) {
      this.#releaseRequestDetails(previousRequestId);
    }

    this.#selectedRequestIdSubject.next(nextRequestId);

    if (!nextRequestId) {
      this.#selectedRequestDetailsSubject.next(null);

      return;
    }

    const selectedRequestDetails = this.#requestDetailsById.get(nextRequestId) ?? { id: nextRequestId };

    this.#selectedRequestDetailsSubject.next(this.#cloneRequestDetails(selectedRequestDetails));

    const localDetails = this.#localDetailsProvider?.(nextRequestId);

    if (localDetails) {
      this.#ingestWorkerRequestDetails(nextRequestId, localDetails);
    } else {
      this.#requestRequestDetails(nextRequestId);
    }
  }

  public retainRequestDetails(requestId: string | number): void {
    const normalizedRequestId = String(requestId).trim();

    if (!normalizedRequestId) {
      return;
    }

    this.#visibleRequestIds.add(normalizedRequestId);

    if (!this.#requestDetailsById.has(normalizedRequestId)) {
      const localDetails = this.#localDetailsProvider?.(normalizedRequestId);

      if (localDetails) {
        this.#ingestWorkerRequestDetails(normalizedRequestId, localDetails);
      } else {
        this.#requestRequestDetails(normalizedRequestId);
      }
    }
  }

  public evictRequestDetails(requestId: string | number): void {
    const normalizedRequestId = String(requestId).trim();

    if (!normalizedRequestId) {
      return;
    }

    this.#visibleRequestIds.delete(normalizedRequestId);

    if (this.#selectedRequestIdSubject.value === normalizedRequestId) {
      this.#pendingEvictionRequestIds.add(normalizedRequestId);

      return;
    }

    this.#pendingEvictionRequestIds.delete(normalizedRequestId);
    this.#requestDetailsById.delete(normalizedRequestId);
  }

  public observeDestination(destinationName: string): Observable<CockpitDestinationSidebarData> {
    const destinationKey = this.#normalizeDestinationKey(destinationName);

    return new Observable<CockpitDestinationSidebarData>((subscriber) => {
      if (!destinationKey) {
        subscriber.complete();

        return;
      }

      this.#ensureBridgeStarted();

      let subject = this.#destinationSubjectsByKey.get(destinationKey);

      if (!subject) {
        subject = new Subject<CockpitDestinationSidebarData>();
        this.#destinationSubjectsByKey.set(destinationKey, subject);
      }

      this.#destinationNamesByKey.set(destinationKey, destinationName.trim());

      const previousRefCount = this.#destinationRefCountsByKey.get(destinationKey) ?? 0;
      const nextRefCount = previousRefCount + 1;

      this.#destinationRefCountsByKey.set(destinationKey, nextRefCount);

      if (previousRefCount === 0) {
        const subscribeMessage: CockpitStreamWorkerSubscribeDestinationMessage = {
          type: 'subscribe-destination',
          destinationName: destinationName.trim(),
        };

        this.#streamWorker?.postMessage(subscribeMessage);
      }

      const innerSubscription = subject.subscribe(subscriber);

      return () => {
        innerSubscription.unsubscribe();

        const currentRefCount = this.#destinationRefCountsByKey.get(destinationKey) ?? 0;
        const remaining = currentRefCount - 1;

        if (remaining <= 0) {
          this.#destinationRefCountsByKey.delete(destinationKey);
          this.#destinationSubjectsByKey.get(destinationKey)?.complete();
          this.#destinationSubjectsByKey.delete(destinationKey);
          this.#destinationNamesByKey.delete(destinationKey);

          const unsubscribeMessage: CockpitStreamWorkerUnsubscribeDestinationMessage = {
            type: 'unsubscribe-destination',
            destinationName: destinationName.trim(),
          };

          this.#streamWorker?.postMessage(unsubscribeMessage);
        } else {
          this.#destinationRefCountsByKey.set(destinationKey, remaining);
        }
      };
    });
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
    this.#pendingEvictionRequestIds.clear();
    this.#visibleRequestIds.clear();
    this.#selectedRequestIdSubject.next(null);
    this.#selectedRequestDetailsSubject.next(null);
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
    this.#isLiveStreamActive.set(true);

    return this.#streamSubject.asObservable();
  }

  public startSnapshot(message: CockpitStreamWorkerStartSnapshotMessage): Observable<CockpitSnapshotResult> {
    this.#ensureBridgeStarted();

    const snapshotResult$ = this.#snapshotCompleteSubject.asObservable().pipe(
      filter((result) => result.snapshotId === message.snapshotId),
      take(1),
    );

    if (!this.#streamWorker) {
      const error = new Error('Web worker is unavailable. Cockpit snapshot cannot be loaded.');

      this.#reportError(error.message);

      return throwError(() => error);
    }

    this.#streamWorker.postMessage(message);

    return snapshotResult$;
  }

  public publishRangeMeta(meta: CockpitRangeMeta): void {
    this.#rangeMetaSubject.next(meta);
  }

  public syncPlayheadTime(playheadTs: number, isLiveMode: boolean): void {
    if (!this.#streamWorker) {
      return;
    }

    this.#streamWorker.postMessage({
      type: CockpitWorkerIncomingMessageType.SyncPlayheadTime,
      playheadTs,
      isLiveMode,
    });
  }

  public ingestSnapshotEvent(event: CockpitMockStreamEvent): void {
    if (!this.#streamWorker) {
      return;
    }

    this.#streamWorker.postMessage({
      type: 'ingest-snapshot-event',
      event,
    });
  }

  public resetSession(playheadTs: number, isLiveMode: boolean): void {
    if (!this.#streamWorker) {
      return;
    }

    this.#clearPendingReplayTimeouts();

    this.#streamWorker.postMessage({
      type: CockpitWorkerIncomingMessageType.ResetSession,
      playheadTs,
      isLiveMode,
    });
  }

  public closeStream(): void {
    this.#clearPendingReplayTimeouts();
    this.#isLiveStreamActive.set(false);

    if (this.#streamWorker) {
      this.#streamWorker.postMessage(this.#stopMessage);
    }

    this.#destroyWorker();
    this.#bridgeStarted = false;
  }

  #clearPendingReplayTimeouts(): void {
    for (const id of this.#pendingTimeoutIds) {
      clearTimeout(id);
    }

    this.#pendingTimeoutIds.clear();
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

        if (data.type === CockpitWorkerOutgoingMessageType.Event) {
          const requestId = this.#ingestRequestDetails(data.event);

          this.#streamSubject.next(data.event);
          this.#emitSelectedRequestDetailsIfChanged(requestId);

          return;
        }

        if (data.type === CockpitWorkerOutgoingMessageType.BatchUpdate) {
          const maxAge = data.data.reduce((max, item) => Math.max(max, item.ageMs), 0);

          this.#ngZone.runOutsideAngular(() => {
            for (const { event, ageMs } of data.data) {
              const delay = Math.max(0, maxAge - ageMs);

              const ingestAndEmit = (): void => {
                this.#emitStreamEvent(event, 'live');
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
          });

          return;
        }

        if (data.type === CockpitWorkerOutgoingMessageType.SnapshotEvent) {
          this.#emitStreamEvent(data.event, 'snapshot', data.snapshotId);

          return;
        }

        if (data.type === CockpitWorkerOutgoingMessageType.SnapshotComplete) {
          this.#snapshotCompleteSubject.next(data.result);

          return;
        }

        if (data.type === CockpitWorkerOutgoingMessageType.RangeMeta) {
          this.#rangeMetaSubject.next(data.meta);

          return;
        }

        if (data.type === CockpitWorkerOutgoingMessageType.Status) {
          if (data.status === 'started') {
            this.#isLiveStreamActive.set(true);
          } else if (data.status === 'stopped') {
            this.#isLiveStreamActive.set(false);
          } else if (data.status === 'error') {
            this.#isLiveStreamActive.set(false);
            this.#reportError(data.detail ?? 'Cockpit worker reported a stream error.');
          }

          return;
        }

        if (data.type === CockpitWorkerOutgoingMessageType.DestinationUpdate) {
          const destinationKey = this.#normalizeDestinationKey(data.destinationName);

          if (!destinationKey) {
            return;
          }

          this.#destinationSubjectsByKey.get(destinationKey)?.next(data.data);
        }

        if (data.type === CockpitWorkerOutgoingMessageType.RequestDetails) {
          this.#ingestWorkerRequestDetails(data.requestId, data.details);
        }
      };

      this.#streamWorker.onerror = () => {
        this.#reportError('Cockpit worker crashed while handling stream data.');
        this.closeStream();
      };

      this.#sendBudgetStateToWorker(
        this.#performanceBudgetService.budgetState(),
        this.#performanceBudgetService.budgetConfig(),
      );
      this.#replayDestinationSubscriptions();
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

  #emitStreamEvent(event: CockpitMockStreamEvent, source: CockpitStreamEventSource, snapshotId?: string): void {
    const requestId = this.#ingestRequestDetails(event);

    if (source === 'live') {
      this.#streamSubject.next(event);
    }

    this.#eventEnvelopeSubject.next({ event, source, snapshotId });
    this.#emitSelectedRequestDetailsIfChanged(requestId);
  }

  #ingestRequestDetails(event: CockpitMockStreamEvent): string {
    const requestId = String(event.id).trim();

    if (!requestId) {
      return '';
    }

    if (!this.#shouldRetainRequestDetails(requestId)) {
      return requestId;
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

    const selectedRequestId = this.#selectedRequestIdSubject.value;

    if (!selectedRequestId || selectedRequestId !== changedRequestId) {
      return;
    }

    const selectedRequestDetails = this.#requestDetailsById.get(selectedRequestId) ?? null;

    this.#selectedRequestDetailsSubject.next(this.#cloneRequestDetails(selectedRequestDetails));
  }

  #ingestWorkerRequestDetails(requestId: string, event: CockpitMockStreamEvent | null): void {
    const normalizedRequestId = String(requestId).trim();

    if (!normalizedRequestId || !event || !this.#shouldRetainRequestDetails(normalizedRequestId)) {
      return;
    }

    const requestDetails: CockpitRequestDetails = {
      ...event,
      id: normalizedRequestId,
    };

    this.#requestDetailsById.set(normalizedRequestId, requestDetails);
    this.#emitSelectedRequestDetailsIfChanged(normalizedRequestId);
  }

  #shouldRetainRequestDetails(requestId: string): boolean {
    return this.#visibleRequestIds.has(requestId) || this.#selectedRequestIdSubject.value === requestId;
  }

  #requestRequestDetails(requestId: string): void {
    this.#ensureBridgeStarted();

    if (!this.#streamWorker) {
      return;
    }

    const message: CockpitStreamWorkerGetRequestDetailsMessage = {
      type: 'get-request-details',
      requestId,
    };

    this.#streamWorker.postMessage(message);
  }

  #releaseRequestDetails(requestId: string): void {
    const message: CockpitStreamWorkerReleaseRequestDetailsMessage = {
      type: 'release-request-details',
      requestId,
    };

    this.#streamWorker?.postMessage(message);
    this.#pendingEvictionRequestIds.delete(requestId);

    if (!this.#visibleRequestIds.has(requestId)) {
      this.#requestDetailsById.delete(requestId);
    }
  }

  #replayDestinationSubscriptions(): void {
    if (!this.#streamWorker) {
      return;
    }

    for (const [destinationKey, refCount] of this.#destinationRefCountsByKey) {
      if (refCount <= 0) {
        continue;
      }

      const destinationName = this.#destinationNamesByKey.get(destinationKey);

      if (!destinationName) {
        continue;
      }

      const message: CockpitStreamWorkerSubscribeDestinationMessage = {
        type: 'subscribe-destination',
        destinationName,
      };

      this.#streamWorker.postMessage(message);
    }
  }

  #cloneRequestDetails(requestDetails: CockpitRequestDetails | null): CockpitRequestDetails | null {
    if (!requestDetails) {
      return null;
    }

    return { ...requestDetails };
  }

  #normalizeDestinationKey(destinationName: string | null | undefined): string | null {
    if (typeof destinationName !== 'string') {
      return null;
    }

    const normalized = destinationName.trim().toLowerCase();

    return normalized ? normalized : null;
  }

  #destroyWorker(): void {
    if (!this.#streamWorker) {
      return;
    }

    this.#streamWorker.terminate();
    this.#streamWorker = null;
  }
}
