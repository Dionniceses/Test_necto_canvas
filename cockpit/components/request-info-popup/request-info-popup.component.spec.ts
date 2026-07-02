import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { CockpitRequestDetails } from '../../interfaces/cockpit-request-details.interface';
import { StreamWorkerService } from '../../services/stream-worker.service';
import { RequestInfoPopupComponent } from './request-info-popup.component';

describe('RequestInfoPopupComponent', () => {
  let component: RequestInfoPopupComponent;
  let fixture: ComponentFixture<RequestInfoPopupComponent>;
  let selectedRequestIdSubject: BehaviorSubject<string | null>;
  let selectedRequestDetailsSubject: BehaviorSubject<CockpitRequestDetails | null>;
  let streamWorkerServiceMock: {
    selectedRequestId$: BehaviorSubject<string | null>;
    selectedRequestDetails$: BehaviorSubject<CockpitRequestDetails | null>;
    selectRequest: jasmine.Spy;
  };

  beforeEach(async () => {
    selectedRequestIdSubject = new BehaviorSubject<string | null>(null);
    selectedRequestDetailsSubject = new BehaviorSubject<CockpitRequestDetails | null>(null);
    streamWorkerServiceMock = {
      selectedRequestId$: selectedRequestIdSubject,
      selectedRequestDetails$: selectedRequestDetailsSubject,
      selectRequest: jasmine.createSpy('selectRequest'),
    };

    await TestBed.configureTestingModule({
      imports: [RequestInfoPopupComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: StreamWorkerService,
          useValue: streamWorkerServiceMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RequestInfoPopupComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    selectedRequestIdSubject.complete();
    selectedRequestDetailsSubject.complete();
  });

  it('should create', () => {
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });

  it('should hide popup when no request is selected', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.request-info-popup')).toBeNull();
  });

  it('should show popup immediately when request is selected before details arrive', () => {
    selectedRequestIdSubject.next('req-loading');

    fixture.detectChanges();

    const popupElement: HTMLElement | null = fixture.nativeElement.querySelector('.request-info-popup');

    expect(popupElement).not.toBeNull();
    expect(component.requestDetails()?.id).toBe('req-loading');
  });

  it('should render status code, flow and destination', () => {
    selectedRequestIdSubject.next('req-1');
    selectedRequestDetailsSubject.next({
      id: 'req-1',
      response_code: 200,
      flow: 'my-flow',
      destination: 'bol.com',
    });

    fixture.detectChanges();

    const popupElement: HTMLElement | null = fixture.nativeElement.querySelector('.request-info-popup');

    expect(popupElement).not.toBeNull();

    const popupText = popupElement?.textContent ?? '';

    expect(popupText).toContain('200 - OK');
    expect(popupText).toContain('my-flow');
    expect(popupText).toContain('bol.com');
  });

  it('should show hinted ttfb first and replace it when final ttfb arrives', () => {
    selectedRequestIdSubject.next('req-2');
    selectedRequestDetailsSubject.next({
      id: 'req-2',
      destination: 'bol.com',
      payload_size: 1024,
      'ttfb-hint': 139,
    });

    fixture.detectChanges();

    const toggleButtonDebugElement = fixture.debugElement.query(By.css('.request-info-popup__toggle'));

    toggleButtonDebugElement.triggerEventHandler('onClick');
    fixture.detectChanges();

    const hintedPopupText = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(hintedPopupText).toContain('139 ms (hint)');
    expect(hintedPopupText).toContain('1,024 bytes');

    selectedRequestDetailsSubject.next({
      id: 'req-2',
      destination: 'bol.com',
      payload_size: 1024,
      response_size: 2048,
      ttfb: 300,
      'ttfb-hint': 139,
    });

    fixture.detectChanges();

    const finalPopupText = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(finalPopupText).toContain('300 ms');
    expect(finalPopupText).not.toContain('139 ms (hint)');
    expect(finalPopupText).toContain('2,048 bytes');
  });

  it('should clear selection when close is clicked', () => {
    selectedRequestIdSubject.next('req-3');
    selectedRequestDetailsSubject.next({
      id: 'req-3',
      flow: 'my-flow',
    });

    fixture.detectChanges();

    const closeButtonDebugElement = fixture.debugElement.query(By.css('.request-info-popup__close'));

    closeButtonDebugElement.triggerEventHandler('onClick');

    expect(streamWorkerServiceMock.selectRequest).toHaveBeenCalledWith(null);
  });
});
