import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { CockpitOverviewComponent } from './cockpit-overview.component';

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
});
