import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { take } from 'rxjs';
import { CockpitMockStreamEvent, CockpitStreamWorkerOutgoingMessage } from '../interfaces/cockpit-stream.interface';
import { StreamWorkerService } from './stream-worker.service';

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((this: Worker, ev: MessageEvent<CockpitStreamWorkerOutgoingMessage>) => any) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null;
  postMessage = jasmine.createSpy('postMessage');

  terminate = jasmine.createSpy('terminate');

  constructor(_url: URL, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  emit(data: CockpitStreamWorkerOutgoingMessage): void {
    this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent<CockpitStreamWorkerOutgoingMessage>);
  }
}

describe('StreamWorkerService', () => {
  let service: StreamWorkerService;
  let originalWorker: typeof Worker;

  const eventFixture: CockpitMockStreamEvent = {
    id: '1',
    ts: 1,
    destination: '/api/orders',
    flow: 'order-sync',
    flow_execution_id: 'fx-1',
  };

  beforeEach(() => {
    originalWorker = window.Worker;
    MockWorker.instances = [];
    TestBed.configureTestingModule({
      providers: [StreamWorkerService],
    });

    service = TestBed.inject(StreamWorkerService);
  });

  afterEach(() => {
    (window as Window & { Worker: typeof Worker }).Worker = originalWorker;
    service.closeMockStream();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should expose one cockpit mock stream path', () => {
    expect(service.mockStreamPath).toBe('/mock/cockpit/stream');
  });

  it('should open external mock stream through the worker and emit worker events', (done) => {
    (window as Window & { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;

    service
      .openMockStream()
      .pipe(take(1))
      .subscribe((event) => {
        expect(event).toEqual(eventFixture);
        done();
      });

    expect(MockWorker.instances.length).toBe(1);
    expect(MockWorker.instances[0].postMessage).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: 'start-ndjson',
        url: 'http://localhost:8788/mock/cockpit/stream',
      }),
    );
    MockWorker.instances[0].emit({ type: 'BATCH_UPDATE', data: [{ event: eventFixture, ageMs: 0 }] });
  });

  it('should emit explicit error when Worker is unavailable and not fallback', (done) => {
    (window as Window & { Worker: typeof Worker }).Worker = undefined as unknown as typeof Worker;

    service.streamErrors$.pipe(take(1)).subscribe((error) => {
      expect(error.message).toContain('Web worker is unavailable');
      done();
    });

    service.openMockStream().subscribe();
  });

  it('should close worker stream and terminate worker', () => {
    (window as Window & { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;
    service.openMockStream().subscribe();

    service.closeMockStream();

    expect(MockWorker.instances[0].postMessage).toHaveBeenCalledWith({ type: 'stop' });
    expect(MockWorker.instances.length).toBe(1);
    expect(MockWorker.instances[0].terminate).toHaveBeenCalled();
  });

  it('should emit explicit error when worker reports NDJSON failure and not fallback', (done) => {
    (window as Window & { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;

    service.streamErrors$.pipe(take(1)).subscribe((error) => {
      expect(error.message).toContain('stream failed');
      done();
    });

    service.openMockStream().subscribe();

    expect(MockWorker.instances.length).toBe(1);
    MockWorker.instances[0].emit({ type: 'status', status: 'error', detail: 'stream failed' });
  });

  it('should merge partial stream events and expose accumulated request details by id', () => {
    (window as Window & { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;

    service.openMockStream().subscribe();

    expect(MockWorker.instances.length).toBe(1);

    MockWorker.instances[0].emit({
      type: 'BATCH_UPDATE',
      data: [
        {
          event: {
            id: 'req-1',
            destination: '/api/orders',
            flow: 'order-sync',
          },
          ageMs: 0,
        },
        {
          event: {
            id: 'req-1',
            payload_size: 1024,
            response_code: 200,
          },
          ageMs: 0,
        },
      ],
    });

    expect(service.getRequestDetailsById('req-1')).toEqual({
      id: 'req-1',
      destination: '/api/orders',
      flow: 'order-sync',
      payload_size: 1024,
      response_code: 200,
    });
  });

  it('should emit selected request id immediately even when details are not cached yet', () => {
    const selectedRequestDetailsUpdates: Array<Record<string, unknown> | null> = [];

    service.selectedRequestDetails$.subscribe((requestDetails) => {
      selectedRequestDetailsUpdates.push(requestDetails as Record<string, unknown> | null);
    });

    service.selectRequest('req-loading');

    expect(selectedRequestDetailsUpdates[selectedRequestDetailsUpdates.length - 1]).toEqual({ id: 'req-loading' });
  });

  it('should auto update selected request details when matching worker events arrive', () => {
    (window as Window & { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;

    const selectedRequestDetailsUpdates: Array<Record<string, unknown> | null> = [];

    service.selectedRequestDetails$.subscribe((requestDetails) => {
      selectedRequestDetailsUpdates.push(requestDetails as Record<string, unknown> | null);
    });

    service.openMockStream().subscribe();
    service.selectRequest('req-2');

    expect(MockWorker.instances.length).toBe(1);

    MockWorker.instances[0].emit({
      type: 'BATCH_UPDATE',
      data: [
        {
          event: {
            id: 'req-2',
            destination: '/api/invoices',
            'ttfb-hint': 120,
          },
          ageMs: 0,
        },
        {
          event: {
            id: 'req-2',
            ttfb: 240,
            response_size: 2048,
          },
          ageMs: 0,
        },
      ],
    });

    expect(selectedRequestDetailsUpdates[selectedRequestDetailsUpdates.length - 1]).toEqual(
      jasmine.objectContaining({
        id: 'req-2',
        destination: '/api/invoices',
        'ttfb-hint': 120,
        ttfb: 240,
        response_size: 2048,
      }),
    );
  });

  it('should emit each event in a batch individually through streamEvents$', () => {
    (window as Window & { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;

    const emittedEvents: CockpitMockStreamEvent[] = [];

    service.openMockStream().subscribe((event) => {
      emittedEvents.push(event);
    });

    MockWorker.instances[0].emit({
      type: 'BATCH_UPDATE',
      data: [
        { event: { id: 'req-10', destination: '/api/a' }, ageMs: 0 },
        { event: { id: 'req-11', destination: '/api/b' }, ageMs: 0 },
        { event: { id: 'req-12', destination: '/api/c' }, ageMs: 0 },
      ],
    });

    expect(emittedEvents.length).toBe(3);
    expect(emittedEvents[0]).toEqual(jasmine.objectContaining({ id: 'req-10' }));
    expect(emittedEvents[1]).toEqual(jasmine.objectContaining({ id: 'req-11' }));
    expect(emittedEvents[2]).toEqual(jasmine.objectContaining({ id: 'req-12' }));
  });

  it('should stagger BATCH_UPDATE event emissions based on age', fakeAsync(() => {
    (window as Window & { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;

    const emittedEvents: CockpitMockStreamEvent[] = [];

    service.openMockStream().subscribe((event) => {
      emittedEvents.push(event);
    });

    MockWorker.instances[0].emit({
      type: 'BATCH_UPDATE',
      data: [
        { event: { id: 'req-old', destination: '/api/old' }, ageMs: 800 },
        { event: { id: 'req-new', destination: '/api/new' }, ageMs: 100 },
      ],
    });

    // req-old has the highest ageMs (delay = 800 - 800 = 0), fires immediately.
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]).toEqual(jasmine.objectContaining({ id: 'req-old' }));

    // req-new delay = 800 - 100 = 700ms.
    tick(700);

    expect(emittedEvents.length).toBe(2);
    expect(emittedEvents[1]).toEqual(jasmine.objectContaining({ id: 'req-new' }));
  }));

  it('should send the current budget state to the worker when the stream is opened', () => {
    (window as Window & { Worker: typeof Worker }).Worker = MockWorker as unknown as typeof Worker;

    service.openMockStream().subscribe();

    expect(MockWorker.instances.length).toBe(1);

    const budgetCall = MockWorker.instances[0].postMessage.calls
      .allArgs()
      .find((args: unknown[]) => (args[0] as { type: string }).type === 'update-budget-state');

    expect(budgetCall).toBeDefined();
    expect(budgetCall[0]).toEqual(
      jasmine.objectContaining({
        type: 'update-budget-state',
        state: 'optimal',
        tickRateMs: 1_000,
        deferHintEvents: false,
      }),
    );
  });
});
