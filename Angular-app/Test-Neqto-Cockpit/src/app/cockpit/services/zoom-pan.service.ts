import { Injectable, signal, computed } from '@angular/core';
import { Subject } from 'rxjs';

export interface ZoomPanState {
  zoomLevel: number;
  panX: number;
  panY: number;
}

@Injectable({
  providedIn: 'root',
})
export class ZoomPanService {
  private ZOOM_MIN = 0.1; // Will be updated based on content
  private readonly ZOOM_MAX = 15;
  
  // State signals
  private zoomLevelSignal = signal(1.0);
  private panXSignal = signal(0);
  private panYSignal = signal(0);

  // Viewport dimensions
  private viewportWidth = 0;
  private viewportHeight = 0;

  // World dimensions (content size)
  private worldWidth = 0;
  private worldHeight = 0;

  // Interaction state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private mouseDownX = 0;
  private mouseDownY = 0;

  // Event emitters
  private stateChangedSubject = new Subject<ZoomPanState>();
  stateChanged$ = this.stateChangedSubject.asObservable();

  // Computed readonly state
  zoomLevel = this.zoomLevelSignal.asReadonly();
  panX = this.panXSignal.asReadonly();
  panY = this.panYSignal.asReadonly();

  state = computed<ZoomPanState>(() => ({
    zoomLevel: this.zoomLevelSignal(),
    panX: this.panXSignal(),
    panY: this.panYSignal(),
  }));

  // Bound event handlers
  private readonly boundWheel = (e: WheelEvent) => this.handleWheel(e);
  private readonly boundMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
  private readonly boundMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private readonly boundMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
  private readonly boundMouseLeave = () => this.handleMouseLeave();
  private readonly boundResizeHandler = () => this.handleResize();

  private element: HTMLElement | null = null;

  /**
   * Initialize the service with viewport and world dimensions
   */
  init(element: HTMLElement, worldWidth: number, worldHeight: number): void {
    this.element = element;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    // Ensure canvas has proper styles for interaction
    this.element.style.cursor = 'grab';
    if (this.element.style.touchAction !== 'none') {
      this.element.style.touchAction = 'none';
    }

    this.updateViewportDimensions();

    // Calculate zoom level needed to fit all content in viewport
    const zoomToFitWidth = this.viewportWidth / this.worldWidth;
    const zoomToFitHeight = this.viewportHeight / this.worldHeight;
    const zoomToFit = Math.min(zoomToFitWidth, zoomToFitHeight);

    // Set minimum zoom to allow seeing all content, with a small margin for zooming out
    this.ZOOM_MIN = Math.max(0.1, zoomToFit * 0.95);

    // Initialize to fit-to-view (minimum zoom)
    this.zoomLevelSignal.set(this.ZOOM_MIN);

    console.log('Zoom constraints calculated:', {
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      zoomToFit: zoomToFit,
      ZOOM_MIN: this.ZOOM_MIN,
      ZOOM_MAX: this.ZOOM_MAX
    });

    this.bindInteractionHandlers();
    this.emitStateChanged();
  }

  /**
   * Update world dimensions (content size)
   */
  setWorldDimensions(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
    this.applyPanConstraints();
    this.emitStateChanged();
  }

  /**
   * Manual resize (typically called from a resize observer or resize event)
   */
  resize(): void {
    this.updateViewportDimensions();
    this.applyPanConstraints();
    this.emitStateChanged();
  }

  /**
   * Set zoom to a specific level
   */
  setZoom(level: number): void {
    const newZoom = Math.min(Math.max(level, this.ZOOM_MIN), this.ZOOM_MAX);
    if (newZoom !== this.zoomLevelSignal()) {
      this.zoomLevelSignal.set(newZoom);
      this.applyPanConstraints();
      this.emitStateChanged();
    }
  }

  /**
   * Reset to fit-to-view state (zoomed out to see all content)
   */
  reset(): void {
    const scaledWidth = this.worldWidth * this.ZOOM_MIN;
    const scaledHeight = this.worldHeight * this.ZOOM_MIN;
    this.zoomLevelSignal.set(this.ZOOM_MIN);
    this.panXSignal.set((this.viewportWidth - scaledWidth) / 2);
    this.panYSignal.set((this.viewportHeight - scaledHeight) / 2);
    this.applyPanConstraints();
    this.emitStateChanged();
  }

  /**
   * Focus on a specific world point
   */
  focusOnPoint(worldX: number, worldY: number, zoomLevel: number = 1): void {
    const zoom = Math.min(Math.max(zoomLevel, this.ZOOM_MIN), this.ZOOM_MAX);
    this.zoomLevelSignal.set(zoom);

    // Center the point on screen
    this.panXSignal.set(this.viewportWidth / 2 - worldX * zoom);
    this.panYSignal.set(this.viewportHeight / 2 - worldY * zoom);

    this.applyPanConstraints();
    this.emitStateChanged();
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.unbindInteractionHandlers();
    this.element = null;
  }

  // ── Private methods ────────────────────────────────────

  private updateViewportDimensions(): void {
    if (!this.element) return;
    this.viewportWidth = this.element.clientWidth;
    this.viewportHeight = this.element.clientHeight;
  }

  private applyPanConstraints(): void {
    // When at minimum zoom (fit-to-view), force pan to center
    if (Math.abs(this.zoomLevelSignal() - this.ZOOM_MIN) < 0.0001) {
      const scaledWidth = this.worldWidth * this.zoomLevelSignal();
      const scaledHeight = this.worldHeight * this.zoomLevelSignal();

      this.panXSignal.set((this.viewportWidth - scaledWidth) / 2);
      this.panYSignal.set((this.viewportHeight - scaledHeight) / 2);
      return;
    }

    // When zoomed in, allow panning but constrain to bounds
    const minPanX = this.viewportWidth - this.worldWidth * this.zoomLevelSignal();
    const minPanY = this.viewportHeight - this.worldHeight * this.zoomLevelSignal();

    const constrainedPanX = Math.min(0, Math.max(minPanX, this.panXSignal()));
    const constrainedPanY = Math.min(0, Math.max(minPanY, this.panYSignal()));

    this.panXSignal.set(constrainedPanX);
    this.panYSignal.set(constrainedPanY);
  }

  private bindInteractionHandlers(): void {
    if (!this.element || typeof window === 'undefined') return;

    window.addEventListener('resize', this.boundResizeHandler);
    this.element.addEventListener('wheel', this.boundWheel, { passive: false });
    this.element.addEventListener('mousedown', this.boundMouseDown);
    this.element.addEventListener('mousemove', this.boundMouseMove);
    this.element.addEventListener('mouseup', this.boundMouseUp);
    this.element.addEventListener('mouseleave', this.boundMouseLeave);
  }

  private unbindInteractionHandlers(): void {
    if (typeof window === 'undefined') return;

    window.removeEventListener('resize', this.boundResizeHandler);
    if (!this.element) return;

    this.element.removeEventListener('wheel', this.boundWheel);
    this.element.removeEventListener('mousedown', this.boundMouseDown);
    this.element.removeEventListener('mousemove', this.boundMouseMove);
    this.element.removeEventListener('mouseup', this.boundMouseUp);
    this.element.removeEventListener('mouseleave', this.boundMouseLeave);
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault();

    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(this.zoomLevelSignal() * factor, this.ZOOM_MIN), this.ZOOM_MAX);

    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();

    // Check if we're zooming back to minimum (fit-to-view)
    const isZoomingToMinimum = Math.abs(newZoom - this.ZOOM_MIN) < 0.0001;

    if (isZoomingToMinimum) {
      // When zooming back to fit-to-view, center the content
      this.zoomLevelSignal.set(newZoom);
      const scaledWidth = this.worldWidth * this.ZOOM_MIN;
      const scaledHeight = this.worldHeight * this.ZOOM_MIN;

      this.panXSignal.set((this.viewportWidth - scaledWidth) / 2);
      this.panYSignal.set((this.viewportHeight - scaledHeight) / 2);
    } else {
      // When zoomed in, maintain cursor focal point
      const mouseX = ((event.clientX - rect.left) - this.panXSignal()) / this.zoomLevelSignal();
      const mouseY = ((event.clientY - rect.top) - this.panYSignal()) / this.zoomLevelSignal();

      this.zoomLevelSignal.set(newZoom);
      this.panXSignal.set((event.clientX - rect.left) - mouseX * newZoom);
      this.panYSignal.set((event.clientY - rect.top) - mouseY * newZoom);
    }

    this.applyPanConstraints();
    this.emitStateChanged();
  }

  private handleMouseDown(event: MouseEvent): void {
    this.isDragging = true;
    this.mouseDownX = event.clientX;
    this.mouseDownY = event.clientY;
    this.dragStartX = event.clientX - this.panXSignal();
    this.dragStartY = event.clientY - this.panYSignal();

    if (this.element) {
      this.element.style.cursor = 'grabbing';
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging) return;

    // Don't allow panning when at minimum zoom (fit-to-view)
    if (Math.abs(this.zoomLevelSignal() - this.ZOOM_MIN) < 0.0001) {
      return;
    }

    this.panXSignal.set(event.clientX - this.dragStartX);
    this.panYSignal.set(event.clientY - this.dragStartY);

    this.applyPanConstraints();
    this.emitStateChanged();
  }

  private handleMouseUp(event: MouseEvent): void {
    const wasDrag =
      Math.abs(event.clientX - this.mouseDownX) > 5 ||
      Math.abs(event.clientY - this.mouseDownY) > 5;

    this.isDragging = false;

    if (this.element) {
      this.element.style.cursor = 'grab';
    }

    if (wasDrag) return;

    // Click without drag - you can emit a click event for handling
    if (this.element) {
      const rect = this.element.getBoundingClientRect();
      const worldX = (event.clientX - rect.left - this.panXSignal()) / this.zoomLevelSignal();
      const worldY = (event.clientY - rect.top - this.panYSignal()) / this.zoomLevelSignal();

      // Emit click with world coordinates
      const clickEvent = new CustomEvent('zoomPanClick', {
        detail: { worldX, worldY, screenX: event.clientX, screenY: event.clientY },
      });
      this.element.dispatchEvent(clickEvent);
    }
  }

  private handleMouseLeave(): void {
    this.isDragging = false;

    if (this.element) {
      this.element.style.cursor = 'grab';
    }
  }

  private handleResize(): void {
    this.resize();
  }

  private emitStateChanged(): void {
    this.stateChangedSubject.next(this.state());
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): { worldX: number; worldY: number } {
    if (!this.element) {
      return { worldX: 0, worldY: 0 };
    }

    const rect = this.element.getBoundingClientRect();
    const relativeX = screenX - rect.left;
    const relativeY = screenY - rect.top;

    return {
      worldX: (relativeX - this.panXSignal()) / this.zoomLevelSignal(),
      worldY: (relativeY - this.panYSignal()) / this.zoomLevelSignal(),
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(worldX: number, worldY: number): { screenX: number; screenY: number } {
    if (!this.element) {
      return { screenX: 0, screenY: 0 };
    }

    const rect = this.element.getBoundingClientRect();
    
    return {
      screenX: worldX * this.zoomLevelSignal() + this.panXSignal() + rect.left,
      screenY: worldY * this.zoomLevelSignal() + this.panYSignal() + rect.top,
    };
  }
}
