import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CanvasEngine } from './engine/canvas-engine';
import { HudStats, Selection } from './engine/engine.types';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild('wrapper', { static: false })
  private wrapperRef!: ElementRef<HTMLElement>;

  @ViewChild('canvas', { static: false })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly ngZone = inject(NgZone);

  private engine: CanvasEngine | null = null;

  readonly batchCount = signal(50);
  readonly boxCount = signal(75);
  readonly paused = signal(false);
  readonly zoomPercent = signal(100);
  readonly selection = signal<Selection>({ kind: 'none' });
  readonly hud = signal<HudStats>({
    fps: 0,
    totalBatches: 0,
    visibleBatches: 0,
    zoomPercent: 100,
    boxCount: 0,
    totalErrors: 0,
    paused: false,
  });

  readonly sidebar = computed(() => this.buildSidebarModel(this.selection()));

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const wrapper = this.wrapperRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;

    this.ngZone.runOutsideAngular(() => {
      this.engine = new CanvasEngine();
      this.engine.init(
        { wrapper, canvas },
        {
          initialCounts: {
            batches: this.batchCount(),
            boxes: this.boxCount(),
          },
          events: {
            onSelectionChange: (selection) => {
              this.ngZone.run(() => this.selection.set(selection));
            },
            onHudUpdate: (stats) => {
              this.ngZone.run(() => {
                this.hud.set(stats);
                this.paused.set(stats.paused);
              });
            },
            onZoomChange: (zoomPercent) => {
              this.ngZone.run(() => this.zoomPercent.set(zoomPercent));
            },
            onRendererError: (error) => {
              console.error(error);
            },
          },
        },
      );
      this.engine.start();
    });
  }

  ngOnDestroy(): void {
    this.engine?.dispose();
    this.engine = null;
  }

  onBatchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number.parseInt(target.value, 10);
    this.batchCount.set(Number.isFinite(value) ? Math.max(0, value) : 0);
  }

  onBoxInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number.parseInt(target.value, 10);
    this.boxCount.set(Number.isFinite(value) ? Math.max(1, value) : 1);
  }

  onApply(): void {
    this.engine?.setCounts({
      batches: this.batchCount(),
      boxes: this.boxCount(),
    });
    this.selection.set({ kind: 'none' });
    this.paused.set(false);
  }

  onTogglePause(): void {
    const nextPaused = !this.paused();
    this.paused.set(nextPaused);
    this.engine?.setPaused(nextPaused);
  }

  onCloseSidebar(): void {
    this.engine?.clearSelection();
    this.selection.set({ kind: 'none' });
  }

  private buildSidebarModel(selection: Selection): SidebarModel {
    if (selection.kind === 'none') {
      return {
        kind: 'none',
        title: '',
        rows: [],
        errorBreakdown: [],
        recentErrors: [],
      };
    }

    if (selection.kind === 'box') {
      const box = selection.box;
      const mock = this.getMockData(box.label, box.connections.length);
      return {
        kind: 'box',
        title: `Box ${box.label}`,
        titleColor: box.color,
        titlePrefix: '■',
        rows: [
          { label: 'Type', value: mock.type },
          { label: 'Status', value: mock.status },
          { label: 'Throughput', value: mock.throughput },
          { label: 'Latency', value: mock.latency },
          { label: 'Uptime', value: mock.uptime },
          { label: 'Connections', value: `${box.connections.length}` },
          { label: 'Last seen', value: mock.lastSeen },
        ],
        errorBreakdown: [],
        recentErrors: [],
      };
    }

    if (selection.kind === 'line') {
      const { from, to } = selection;
      const dx = to.x + to.w / 2 - (from.x + from.w / 2);
      const dy = to.y + to.h / 2 - (from.y + from.h / 2);
      const distance = Math.round(Math.hypot(dx, dy));
      const statusList = ['Active', 'Idle', 'Processing', 'Waiting', 'Complete'];
      return {
        kind: 'line',
        title: `${from.label} → ${to.label}`,
        titlePrefix: '↔',
        rows: [
          { label: 'From', value: `Box ${from.label}`, valueColor: from.color },
          { label: 'To', value: `Box ${to.label}`, valueColor: to.color },
          { label: 'Distance', value: `${distance} units` },
          { label: 'Latency', value: `${(distance % 40) + 5} ms` },
          {
            label: 'Status',
            value:
              statusList[
                (from.label.charCodeAt(0) + to.label.charCodeAt(0)) % statusList.length
              ],
          },
        ],
        errorBreakdown: [],
        recentErrors: [],
      };
    }

    if (selection.kind === 'batch') {
      const batch = selection.batch;
      const from = selection.from;
      const to = selection.to;
      const distance = Math.hypot(batch.endX - batch.startX, batch.endY - batch.startY);
      const speed = Math.round((distance / batch.duration) * 1000);
      return {
        kind: 'batch',
        title: 'Batch',
        titlePrefix: '●',
        rows: [
          { label: 'From', value: `Box ${from.label}`, valueColor: from.color },
          { label: 'To', value: `Box ${to.label}`, valueColor: to.color },
          { label: 'Duration', value: `${Math.round(batch.duration)} ms` },
          { label: 'Speed', value: `${speed} u/s` },
        ],
        errorBreakdown: [],
        recentErrors: [],
      };
    }

    const errorBreakdownMap: Record<string, number> = {};
    for (const entry of selection.errors.entries) {
      errorBreakdownMap[entry.severity] = (errorBreakdownMap[entry.severity] || 0) + 1;
    }

    return {
      kind: 'error',
      title: `Errors — Box ${this.labelForIndex(selection.errors.boxIdx)}`,
      titlePrefix: '⚠',
      titleColor: '#ef4444',
      rows: [{ label: 'Total errors', value: `${selection.errors.entries.length}` }],
      errorBreakdown: Object.entries(errorBreakdownMap).map(([severity, count]) => ({
        severity,
        count,
        color: this.colorForSeverity(severity),
      })),
      recentErrors: selection.errors.entries
        .slice(-20)
        .reverse()
        .map((entry) => ({
          time: new Date(entry.timestamp).toLocaleTimeString(),
          severity: entry.severity,
          severityColor: this.colorForSeverity(entry.severity),
          message: entry.message,
          fromLabel: this.labelForIndex(entry.fromIdx),
        })),
    };
  }

  private colorForSeverity(severity: string): string {
    if (severity === 'Critical') {
      return '#ef4444';
    }
    if (severity === 'High') {
      return '#f97316';
    }
    if (severity === 'Medium') {
      return '#facc15';
    }
    return '#84cc16';
  }

  private getMockData(label: string, connections: number): BoxMockData {
    const statuses = ['Active', 'Idle', 'Processing', 'Waiting', 'Complete'];
    const types = ['Sensor', 'Controller', 'Gateway', 'Relay', 'Hub'];
    const seed = label.charCodeAt(0);
    return {
      type: types[seed % types.length],
      status: statuses[seed % statuses.length],
      throughput: `${((seed * 37) % 900) + 100} msg/s`,
      latency: `${((seed * 13) % 50) + 5} ms`,
      uptime: `${((seed * 7) % 99) + 1}%`,
      connections,
      lastSeen: `${seed % 60}s ago`,
    };
  }

  private labelForIndex(index: number): string {
    const label = index < 26 ? String.fromCharCode(65 + index) : `${index + 1}`;
    return label;
  }
}

interface SidebarRow {
  label: string;
  value: string;
  valueColor?: string;
}

interface SidebarErrorBreakdown {
  severity: string;
  count: number;
  color: string;
}

interface SidebarRecentError {
  time: string;
  severity: string;
  severityColor: string;
  message: string;
  fromLabel: string;
}

interface SidebarModel {
  kind: 'none' | 'box' | 'line' | 'batch' | 'error';
  title: string;
  titlePrefix?: string;
  titleColor?: string;
  rows: SidebarRow[];
  errorBreakdown: SidebarErrorBreakdown[];
  recentErrors: SidebarRecentError[];
}

interface BoxMockData {
  type: string;
  status: string;
  throughput: string;
  latency: string;
  uptime: string;
  connections: number;
  lastSeen: string;

}
