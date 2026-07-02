// Manages and persists user settings for the cockpit, such as snapshot limits and rendering modes.
import { inject, Injectable, signal, effect, computed } from '@angular/core';
import { AvailableSettings, SettingKey } from '../interfaces/cockpit-settings-interface';
import { LocalStorageService } from '@capturum/ui/api';

@Injectable({
  providedIn: 'root',
})
export class AdvancedSettingsService {
  readonly #localStorage = inject(LocalStorageService);
  readonly #storageKey = 'cockpit-advanced-settings';

  readonly defaultSettings: AvailableSettings = {
    advancedinfo: false,
    controlsnapshotsize: 1000,
    performance: undefined,
    backgroundcolor: '#f5f5f5',
    boxplacementformula: 6,
  };

  readonly #state = signal<AvailableSettings>({
    ...this.defaultSettings,
    ...this.#localStorage.getItem<AvailableSettings>(this.#storageKey),
  });

  readonly advancedinfo = computed(() => this.#state().advancedinfo);
  readonly backgroundcolor = computed(() => this.#state().backgroundcolor);
  readonly boxplacementformula = computed(() => this.#state().boxplacementformula);
  readonly controlsnapshotsize = computed(() => this.#state().controlsnapshotsize);
  readonly performance = computed(() => this.#state().performance);

  constructor() {
    effect(() => {
      this.#localStorage.setItem(this.#storageKey, this.#state());
    });
  }

  reset(): void {
    this.#state.set({ ...this.defaultSettings });
  }

  updateSetting<K extends SettingKey>(key: K, value: AvailableSettings[K]): void {
    this.#state.update((current) => ({
      ...current,
      [key]: value,
    }));
  }
}
