import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, Subject, of } from 'rxjs';
import { CockpitStreamedEvent, CockpitStreamWorkerStartSnapshotMessage } from '../interfaces/cockpit-stream.interface';
import { CockpitSnapshotResult } from '../interfaces/cockpit-timeline.interface';
import { MockCockpitHistoryGateway } from './mock-cockpit-history-gateway.service';
import { StreamWorkerService } from './stream-worker.service';

describe('MockCockpitHistoryGateway', () => {
  let gateway: MockCockpitHistoryGateway;
  let streamWorkerServiceMock: {
    eventEnvelopes$: Observable<CockpitStreamedEvent>;
    openNdjsonStream: jasmine.Spy;
    publishRangeMeta: jasmine.Spy;
    startSnapshot: jasmine.Spy;
  };

  beforeEach(() => {
    streamWorkerServiceMock = {
      eventEnvelopes$: new Subject<CockpitStreamedEvent>().asObservable(),
      openNdjsonStream: jasmine.createSpy('openNdjsonStream').and.returnValue(of({ id: 'live-1' })),
      publishRangeMeta: jasmine.createSpy('publishRangeMeta'),
      startSnapshot: jasmine
        .createSpy('startSnapshot')
        .and.callFake((message: CockpitStreamWorkerStartSnapshotMessage) =>
          of({ snapshotId: message.snapshotId, range: message.range, count: 0, truncated: false }),
        ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: StreamWorkerService, useValue: streamWorkerServiceMock },
      ],
    });

    gateway = TestBed.inject(MockCockpitHistoryGateway);
  });

  it('should open the mock live NDJSON stream through the worker bridge', () => {
    gateway.openLiveStream(new Date(Date.UTC(2026, 0, 1))).subscribe();

    expect(streamWorkerServiceMock.openNdjsonStream).toHaveBeenCalledWith(
      jasmine.stringMatching(/mock\/cockpit\/stream$/),
    );
  });

  it('should publish range metadata for the selected date', () => {
    const selectedDate = new Date(Date.UTC(2026, 0, 1));

    gateway.getRangeMeta(selectedDate).subscribe((meta) => {
      expect(meta.dateKey).toBe('2026-01-01');
      expect(meta.availableRange.fromTs).toBe(Date.UTC(2026, 0, 1));
    });

    expect(streamWorkerServiceMock.publishRangeMeta).toHaveBeenCalled();
  });

  it('should load a range snapshot as an empty snapshot stub through the worker', () => {
    const fromTs = Date.UTC(2026, 0, 1, 1);
    const toTs = Date.UTC(2026, 0, 1, 2);
    let result: CockpitSnapshotResult | null = null;

    gateway.openLiveStream(new Date(Date.UTC(2026, 0, 1))).subscribe();
    gateway.loadRange(fromTs, toTs, 30).subscribe((snapshotResult) => {
      result = snapshotResult;
    });

    const snapshotMessage = streamWorkerServiceMock.startSnapshot.calls.mostRecent()
      .args[0] as CockpitStreamWorkerStartSnapshotMessage;

    expect(snapshotMessage.type).toBe('start-snapshot');
    expect(snapshotMessage.url).toContain('/mock/cockpit/snapshot');
    expect(snapshotMessage.range).toEqual({ fromTs, toTs });
    expect(result?.range).toEqual({ fromTs, toTs });
  });

  it('should alert on first failed snapshot but respect cooldown for subsequent failures', () => {
    const alertSpy = spyOn(window, 'alert');

    streamWorkerServiceMock.startSnapshot.and.returnValue(of({ error: 'Failed request' }));

    gateway.loadRange(1000, 2000, 30).subscribe();

    expect(alertSpy).toHaveBeenCalledTimes(1);

    gateway.loadRange(2000, 3000, 30).subscribe();

    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
