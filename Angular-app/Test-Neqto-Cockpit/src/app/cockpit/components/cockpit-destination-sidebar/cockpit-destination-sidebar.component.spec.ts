import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { CockpitMockStreamEvent } from '../../interfaces/cockpit-stream.interface';
import { StreamWorkerService } from '../../services/stream-worker.service';
import { CockpitDestinationSidebarComponent } from './cockpit-destination-sidebar.component';

describe('CockpitDestinationSidebarComponent', () => {
  let component: CockpitDestinationSidebarComponent;
  let fixture: ComponentFixture<CockpitDestinationSidebarComponent>;
  let streamEventsSubject: Subject<CockpitMockStreamEvent>;
  let streamWorkerServiceMock: {
    streamEvents$: Subject<CockpitMockStreamEvent>;
    selectRequest: jasmine.Spy;
  };

  beforeEach(async () => {
    streamEventsSubject = new Subject<CockpitMockStreamEvent>();
    streamWorkerServiceMock = {
      streamEvents$: streamEventsSubject,
      selectRequest: jasmine.createSpy('selectRequest'),
    };

    await TestBed.configureTestingModule({
      imports: [CockpitDestinationSidebarComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: StreamWorkerService,
          useValue: streamWorkerServiceMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CockpitDestinationSidebarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('visible', true);
  });

  afterEach(() => {
    streamEventsSubject.complete();
  });

  it('should create', () => {
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });

  it('should show loading data when destination is selected and no events are received yet', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    const data = component.sidebarData();

    expect(data).not.toBeNull();
    expect(data?.metricsLoading).toBeTrue();
    expect(data?.eventsLoading).toBeTrue();
    expect(data?.errorsLoading).toBeTrue();
    expect(data?.processedResponsesLastWindow).toBe(0);
  });

  it('should compute error rate with response codes above 399 and count processed responses in 30 minute window', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    const nowSeconds = Math.floor(Date.now() / 1000);

    streamEventsSubject.next({ id: '1', destination: 'bol.com', response_code: 200, ts: nowSeconds });
    streamEventsSubject.next({ id: '2', destination: 'bol.com', response_code: 404, ts: nowSeconds });
    streamEventsSubject.next({ id: '3', destination: 'bol.com', ts: nowSeconds });
    streamEventsSubject.next({
      id: 'old',
      destination: 'bol.com',
      response_code: 500,
      ts: nowSeconds - 31 * 60,
    });
    fixture.detectChanges();

    const data = component.sidebarData();

    expect(data).not.toBeNull();
    expect(data?.metricsLoading).toBeFalse();
    expect(data?.processedResponsesLastWindow).toBe(2);
    expect(data?.errorRatePercentage).toBe(50);
  });

  it('should parse numeric string response codes for error metrics and errors list', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    const nowSeconds = Math.floor(Date.now() / 1000);

    streamEventsSubject.next({
      id: '1',
      destination: 'bol.com',
      response_code: '500' as unknown as number,
      ts: nowSeconds,
    });
    streamEventsSubject.next({
      id: '2',
      destination: 'bol.com',
      response_code: '200' as unknown as number,
      ts: nowSeconds,
    });
    fixture.detectChanges();

    const data = component.sidebarData();

    expect(data).not.toBeNull();
    expect(data?.errorRatePercentage).toBe(50);
    expect(data?.errors.length).toBe(1);
    expect(data?.errors[0].responseCode).toBe(500);
  });

  it('should include errors when stream uses camelCase responseCode field', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    const nowSeconds = Math.floor(Date.now() / 1000);

    streamEventsSubject.next({
      id: '1',
      destination: 'bol.com',
      responseCode: 500 as unknown as number,
      ts: nowSeconds,
    });
    fixture.detectChanges();

    const data = component.sidebarData();

    expect(data).not.toBeNull();
    expect(data?.errorRatePercentage).toBe(100);
    expect(data?.errors.length).toBe(1);
    expect(data?.errors[0].responseCode).toBe(500);
  });

  it('should update errors when response arrives without destination for an existing request', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    const nowSeconds = Math.floor(Date.now() / 1000);

    streamEventsSubject.next({ id: 'req-42', destination: 'bol.com', ts: nowSeconds });
    streamEventsSubject.next({ id: 'req-42', response_code: 500, ts: nowSeconds });
    fixture.detectChanges();

    const data = component.sidebarData();

    expect(data).not.toBeNull();
    expect(data?.events.length).toBe(1);
    expect(data?.events[0].responseCode).toBe(500);
    expect(data?.errors.length).toBe(1);
    expect(data?.errors[0].requestId).toBe('req-42');
  });

  it('should keep only last 50 successful events and last 20 errors', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    const nowSeconds = Math.floor(Date.now() / 1000);

    for (let index = 1; index <= 55; index += 1) {
      streamEventsSubject.next({
        id: `event-${index}`,
        destination: 'bol.com',
        response_code: 200,
        ts: nowSeconds,
      });
    }

    for (let index = 1; index <= 25; index += 1) {
      streamEventsSubject.next({
        id: `error-${index}`,
        destination: 'bol.com',
        response_code: 500,
        ts: nowSeconds,
      });
    }

    fixture.detectChanges();

    const data = component.sidebarData();

    expect(data).not.toBeNull();
    expect(data?.events.length).toBe(50);
    expect(data?.errors.length).toBe(20);
    expect(data?.events[0].requestId).toBe('error-25');
    expect(data?.errors[0].requestId).toBe('error-25');
  });

  it('should ignore events from other destinations', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    const nowSeconds = Math.floor(Date.now() / 1000);

    streamEventsSubject.next({ id: '1', destination: 'amazon.com', response_code: 500, ts: nowSeconds });
    fixture.detectChanges();

    const data = component.sidebarData();

    expect(data).not.toBeNull();
    expect(data?.metricsLoading).toBeTrue();
    expect(data?.events.length).toBe(0);
    expect(data?.errors.length).toBe(0);
  });

  it('should call streamWorkerService.selectRequest when onRequestClick is called', () => {
    component.onRequestClick('req-123');

    expect(streamWorkerServiceMock.selectRequest).toHaveBeenCalledWith('req-123');
  });
});
