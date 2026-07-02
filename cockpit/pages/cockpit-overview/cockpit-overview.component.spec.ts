import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { CockpitOverviewComponent } from './cockpit-overview.component';
import { CockpitTimelineStore } from '../../services/cockpit-timeline-store.service';

describe('CockpitOverviewComponent', () => {
  let component: CockpitOverviewComponent;
  let fixture: ComponentFixture<CockpitOverviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CockpitOverviewComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(CockpitOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should clear downloaded ranges on destroy', () => {
    const store = TestBed.inject(CockpitTimelineStore);
    const spy = spyOn(store, 'clearDownloadedRanges');

    component.ngOnDestroy();

    expect(spy).toHaveBeenCalled();
  });

  it('should display the buffering spinner when snapshots are pending and hide it when they complete', () => {
    const store = TestBed.inject(CockpitTimelineStore);

    fixture.detectChanges();
    let spinner = fixture.nativeElement.querySelector('.fa-spinner');

    expect(spinner).toBeNull();

    // Start a snapshot download to trigger buffering state
    store.startSnapshot({
      key: 'test-snapshot-1',
      direction: 'range',
      fromTs: 1000,
      toTs: 2000,
      limit: 30,
    });
    fixture.detectChanges();

    spinner = fixture.nativeElement.querySelector('.fa-spinner');

    expect(spinner).not.toBeNull();

    // Complete the snapshot download to clear buffering state
    store.completeSnapshot('test-snapshot-1', { fromTs: 1000, toTs: 2000 });
    fixture.detectChanges();

    spinner = fixture.nativeElement.querySelector('.fa-spinner');

    expect(spinner).toBeNull();
  });
});
