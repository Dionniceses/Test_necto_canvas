import { TestBed } from '@angular/core/testing';
import { AdvancedSettingsService } from './advanced-settings.service';
import { SettingKey } from '../interfaces/cockpit-settings-interface';
import { LocalStorageService } from '@capturum/ui/api';

describe('AdvancedSettingsService', () => {
  let service: AdvancedSettingsService;
  let mockLocalStorage: jasmine.SpyObj<LocalStorageService>;

  beforeEach(() => {
    mockLocalStorage = jasmine.createSpyObj<LocalStorageService>('LocalStorageService', ['getItem', 'setItem']);

    TestBed.configureTestingModule({
      providers: [{ provide: LocalStorageService, useValue: mockLocalStorage }],
    });
  });

  it('should be created', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    expect(service).toBeTruthy();
  });

  it('should load default settings when localStorage is empty', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    expect(service.advancedinfo()).toBe(false);
    expect(service.backgroundcolor()).toBe('#f5f5f5');
    expect(service.boxplacementformula()).toBe(6);
  });

  it('should merge saved settings with default settings on init', () => {
    // Simulating old saved data without backgroundcolor and boxplacementformula
    mockLocalStorage.getItem.and.returnValue({ advancedinfo: true });
    service = TestBed.inject(AdvancedSettingsService);

    expect(service.advancedinfo()).toBe(true);
    expect(service.backgroundcolor()).toBe('#f5f5f5'); // Fallback to default
    expect(service.boxplacementformula()).toBe(6); // Fallback to default
  });

  it('should update a setting value', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    service.updateSetting(SettingKey.BackgroundColor, '#000000');

    expect(service.backgroundcolor()).toBe('#000000');
  });

  it('should save settings to localStorage on change', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    service.updateSetting(SettingKey.AdvancedInfo, true);

    TestBed.flushEffects();

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'cockpit-advanced-settings',
      jasmine.objectContaining({ advancedinfo: true, backgroundcolor: '#f5f5f5' }),
    );
  });

  it('should update control snapshot size setting', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    service.updateSetting(SettingKey.ControlSnapshotSize, 2000);

    expect(service.controlsnapshotsize()).toBe(2000);
  });

  it('should update box placement formula setting', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    service.updateSetting(SettingKey.BoxPlacementFormula, 8);

    expect(service.boxplacementformula()).toBe(8);
  });

  it('should update performance mode setting to enabled', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    service.updateSetting(SettingKey.Performance, true);

    expect(service.performance()).toBe(true);
  });

  it('should update performance mode setting to disabled', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    service.updateSetting(SettingKey.Performance, false);

    expect(service.performance()).toBe(false);
  });

  it('should update performance mode setting to auto', () => {
    mockLocalStorage.getItem.and.returnValue(null);
    service = TestBed.inject(AdvancedSettingsService);

    service.updateSetting(SettingKey.Performance, undefined);

    expect(service.performance()).toBe(undefined);
  });
});
