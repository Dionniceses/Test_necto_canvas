export interface DestinationSidebarEventState {
  requestId: string;
  timestampMs: number;
  responseCode: number | null;
  flow: string | null;
}

export interface DestinationSidebarState {
  destinationName: string;
  events: DestinationSidebarEventState[];
}
