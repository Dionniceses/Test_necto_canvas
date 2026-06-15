import { CockpitMockStreamEvent } from './cockpit-stream.interface';

export type CockpitRequestDetails = Omit<CockpitMockStreamEvent, 'id'> & {
  id: string;
};
