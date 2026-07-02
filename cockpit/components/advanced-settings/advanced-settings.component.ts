import { Component, inject, ViewEncapsulation, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CapturumButtonModule } from '@capturum/ui/button';
import { CapturumDropdownModule } from '@capturum/ui/dropdown';
import { TranslateModule } from '@ngx-translate/core';
import { OverlayPanelModule } from 'primeng/overlaypanel';
import { AdvancedSettingsService } from '@features/cockpit/services/advanced-settings.service';
import { SettingKey } from '@features/cockpit/interfaces/cockpit-settings-interface';
import { Checkbox } from 'primeng/checkbox';
import { CapturumColorPickerModule } from '@capturum/ui/color-picker';
import { SliderModule } from 'primeng/slider';
import { CapturumInputNumberComponent } from '@capturum/ui/input-number';
import { SelectButton } from 'primeng/selectbutton';

@Component({
  selector: 'app-advanced-settings',
  imports: [
    FormsModule,
    CapturumDropdownModule,
    CapturumButtonModule,
    Checkbox,
    OverlayPanelModule,
    SliderModule,
    SelectButton,
    TranslateModule,
    CapturumColorPickerModule,
    CapturumInputNumberComponent,
  ],
  templateUrl: './advanced-settings.component.html',
  styleUrl: './advanced-settings.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class AdvancedSettingsComponent {
  readonly settingService = inject(AdvancedSettingsService);
  readonly fps = input<number>(0);
  readonly isOpen = signal(false);

  // Constants for setting constraints
  readonly BOX_PLACEMENT_FORMULA_MIN = 1;
  readonly BOX_PLACEMENT_FORMULA_MAX = 16;
  readonly CONTROL_SNAPSHOT_SIZE_MIN = 500;
  readonly CONTROL_SNAPSHOT_SIZE_MAX = 100000;

  showAdvancedPopup(checked: boolean): void {
    this.settingService.updateSetting(SettingKey.AdvancedInfo, checked);
  }

  changeBackgroundColor(color: string): void {
    this.settingService.updateSetting(SettingKey.BackgroundColor, color);
  }

  changeBoxPlacementFormula(value: number): void {
    this.settingService.updateSetting(SettingKey.BoxPlacementFormula, value);
  }

  changeSnapshotSize(size: number): void {
    this.settingService.updateSetting(SettingKey.ControlSnapshotSize, size);
  }

  changePerformanceMode(mode: undefined | boolean): void {
    this.settingService.updateSetting(SettingKey.Performance, mode);
  }

  resetSettings(): void {
    this.settingService.reset();
  }

  performanceMode = [
    { label: 'auto', value: undefined },
    { label: 'on', value: true },
    { label: 'off', value: false },
  ];
}
