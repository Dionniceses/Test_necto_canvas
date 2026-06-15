import { Injectable, signal, computed } from '@angular/core';
import { Subject } from 'rxjs';
import { ZoomPanState } from '../interfaces/zoom-pan.interface';

@Injectable({
  providedIn: 'root',
})
export class ZoomPanService {
  #ZOOM_MIN = 0.1; // Will be updated based on content
  readonly #ZOOM_MAX = 15;

  // State signals
  #zoomLevelSignal = signal(1.0);
  #panXSignal = signal(0);
  #panYSignal = signal(0);

  // Viewport dimensions
  #viewportWidth = 0;
  #viewportHeight = 0;

  // World dimensions (content size)
  #worldMinX = 0;
  #worldMinY = 0;
  #worldWidth = 0;
  #worldHeight = 0;

  // Interaction state
  #isDragging = false;
  #dragStartX = 0;
  #dragStartY = 0;
  #mouseDownX = 0;
  #mouseDownY = 0;

  // Event emitters
  #stateChangedSubject = new Subject<ZoomPanState>();
  stateChanged$ = this.#stateChangedSubject.asObservable();

  // Computed readonly state
  #zoomLevel = this.#zoomLevelSignal.asReadonly();
  #panX = this.#panXSignal.asReadonly();
  #panY = this.#panYSignal.asReadonly();

  state = computed<ZoomPanState>(() => ({
    zoomLevel: this.#zoomLevelSignal(),
    panX: this.#panXSignal(),
    panY: this.#panYSignal(),
  }));

  // Bound event handlers
  readonly #boundWheel = (e: WheelEvent) => this.#handleWheel(e);
  readonly #boundMouseDown = (e: MouseEvent) => this.#handleMouseDown(e);
  readonly #boundMouseMove = (e: MouseEvent) => this.#handleMouseMove(e);
  readonly #boundMouseUp = (e: MouseEvent) => this.#handleMouseUp(e);
  readonly #boundMouseLeave = () => this.#handleMouseLeave();
  readonly #boundResizeHandler = () => this.#handleResize();

  #element: HTMLElement | null = null;

  #updateZoomMin(): void {
    if (this.#viewportWidth <= 0 || this.#viewportHeight <= 0 || this.#worldWidth <= 0 || this.#worldHeight <= 0) {
      this.#ZOOM_MIN = 0.1;

      return;
    }

    const zoomToFitWidth = this.#viewportWidth / this.#worldWidth;
    const zoomToFitHeight = this.#viewportHeight / this.#worldHeight;
    const zoomToFit = Math.min(zoomToFitWidth, zoomToFitHeight);

    // Allow a tiny extra zoom-out margin below strict fit.
    this.#ZOOM_MIN = Math.max(0.1, zoomToFit * 0.95);
  }

  #clampZoomToBounds(): void {
    if (this.#zoomLevelSignal() < this.#ZOOM_MIN) {
      this.#zoomLevelSignal.set(this.#ZOOM_MIN);
    }
  }

  /**
   * Initialize the service with viewport and world dimensions
   */
  init(element: HTMLElement, worldWidth: number, worldHeight: number): void {
    this.#element = element;
    this.#worldMinX = 0;
    this.#worldMinY = 0;
    this.#worldWidth = Math.max(1, worldWidth);
    this.#worldHeight = Math.max(1, worldHeight);

    // Ensure canvas has proper styles for interaction
    this.#element.style.cursor = 'grab';
    if (this.#element.style.touchAction !== 'none') {
      this.#element.style.touchAction = 'none';
    }

    this.#updateViewportDimensions();
    this.#updateZoomMin();

    // Initialize to fit-to-view (minimum zoom)
    this.#zoomLevelSignal.set(this.#ZOOM_MIN);

    console.log('Zoom constraints calculated:', {
      viewportWidth: this.#viewportWidth,
      viewportHeight: this.#viewportHeight,
      worldWidth: this.#worldWidth,
      worldHeight: this.#worldHeight,
      ZOOM_MIN: this.#ZOOM_MIN,
      ZOOM_MAX: this.#ZOOM_MAX,
    });

    this.#bindInteractionHandlers();
    this.#emitStateChanged();
  }

  /**
   * Update world dimensions (content size)
   */
  setWorldDimensions(width: number, height: number): void {
    this.#worldMinX = 0;
    this.#worldMinY = 0;
    this.#worldWidth = Math.max(1, width);
    this.#worldHeight = Math.max(1, height);
    this.#updateZoomMin();
    this.#clampZoomToBounds();
    this.#applyPanConstraints();
    this.#emitStateChanged();
  }

  /**
   * Update world bounds (content extents), including negative coordinates.
   */
  setWorldBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    const normalizedMinX = Math.min(minX, maxX);
    const normalizedMinY = Math.min(minY, maxY);
    const normalizedMaxX = Math.max(minX, maxX);
    const normalizedMaxY = Math.max(minY, maxY);

    this.#worldMinX = normalizedMinX;
    this.#worldMinY = normalizedMinY;
    this.#worldWidth = Math.max(1, normalizedMaxX - normalizedMinX);
    this.#worldHeight = Math.max(1, normalizedMaxY - normalizedMinY);
    this.#updateZoomMin();
    this.#clampZoomToBounds();

    this.#applyPanConstraints();
    this.#emitStateChanged();
  }

  /**
   * Manual resize (typically called from a resize observer or resize event)
   */
  resize(): void {
    this.#updateViewportDimensions();
    this.#updateZoomMin();
    this.#clampZoomToBounds();
    this.#applyPanConstraints();
    this.#emitStateChanged();
  }

  /**
   * Set zoom to a specific level
   */
  setZoom(level: number): void {
    const newZoom = Math.min(Math.max(level, this.#ZOOM_MIN), this.#ZOOM_MAX);

    if (newZoom !== this.#zoomLevelSignal()) {
      this.#zoomLevelSignal.set(newZoom);
      this.#applyPanConstraints();
      this.#emitStateChanged();
    }
  }

  /**
   * Reset to fit-to-view state (zoomed out to see all content)
   */
  reset(): void {
    const scaledWidth = this.#worldWidth * this.#ZOOM_MIN;
    const scaledHeight = this.#worldHeight * this.#ZOOM_MIN;

    this.#zoomLevelSignal.set(this.#ZOOM_MIN);
    this.#panXSignal.set((this.#viewportWidth - scaledWidth) / 2 - this.#worldMinX * this.#ZOOM_MIN);
    this.#panYSignal.set((this.#viewportHeight - scaledHeight) / 2 - this.#worldMinY * this.#ZOOM_MIN);
    this.#applyPanConstraints();
    this.#emitStateChanged();
  }

  /**
   * Focus on a specific world point
   */
  focusOnPoint(worldX: number, worldY: number, zoomLevel: number = 1): void {
    const zoom = Math.min(Math.max(zoomLevel, this.#ZOOM_MIN), this.#ZOOM_MAX);

    this.#zoomLevelSignal.set(zoom);

    // Center the point on screen
    this.#panXSignal.set(this.#viewportWidth / 2 - worldX * zoom);
    this.#panYSignal.set(this.#viewportHeight / 2 - worldY * zoom);

    this.#applyPanConstraints();
    this.#emitStateChanged();
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.#unbindInteractionHandlers();
    this.#element = null;
  }

  // ── Private methods ────────────────────────────────────

  #updateViewportDimensions(): void {
    if (!this.#element) return;
    this.#viewportWidth = this.#element.clientWidth;
    this.#viewportHeight = this.#element.clientHeight;
  }

  #applyPanConstraints(): void {
    const zoomLevel = this.#zoomLevelSignal();
    const scaledWidth = this.#worldWidth * zoomLevel;
    const scaledHeight = this.#worldHeight * zoomLevel;
    const centeredPanX = (this.#viewportWidth - scaledWidth) / 2 - this.#worldMinX * zoomLevel;
    const centeredPanY = (this.#viewportHeight - scaledHeight) / 2 - this.#worldMinY * zoomLevel;

    // When at minimum zoom (fit-to-view), force pan to center
    if (Math.abs(zoomLevel - this.#ZOOM_MIN) < 0.0001) {
      this.#panXSignal.set(centeredPanX);
      this.#panYSignal.set(centeredPanY);

      return;
    }

    if (scaledWidth <= this.#viewportWidth && scaledHeight <= this.#viewportHeight) {
      this.#panXSignal.set(centeredPanX);
      this.#panYSignal.set(centeredPanY);

      return;
    }

    // When zoomed in, allow panning but constrain to bounds
    const worldMaxX = this.#worldMinX + this.#worldWidth;
    const worldMaxY = this.#worldMinY + this.#worldHeight;
    const minPanX = this.#viewportWidth - worldMaxX * zoomLevel;
    const minPanY = this.#viewportHeight - worldMaxY * zoomLevel;
    const maxPanX = -this.#worldMinX * zoomLevel;
    const maxPanY = -this.#worldMinY * zoomLevel;

    const constrainedPanX =
      scaledWidth <= this.#viewportWidth ? centeredPanX : Math.min(maxPanX, Math.max(minPanX, this.#panXSignal()));
    const constrainedPanY =
      scaledHeight <= this.#viewportHeight ? centeredPanY : Math.min(maxPanY, Math.max(minPanY, this.#panYSignal()));

    this.#panXSignal.set(constrainedPanX);
    this.#panYSignal.set(constrainedPanY);
  }

  #bindInteractionHandlers(): void {
    if (!this.#element || typeof window === 'undefined') return;

    window.addEventListener('resize', this.#boundResizeHandler);
    this.#element.addEventListener('wheel', this.#boundWheel, { passive: false });
    this.#element.addEventListener('mousedown', this.#boundMouseDown);
    this.#element.addEventListener('mousemove', this.#boundMouseMove);
    this.#element.addEventListener('mouseup', this.#boundMouseUp);
    this.#element.addEventListener('mouseleave', this.#boundMouseLeave);
  }

  #unbindInteractionHandlers(): void {
    if (typeof window === 'undefined') return;

    window.removeEventListener('resize', this.#boundResizeHandler);
    if (!this.#element) return;

    this.#element.removeEventListener('wheel', this.#boundWheel);
    this.#element.removeEventListener('mousedown', this.#boundMouseDown);
    this.#element.removeEventListener('mousemove', this.#boundMouseMove);
    this.#element.removeEventListener('mouseup', this.#boundMouseUp);
    this.#element.removeEventListener('mouseleave', this.#boundMouseLeave);
  }

  #handleWheel(event: WheelEvent): void {
    event.preventDefault();

    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(this.#zoomLevelSignal() * factor, this.#ZOOM_MIN), this.#ZOOM_MAX);

    if (!this.#element) return;
    const rect = this.#element.getBoundingClientRect();

    // Check if we're zooming back to minimum (fit-to-view)
    const isZoomingToMinimum = Math.abs(newZoom - this.#ZOOM_MIN) < 0.0001;

    if (isZoomingToMinimum) {
      // When zooming back to fit-to-view, center the content
      this.#zoomLevelSignal.set(newZoom);
      const scaledWidth = this.#worldWidth * this.#ZOOM_MIN;
      const scaledHeight = this.#worldHeight * this.#ZOOM_MIN;

      this.#panXSignal.set((this.#viewportWidth - scaledWidth) / 2 - this.#worldMinX * this.#ZOOM_MIN);
      this.#panYSignal.set((this.#viewportHeight - scaledHeight) / 2 - this.#worldMinY * this.#ZOOM_MIN);
    } else {
      // When zoomed in, maintain cursor focal point
      const mouseX = (event.clientX - rect.left - this.#panXSignal()) / this.#zoomLevelSignal();
      const mouseY = (event.clientY - rect.top - this.#panYSignal()) / this.#zoomLevelSignal();

      this.#zoomLevelSignal.set(newZoom);
      this.#panXSignal.set(event.clientX - rect.left - mouseX * newZoom);
      this.#panYSignal.set(event.clientY - rect.top - mouseY * newZoom);
    }

    this.#applyPanConstraints();
    this.#emitStateChanged();
  }

  #handleMouseDown(event: MouseEvent): void {
    this.#isDragging = true;
    this.#mouseDownX = event.clientX;
    this.#mouseDownY = event.clientY;
    this.#dragStartX = event.clientX - this.#panXSignal();
    this.#dragStartY = event.clientY - this.#panYSignal();

    if (this.#element) {
      this.#element.style.cursor = 'grabbing';
    }
  }

  #handleMouseMove(event: MouseEvent): void {
    if (!this.#isDragging) return;

    // Don't allow panning when at minimum zoom (fit-to-view)
    if (Math.abs(this.#zoomLevelSignal() - this.#ZOOM_MIN) < 0.0001) {
      return;
    }

    this.#panXSignal.set(event.clientX - this.#dragStartX);
    this.#panYSignal.set(event.clientY - this.#dragStartY);

    this.#applyPanConstraints();
    this.#emitStateChanged();
  }

  #handleMouseUp(event: MouseEvent): void {
    const wasDrag = Math.abs(event.clientX - this.#mouseDownX) > 5 || Math.abs(event.clientY - this.#mouseDownY) > 5;

    this.#isDragging = false;

    if (this.#element) {
      this.#element.style.cursor = 'grab';
    }

    if (wasDrag) return;

    // Click without drag - you can emit a click event for handling
    if (this.#element) {
      const rect = this.#element.getBoundingClientRect();
      const worldX = (event.clientX - rect.left - this.#panXSignal()) / this.#zoomLevelSignal();
      const worldY = (event.clientY - rect.top - this.#panYSignal()) / this.#zoomLevelSignal();

      // Emit click with world coordinates
      const clickEvent = new CustomEvent('zoomPanClick', {
        detail: { worldX, worldY, screenX: event.clientX, screenY: event.clientY },
      });

      this.#element.dispatchEvent(clickEvent);
    }
  }

  #handleMouseLeave(): void {
    this.#isDragging = false;

    if (this.#element) {
      this.#element.style.cursor = 'grab';
    }
  }

  #handleResize(): void {
    this.resize();
  }

  #emitStateChanged(): void {
    this.#stateChangedSubject.next(this.state());
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): { worldX: number; worldY: number } {
    if (!this.#element) {
      return { worldX: 0, worldY: 0 };
    }

    const rect = this.#element.getBoundingClientRect();
    const relativeX = screenX - rect.left;
    const relativeY = screenY - rect.top;

    return {
      worldX: (relativeX - this.#panXSignal()) / this.#zoomLevelSignal(),
      worldY: (relativeY - this.#panYSignal()) / this.#zoomLevelSignal(),
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(worldX: number, worldY: number): { screenX: number; screenY: number } {
    if (!this.#element) {
      return { screenX: 0, screenY: 0 };
    }

    const rect = this.#element.getBoundingClientRect();

    return {
      screenX: worldX * this.#zoomLevelSignal() + this.#panXSignal() + rect.left,
      screenY: worldY * this.#zoomLevelSignal() + this.#panYSignal() + rect.top,
    };
  }
}
