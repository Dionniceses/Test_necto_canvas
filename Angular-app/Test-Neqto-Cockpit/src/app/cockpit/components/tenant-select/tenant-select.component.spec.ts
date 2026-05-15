import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { TenantSelectComponent } from './tenant-select.component';

describe('TenantSelectComponent', () => {
  let component: TenantSelectComponent;
  let fixture: ComponentFixture<TenantSelectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TenantSelectComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(TenantSelectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose an empty tenant list by default', () => {
    expect(component.tenants()).toEqual([]);
  });

  it('should initialise the tenant control with no selection', () => {
    expect(component.tenantControl.value).toBeNull();
  });

  it('should emit tenantChange when onTenantChange() is called', () => {
    const tenantChangeSpy = spyOn(component.tenantChange, 'emit');

    component.onTenantChange('tenant-id');

    expect(tenantChangeSpy).toHaveBeenCalledOnceWith('tenant-id');
  });

  it('should emit null when the selection is cleared', () => {
    const tenantChangeSpy = spyOn(component.tenantChange, 'emit');

    component.onTenantChange(null);

    expect(tenantChangeSpy).toHaveBeenCalledOnceWith(null);
  });
});
