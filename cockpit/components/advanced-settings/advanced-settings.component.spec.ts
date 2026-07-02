import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdvancedSettingsComponent } from './advanced-settings.component';
import { AdvancedSettingsService } from '@features/cockpit/services/advanced-settings.service';
import { SettingKey } from '@features/cockpit/interfaces/cockpit-settings-interface';
import { TranslateModule } from '@ngx-translate/core';
import { signal, computed } from '@angular/core';

describe('AdvancedSettingsComponent', () => {
  let component: AdvancedSettingsComponent;
  let fixture: ComponentFixture<AdvancedSettingsComponent>;
  let mockService: jasmine.SpyObj<AdvancedSettingsService>;

  beforeEach(async () => {
    const advancedinfoSig = signal(false);
    const backgroundcolorSig = signal('#f5f5f5');
    const boxplacementformulaSig = signal(6);
    const controlsnapshotsizeSig = signal(1000);
    const performanceSig = signal<undefined | boolean>(undefined);

    mockService = jasmine.createSpyObj<AdvancedSettingsService>('AdvancedSettingsService', ['updateSetting', 'reset'], {
      advancedinfo: computed(() => advancedinfoSig()),
      backgroundcolor: computed(() => backgroundcolorSig()),
      boxplacementformula: computed(() => boxplacementformulaSig()),
      controlsnapshotsize: computed(() => controlsnapshotsizeSig()),
      performance: computed(() => performanceSig()),
    });

    await TestBed.configureTestingModule({
      imports: [AdvancedSettingsComponent, TranslateModule.forRoot()],
      providers: [{ provide: AdvancedSettingsService, useValue: mockService }],
    }).compileComponents();

    fixture = TestBed.createComponent(AdvancedSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle advanced info popup setting', () => {
    component.showAdvancedPopup(true);

    expect(mockService.updateSetting).toHaveBeenCalledWith(SettingKey.AdvancedInfo, true);
  });

  it('should change background color setting', () => {
    component.changeBackgroundColor('#000000');

    expect(mockService.updateSetting).toHaveBeenCalledWith(SettingKey.BackgroundColor, '#000000');
  });

  it('should change box placement formula setting', () => {
    component.changeBoxPlacementFormula(8);

    expect(mockService.updateSetting).toHaveBeenCalledWith(SettingKey.BoxPlacementFormula, 8);
  });

  it('should change snapshot size setting', () => {
    component.changeSnapshotSize(2000);

    expect(mockService.updateSetting).toHaveBeenCalledWith(SettingKey.ControlSnapshotSize, 2000);
  });

  it('should change performance mode setting to enabled', () => {
    component.changePerformanceMode(true);

    expect(mockService.updateSetting).toHaveBeenCalledWith(SettingKey.Performance, true);
  });

  it('should change performance mode setting to disabled', () => {
    component.changePerformanceMode(false);

    expect(mockService.updateSetting).toHaveBeenCalledWith(SettingKey.Performance, false);
  });

  it('should change performance mode setting to auto', () => {
    component.changePerformanceMode(undefined);

    expect(mockService.updateSetting).toHaveBeenCalledWith(SettingKey.Performance, undefined);
  });

  it('should reset all settings to defaults', () => {
    component.resetSettings();

    expect(mockService.reset).toHaveBeenCalled();
  });
});
