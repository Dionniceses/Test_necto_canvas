/**
 * NDJSON Stream Handler
 * =====================
 * Handles the transformation of raw NDJSON events into batches and visual objects.
 * 
 * Data Pipeline:
 * 1. Raw NDJSON events arrive (base → hint → final)
 * 2. Events are queued with timeline metadata
 * 3. Handlers update batch properties (size, duration)
 * 4. Batches are rendered by visualization layer
 */

// ============================================================
// Type Definitions
// ============================================================

export interface TrafficBaseEvent {
    id: string;
    ts: number;
    destination: string;
    flow: string;
    flow_execution_id: string;
    trigger_ua?: string;
    trigger_ip?: string;
}

export interface TrafficHintEvent {
    id: string;
    payload_size: number;
    'ttfb-hint'?: number;
}

export interface TrafficFinalEvent {
    id: string;
    ttfb: number;
    response_size: number;
    response_code: number;
}

export interface StreamHintEvent {
    server_ts: number;
    utc_date: string;
    available_range: { from: number; to: number };
    format: string;
}

export type StreamEventKind = 'base' | 'hint' | 'final';

export interface QueuedStreamEvent {
    kind: StreamEventKind;
    payload: TrafficBaseEvent | TrafficHintEvent | TrafficFinalEvent;
    arrivalTime: number;
    eventTime: number;
    seq: number;
}

export interface ErrorEntry {
    id: number;
    message: string;
    severity: string;
    timestamp: number;
    fromIdx: number;
    toIdx: number;
}

export interface BoxErrors {
    x: number;
    y: number;
    boxIdx: number;
    entries: ErrorEntry[];
}

export interface Batch {
    requestId: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    startTime: number;
    duration: number;
    rgb: [number, number, number];
    colorNum: number;
    fromIdx: number;
    toIdx: number;
    radius: number;
}

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    color: string;
    rgb: [number, number, number];
    colorNum: number;
    connections: number[];
}

// ============================================================
// Configuration & Constants
// ============================================================

const ERROR_CHANCE = 0.003;
const ERROR_MESSAGES = [
    'Timeout exceeded', 'Connection refused', 'Data corruption detected',
    'Buffer overflow', 'Authentication failed', 'Rate limit exceeded',
    'Checksum mismatch', 'Service unavailable', 'Packet loss detected',
    'Memory allocation error',
];
const ERROR_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const MAX_TIMELINE_EVENTS = 50000;

// ============================================================
// Type Guards
// ============================================================

export function isTrafficBaseEvent(v: any): v is TrafficBaseEvent {
    return v && typeof v.id === 'string' && 
           typeof v.ts === 'number' && 
           typeof v.destination === 'string' && 
           typeof v.flow === 'string';
}

export function isTrafficHintEvent(v: any): v is TrafficHintEvent {
    return v && typeof v.id === 'string' && 
           typeof v.payload_size === 'number';
}

export function isTrafficFinalEvent(v: any): v is TrafficFinalEvent {
    return v && typeof v.id === 'string' && 
           typeof v.ttfb === 'number' && 
           typeof v.response_code === 'number';
}

export function isStreamHintEvent(v: any): v is StreamHintEvent {
    return v && typeof v.server_ts === 'number' && 
           typeof v.utc_date === 'string' && 
           v.available_range;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Hash a string to deterministically pick connection edges for requests
 * Ensures same request ID always routes through same edge
 */
export function hashString(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Convert payload size in bytes to visual radius
 * Uses logarithmic scale to keep large payloads visually manageable
 */
export function radiusFromBytes(bytes: number): number {
    const scaled = Math.log2(Math.max(32, bytes)) - 4;
    return clamp(4 + scaled, 4, 14);
}

// ============================================================
// NdjsonStreamHandler Class
// =====================================================================
// Main orchestrator for NDJSON stream processing
// =====================================================================

export class NdjsonStreamHandler {
    // Stream state
    private streamFlows: Set<string> = new Set();
    private streamDestinations: Set<string> = new Set();
    private streamSessionStartTs: number = 0;

    // Timeline state
    private timelineStartTs: number = 0;
    private timelineEndTs: number = 0;
    private timelinePlayheadTs: number = 0;
    private timelineEvents: QueuedStreamEvent[] = [];
    private streamEventSeq: number = 0;

    // Request tracking
    private requestsById: Map<string, Batch> = new Map();
    private requestTsById: Map<string, number> = new Map();

    // Batch tracking
    private batches: Batch[] = [];
    private boxErrorsMap: Map<number, BoxErrors> = new Map();
    private errorIdCounter: number = 0;
    private cachedTotalErrors: number = 0;

    // Box topology
    private boxes: Box[] = [];
    private connectionEdges: [number, number][] = [];
    private lastAutoBoxCount: number = 0;

    // Replay state
    private paused: boolean = false;
    private streamReplayActive: boolean = false;
    private streamReplayQueue: QueuedStreamEvent[] = [];
    private streamReplayClock: 'event' | 'arrival' = 'arrival';
    private streamReplayAnchorArrival: number = 0;
    private streamReplayAnchorEvent: number = 0;
    private streamReplayAnchorPlay: number = 0;

    // Callbacks
    private callbacks: {
        onBatchCreated?: (batch: Batch) => void;
        onBatchUpdated?: (batch: Batch) => void;
        onBoxesRebuilt?: (boxes: Box[], edges: [number, number][]) => void;
        onTimelineRangeUpdated?: (start: number, end: number) => void;
        onErrorAdded?: (boxIdx: number, errors: BoxErrors) => void;
    } = {};

    constructor(
        boxes: Box[],
        connectionEdges: [number, number][],
        callbacks?: typeof this.callbacks
    ) {
        this.boxes = boxes;
        this.connectionEdges = connectionEdges;
        if (callbacks) this.callbacks = callbacks;
    }

    // ── Public API ──────────────────────────────────────

    /**
     * Process incoming NDJSON event
     */
    public processNdjsonEvent(event: TrafficBaseEvent | TrafficHintEvent | TrafficFinalEvent): void {
        const arrival = performance.now();
        const eventTime = this.getEventTime(event);
        const kind = this.getEventKind(event);

        if (!kind) return;

        const queued: QueuedStreamEvent = {
            kind,
            payload: event,
            arrivalTime: arrival,
            eventTime,
            seq: this.streamEventSeq++,
        };

        this.storeTimelineEvent(queued);

        if (!this.paused && !this.streamReplayActive) {
            this.handleStreamEvent(queued);
        } else {
            this.enqueueForReplay(queued);
        }
    }

    /**
     * Handle SSE hint event (timeline metadata)
     */
    public processStreamHint(hint: StreamHintEvent): void {
        this.streamSessionStartTs = hint.server_ts;
        this.updateTimelineRange(hint.available_range.from);
        this.updateTimelineRange(hint.available_range.to);
        if (!this.streamReplayActive && !this.paused) {
            this.timelinePlayheadTs = this.timelineEndTs;
        }
    }

    /**
     * Rebuild boxes based on current flow/destination cardinality
     */
    public syncBoxesToStreamData(force: boolean = false): void {
        const nextCount = this.autoBoxCountFromStream();
        const shouldRebuild = force || 
                             this.boxes.length === 0 || 
                             Math.abs(nextCount - this.boxes.length) >= 3;
        
        if (!shouldRebuild) return;

        this.generateBoxes(nextCount);
        this.buildConnectionEdges();
        this.boxErrorsMap.clear();
        this.batches = [];
        this.requestsById.clear();
        this.lastAutoBoxCount = nextCount;

        this.callbacks.onBoxesRebuilt?.(this.boxes, this.connectionEdges);
    }

    /**
     * Set pause state
     */
    public setPaused(paused: boolean): void {
        this.paused = paused;
    }

    /**
     * Rewind and replay from specific timestamp
     */
    public replayFromTimestamp(targetTs: number): void {
        if (!this.timelineStartTs || !this.timelineEndTs || this.timelineEvents.length === 0) return;

        const clampedTarget = clamp(targetTs, this.timelineStartTs, this.timelineEndTs);
        const replayEvents = this.timelineEvents
            .filter((e) => e.eventTime >= clampedTarget)
            .sort((a, b) => (a.eventTime - b.eventTime) || (a.seq - b.seq));

        this.batches = [];
        this.requestsById.clear();
        this.streamReplayQueue = replayEvents.map(e => ({ ...e }));
        this.streamReplayClock = 'event';
        this.streamReplayActive = this.streamReplayQueue.length > 0;
        this.streamReplayAnchorPlay = performance.now();
        this.streamReplayAnchorEvent = this.streamReplayQueue.length > 0 
            ? this.streamReplayQueue[0].eventTime 
            : clampedTarget;
        
        this.timelinePlayheadTs = clampedTarget;
        this.paused = false;
    }

    /**
     * Jump to live playback
     */
    public goToLive(): void {
        this.streamReplayQueue = [];
        this.streamReplayActive = false;
        this.streamReplayClock = 'arrival';
        this.timelinePlayheadTs = this.timelineEndTs || this.timelinePlayheadTs;
        this.paused = false;
    }

    /**
     * Process queued replay events
     */
    public flushReplayQueue(nowPerf: number): void {
        if (!this.streamReplayActive) return;

        while (this.streamReplayQueue.length > 0) {
            const next = this.streamReplayQueue[0];
            const scheduledAt = this.streamReplayClock === 'event'
                ? this.streamReplayAnchorPlay + (next.eventTime - this.streamReplayAnchorEvent)
                : this.streamReplayAnchorPlay + (next.arrivalTime - this.streamReplayAnchorArrival);
            
            if (scheduledAt > nowPerf) break;

            this.streamReplayQueue.shift();
            this.handleStreamEvent(next);
            this.timelinePlayheadTs = next.eventTime;
        }

        if (this.streamReplayQueue.length === 0) {
            this.streamReplayActive = false;
        }
    }

    // ── Getters ─────────────────────────────────────────

    public getBatches(): Batch[] { return this.batches; }
    public getBoxes(): Box[] { return this.boxes; }
    public getConnectionEdges(): [number, number][] { return this.connectionEdges; }
    public getBoxErrors(): Map<number, BoxErrors> { return this.boxErrorsMap; }
    public getTotalErrors(): number { return this.cachedTotalErrors; }
    public getTimelineRange(): [number, number] { return [this.timelineStartTs, this.timelineEndTs]; }

    // ── Private Implementation ──────────────────────────

    private getEventKind(event: any): StreamEventKind | null {
        if (isTrafficBaseEvent(event)) return 'base';
        if (isTrafficHintEvent(event)) return 'hint';
        if (isTrafficFinalEvent(event)) return 'final';
        return null;
    }

    private getEventTime(event: any): number {
        if (isTrafficBaseEvent(event)) {
            this.requestTsById.set(event.id, event.ts);
            this.updateTimelineRange(event.ts);
            return event.ts;
        }

        const id = (event as TrafficHintEvent | TrafficFinalEvent).id;
        const found = this.requestTsById.get(id);
        if (typeof found === 'number') {
            this.updateTimelineRange(found);
            return found;
        }

        return this.timelineEndTs || Date.now();
    }

    private handleStreamEvent(queued: QueuedStreamEvent): void {
        if (queued.kind === 'base') {
            this.handleTrafficBase(queued.payload as TrafficBaseEvent);
        } else if (queued.kind === 'hint') {
            this.handleTrafficHint(queued.payload as TrafficHintEvent);
        } else if (queued.kind === 'final') {
            this.handleTrafficFinal(queued.payload as TrafficFinalEvent);
        }
    }

    private handleTrafficBase(base: TrafficBaseEvent): void {
        const newFlow = !this.streamFlows.has(base.flow);
        const newDestination = !this.streamDestinations.has(base.destination);
        
        if (newFlow) this.streamFlows.add(base.flow);
        if (newDestination) this.streamDestinations.add(base.destination);
        
        if (newFlow || newDestination || this.boxes.length === 0 || this.connectionEdges.length === 0) {
            this.syncBoxesToStreamData();
        }

        if (this.boxes.length === 0 || this.connectionEdges.length === 0) return;

        const [fromIdx, toIdx] = this.edgeForRequest(base);
        const from = this.boxes[fromIdx];
        const to = this.boxes[toIdx];
        
        const batch: Batch = {
            requestId: base.id,
            startX: from.x + from.w / 2,
            startY: from.y + from.h / 2,
            endX: to.x + to.w / 2,
            endY: to.y + to.h / 2,
            startTime: performance.now(),
            duration: 900,
            rgb: from.rgb,
            colorNum: from.colorNum,
            fromIdx,
            toIdx,
            radius: 6,
        };

        this.batches.push(batch);
        this.requestsById.set(base.id, batch);
        this.callbacks.onBatchCreated?.(batch);
    }

    private handleTrafficHint(hint: TrafficHintEvent): void {
        const batch = this.requestsById.get(hint.id);
        if (!batch) return;

        batch.radius = radiusFromBytes(hint.payload_size);
        if (typeof hint['ttfb-hint'] === 'number') {
            batch.duration = clamp(hint['ttfb-hint'] * 3, 300, 2400);
        }

        this.callbacks.onBatchUpdated?.(batch);
    }

    private handleTrafficFinal(final: TrafficFinalEvent): void {
        const batch = this.requestsById.get(final.id);
        if (!batch) return;

        batch.duration = clamp(final.ttfb * 3, 250, 4000);
        batch.radius = radiusFromBytes(final.response_size);

        if (final.response_code >= 400) {
            this.addError(batch.fromIdx, batch.toIdx);
        }

        this.callbacks.onBatchUpdated?.(batch);
    }

    private addError(fromIdx: number, toIdx: number): void {
        const box = this.boxes[toIdx];
        if (!box) return;

        const entry: ErrorEntry = {
            id: this.errorIdCounter++,
            message: ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)],
            severity: ERROR_SEVERITIES[Math.floor(Math.random() * ERROR_SEVERITIES.length)],
            timestamp: Date.now(),
            fromIdx,
            toIdx,
        };

        if (!this.boxErrorsMap.has(toIdx)) {
            this.boxErrorsMap.set(toIdx, {
                x: box.x + box.w + 10,
                y: box.y - 5,
                boxIdx: toIdx,
                entries: [],
            });
        }

        this.boxErrorsMap.get(toIdx)!.entries.push(entry);
        this.cachedTotalErrors++;
        this.callbacks.onErrorAdded?.(toIdx, this.boxErrorsMap.get(toIdx)!);
    }

    private updateTimelineRange(ts: number): void {
        if (!Number.isFinite(ts) || ts <= 0) return;

        const effectiveTs = this.streamSessionStartTs > 0 
            ? Math.max(ts, this.streamSessionStartTs) 
            : ts;

        if (this.timelineStartTs === 0 || effectiveTs < this.timelineStartTs) {
            this.timelineStartTs = effectiveTs;
        }
        if (this.timelineEndTs === 0 || effectiveTs > this.timelineEndTs) {
            this.timelineEndTs = effectiveTs;
        }

        this.callbacks.onTimelineRangeUpdated?.(this.timelineStartTs, this.timelineEndTs);
    }

    private storeTimelineEvent(event: QueuedStreamEvent): void {
        this.timelineEvents.push(event);
        if (this.timelineEvents.length > MAX_TIMELINE_EVENTS) {
            this.timelineEvents.splice(0, this.timelineEvents.length - MAX_TIMELINE_EVENTS);
        }
    }

    private enqueueForReplay(queued: QueuedStreamEvent): void {
        if (this.streamReplayQueue.length === 0) {
            this.streamReplayAnchorArrival = queued.arrivalTime;
            this.streamReplayAnchorEvent = queued.eventTime;
            this.streamReplayAnchorPlay = performance.now();
        }
        this.streamReplayQueue.push(queued);
    }

    private autoBoxCountFromStream(): number {
        const weighted = this.streamFlows.size * 3 + this.streamDestinations.size * 4;
        return clamp(weighted, 6, 90);
    }

    private edgeForRequest(base: TrafficBaseEvent): [number, number] {
        if (this.connectionEdges.length === 0) return [0, 0];
        const key = `${base.id}-${base.flow}-${base.destination}`;
        const idx = hashString(key) % this.connectionEdges.length;
        return this.connectionEdges[idx];
    }

    private generateBoxes(count: number): void {
        // This should be implemented by the caller to match their box generation logic
        // Placeholder: create empty boxes array
        this.boxes = [];
    }

    private buildConnectionEdges(): void {
        this.connectionEdges = [];
        const seen = new Set<string>();
        for (let i = 0; i < this.boxes.length; i++) {
            for (const j of this.boxes[i].connections) {
                const key = i < j ? `${i}-${j}` : `${j}-${i}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    this.connectionEdges.push([i, j]);
                }
            }
        }
    }
}
