export interface CockpitDestinationSidebarListItem {
  requestId: string;
  responseCode: number | null;
  flow: string | null;
  timestampLabel: string;
}

export interface CockpitDestinationSidebarData {
  metricsLoading: boolean;
  errorRatePercentage: number | null;
  processedResponsesLastWindow: number;
  processedWindowMinutes: number;
  eventsLoading: boolean;
  errorsLoading: boolean;
  events: CockpitDestinationSidebarListItem[];
  errors: CockpitDestinationSidebarListItem[];
}
