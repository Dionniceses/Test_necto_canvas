import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { CockpitDestinationSidebarData } from '../../interfaces/cockpit-destination-sidebar.interface';
import { StreamWorkerService } from '../../services/stream-worker.service';
import { CockpitDestinationSidebarComponent } from './cockpit-destination-sidebar.component';

describe('CockpitDestinationSidebarComponent', () => {
  let component: CockpitDestinationSidebarComponent;
  let fixture: ComponentFixture<CockpitDestinationSidebarComponent>;
  let destinationSubjects: Map<string, Subject<CockpitDestinationSidebarData>>;
  let observeDestinationSpy: jasmine.Spy;
  let unsubscribeCounts: Map<string, number>;
  let streamWorkerServiceMock: {
    observeDestination: jasmine.Spy;
    selectRequest: jasmine.Spy;
  };

  beforeEach(async () => {
    destinationSubjects = new Map<string, Subject<CockpitDestinationSidebarData>>();
    unsubscribeCounts = new Map<string, number>();
    observeDestinationSpy = jasmine.createSpy('observeDestination').and.callFake((destinationName: string) => {
      return new Observable<CockpitDestinationSidebarData>((subscriber) => {
        const subject = new Subject<CockpitDestinationSidebarData>();

        destinationSubjects.set(destinationName, subject);

        const innerSubscription = subject.subscribe(subscriber);

        return () => {
          innerSubscription.unsubscribe();
          unsubscribeCounts.set(destinationName, (unsubscribeCounts.get(destinationName) ?? 0) + 1);
        };
      });
    });

    streamWorkerServiceMock = {
      observeDestination: observeDestinationSpy,
      selectRequest: jasmine.createSpy('selectRequest'),
    };

    await TestBed.configureTestingModule({
      imports: [CockpitDestinationSidebarComponent, TranslateModule.forRoot()],
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

  it('should create', () => {
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });

  it('should leave sidebarData null when no destination is selected', () => {
    fixture.detectChanges();

    expect(component.sidebarData()).toBeNull();
    expect(observeDestinationSpy).not.toHaveBeenCalled();
  });

  it('should subscribe to observeDestination with trimmed destination name and clear data initially', () => {
    fixture.componentRef.setInput('destinationName', '  bol.com  ');
    fixture.detectChanges();

    expect(observeDestinationSpy).toHaveBeenCalledOnceWith('bol.com');
    expect(component.sidebarData()).toBeNull();
  });

  it('should update sidebarData when the worker pushes destination updates', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    const subject = destinationSubjects.get('bol.com');
    const data: CockpitDestinationSidebarData = {
      metricsLoading: false,
      errorRatePercentage: 25,
      processedResponsesLastWindow: 4,
      processedWindowMinutes: 30,
      eventsLoading: false,
      errorsLoading: false,
      events: [],
      errors: [],
    };

    subject?.next(data);

    expect(component.sidebarData()).toEqual(data);
  });

  it('should resubscribe when destinationName changes and unsubscribe the previous destination', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    fixture.componentRef.setInput('destinationName', 'amazon.com');
    fixture.detectChanges();

    expect(observeDestinationSpy).toHaveBeenCalledTimes(2);
    expect(unsubscribeCounts.get('bol.com')).toBe(1);
    expect(component.sidebarData()).toBeNull();
  });

  it('should clear sidebarData and unsubscribe when destinationName becomes null', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    destinationSubjects.get('bol.com')?.next({
      metricsLoading: false,
      errorRatePercentage: 0,
      processedResponsesLastWindow: 1,
      processedWindowMinutes: 30,
      eventsLoading: false,
      errorsLoading: false,
      events: [],
      errors: [],
    });

    fixture.componentRef.setInput('destinationName', null);
    fixture.detectChanges();

    expect(component.sidebarData()).toBeNull();
    expect(unsubscribeCounts.get('bol.com')).toBe(1);
  });

  it('should unsubscribe on component destroy', () => {
    fixture.componentRef.setInput('destinationName', 'bol.com');
    fixture.detectChanges();

    fixture.destroy();

    expect(unsubscribeCounts.get('bol.com')).toBe(1);
  });

  it('should call streamWorkerService.selectRequest when onRequestClick is called', () => {
    component.onRequestClick('req-123');

    expect(streamWorkerServiceMock.selectRequest).toHaveBeenCalledWith('req-123');
  });
});
