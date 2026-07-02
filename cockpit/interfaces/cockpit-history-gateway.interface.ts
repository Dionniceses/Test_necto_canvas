import { Observable } from 'rxjs';
import { CockpitStreamedEvent } from './cockpit-stream.interface';
import { CockpitRangeMeta, CockpitSnapshotResult, CockpitTimelineCursor } from './cockpit-timeline.interface';

export interface CockpitHistoryGateway {
  openLiveStream(date: Date): Observable<CockpitStreamedEvent>;
  getRangeMeta(date: Date): Observable<CockpitRangeMeta>;
  loadBefore(cursor: CockpitTimelineCursor, limit: number): Observable<CockpitSnapshotResult>;
  loadAfter(cursor: CockpitTimelineCursor, limit: number): Observable<CockpitSnapshotResult>;
  loadRange(fromTs: number, toTs: number, limit: number): Observable<CockpitSnapshotResult>;
}
