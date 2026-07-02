export enum SettingKey {
  AdvancedInfo = 'advancedinfo',
  ControlSnapshotSize = 'controlsnapshotsize',
  Performance = 'performance',
  BackgroundColor = 'backgroundcolor',
  BoxPlacementFormula = 'boxplacementformula',
}

export interface AvailableSettings {
  advancedinfo: boolean;
  controlsnapshotsize: number;
  performance?: boolean;
  backgroundcolor: string;
  boxplacementformula: number;
}
