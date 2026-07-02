import { InjectionToken, inject } from '@angular/core';
import { CockpitHistoryGateway } from '../interfaces/cockpit-history-gateway.interface';
import { MockCockpitHistoryGateway } from './mock-cockpit-history-gateway.service';

export const COCKPIT_HISTORY_GATEWAY = new InjectionToken<CockpitHistoryGateway>('CockpitHistoryGateway', {
  providedIn: 'root',
  factory: () => inject(MockCockpitHistoryGateway),
});
