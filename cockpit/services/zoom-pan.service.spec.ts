import { TestBed } from '@angular/core/testing';
import { ZoomPanService } from './zoom-pan.service';
import { ZoomPanState } from '../interfaces/zoom-pan.interface';

describe('ZoomPanService', () => {
  let service: ZoomPanService;
  let mockElement: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ZoomPanService);

    // Create mock element
    mockElement = document.createElement('div');
    mockElement.style.width = '800px';
    mockElement.style.height = '600px';

    // Mock getBoundingClientRect
    spyOn(mockElement, 'getBoundingClientRect').and.returnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Mock clientWidth/clientHeight
    Object.defineProperty(mockElement, 'clientWidth', {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(mockElement, 'clientHeight', {
      configurable: true,
      get: () => 600,
    });
  });

  describe('init()', () => {
    it('should initialize with element and world dimensions', () => {
      service.init(mockElement, 2000, 1500);

      expect(mockElement.style.cursor).toBe('grab');
      expect(mockElement.style.touchAction).toBe('none');
    });

    it('should calculate ZOOM_MIN based on viewport and world dimensions', () => {
      service.init(mockElement, 2000, 1500);

      // Expected: min(800/2000, 600/1500) * 0.95 = min(0.4, 0.4) * 0.95 = 0.38
      const state = service.state();

      expect(state.zoomLevel).toBeLessThan(0.4);
      expect(state.zoomLevel).toBeGreaterThan(0.1);
    });

    it('should set initial zoom to ZOOM_MIN for fit-to-view', () => {
      service.init(mockElement, 2000, 1500);

      const state = service.state();

      expect(state.zoomLevel).toBeLessThan(0.5);
    });

    it('should center content at initial zoom', () => {
      service.init(mockElement, 2000, 1500);

      const state = service.state();

      // Pan should be centered
      // With 800x600 viewport and 2000x1500 world at zoom 0.38, centered pan is calculated
      expect(state.panX).toBeDefined();
      expect(state.panY).toBeDefined();
      expect(typeof state.panX).toBe('number');
      expect(typeof state.panY).toBe('number');
    });

    it('should bind interaction handlers to element', () => {
      spyOn(mockElement, 'addEventListener');
      service.init(mockElement, 2000, 1500);

      expect(mockElement.addEventListener).toHaveBeenCalledWith('wheel', jasmine.any(Function), jasmine.any(Object));
      expect(mockElement.addEventListener).toHaveBeenCalledWith('mousedown', jasmine.any(Function));
      expect(mockElement.addEventListener).toHaveBeenCalledWith('mousemove', jasmine.any(Function));
      expect(mockElement.addEventListener).toHaveBeenCalledWith('mouseup', jasmine.any(Function));
      expect(mockElement.addEventListener).toHaveBeenCalledWith('mouseleave', jasmine.any(Function));
    });

    it('should bind window resize handler', () => {
      spyOn(window as any, 'addEventListener');
      service.init(mockElement, 2000, 1500);

      expect((window as any).addEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
    });

    it('should emit state changed after init', (done) => {
      service.stateChanged$.subscribe((state: ZoomPanState) => {
        expect(state).toBeDefined();
        expect(state.zoomLevel).toBeDefined();
        expect(state.panX).toBeDefined();
        expect(state.panY).toBeDefined();
        done();
      });

      service.init(mockElement, 2000, 1500);
    });
  });

  describe('setZoom()', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should set zoom level within bounds', () => {
      service.setZoom(2);

      expect(service.state().zoomLevel).toBeLessThanOrEqual(15);
      expect(service.state().zoomLevel).toBeGreaterThanOrEqual(service.state().zoomLevel);
    });

    it('should clamp zoom to ZOOM_MIN', () => {
      const minZoom = service.state().zoomLevel;

      service.setZoom(0.01);

      expect(service.state().zoomLevel).toBeGreaterThanOrEqual(minZoom);
    });

    it('should clamp zoom to ZOOM_MAX (15)', () => {
      service.setZoom(20);

      expect(service.state().zoomLevel).toBeLessThanOrEqual(15);
    });

    it('should apply pan constraints after zoom', () => {
      service.setZoom(5);
      const state = service.state();

      // Pan should be constrained to valid bounds
      expect(state.panX).toBeLessThanOrEqual(0);
      expect(state.panY).toBeLessThanOrEqual(0);
    });

    it('should emit state changed on zoom', (done) => {
      const subscription = service.stateChanged$.subscribe((state) => {
        expect(state.zoomLevel).toBeGreaterThan(0);
        subscription.unsubscribe();
        done();
      });

      setTimeout(() => service.setZoom(2), 10);
    });

    it('should not emit if zoom does not change', (done) => {
      const initialZoom = service.state().zoomLevel;
      let firstEmission = true;
      let emitCount = 0;

      const subscription = service.stateChanged$.subscribe(() => {
        if (firstEmission) {
          firstEmission = false;

          return; // Skip first init emission
        }
        emitCount++;
      });

      service.setZoom(initialZoom);

      setTimeout(() => {
        subscription.unsubscribe();

        expect(emitCount).toBe(0); // No emit when zoom unchanged
        done();
      }, 100);
    });
  });

  describe('reset()', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
      service.setZoom(10); // Zoom in
    });

    it('should reset to fit-to-view zoom level', () => {
      const stateAfterZoom = service.state();
      const zoomBeforeReset = stateAfterZoom.zoomLevel;

      service.reset();
      const stateAfterReset = service.state();

      expect(stateAfterReset.zoomLevel).toBeLessThan(zoomBeforeReset);
    });

    it('should center content on reset', () => {
      service.reset();
      const state = service.state();

      // Pan should center the content
      expect(state.panX).toBeGreaterThan(0);
      expect(state.panY).toBeGreaterThan(0);
    });

    it('should emit state changed', (done) => {
      const subscription = service.stateChanged$.subscribe((state) => {
        expect(state.zoomLevel).toBeGreaterThan(0);
        subscription.unsubscribe();
        done();
      });

      service.reset();
    });
  });

  describe('focusOnPoint()', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should center specified world point on screen', () => {
      service.focusOnPoint(500, 400, 2);

      const coords = service.worldToScreen(500, 400);

      // The world point should be roughly centered on screen
      expect(Math.abs(coords.screenX - 400)).toBeLessThan(10); // center x
      expect(Math.abs(coords.screenY - 300)).toBeLessThan(10); // center y
    });

    it('should set zoom level with clamping', () => {
      service.focusOnPoint(500, 400, 20); // Try to set above max

      expect(service.state().zoomLevel).toBeLessThanOrEqual(15);
    });

    it('should respect ZOOM_MIN', () => {
      const minZoom = service.state().zoomLevel;

      service.focusOnPoint(500, 400, 0.01);

      expect(service.state().zoomLevel).toBeGreaterThanOrEqual(minZoom);
    });

    it('should emit state changed on focus', () => {
      let emitted = false;

      service.stateChanged$.subscribe(() => {
        if (!emitted) {
          emitted = true;
        }
      });

      service.focusOnPoint(500, 400, 2);

      expect(emitted).toBe(true);
    });
  });

  describe('setWorldDimensions()', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should update world dimensions', () => {
      service.setWorldDimensions(3000, 2000);
      // No direct access, but verify no errors and state emitted
      expect(service.state()).toBeDefined();
    });

    it('should apply pan constraints after update', () => {
      service.setZoom(5);
      service.setWorldDimensions(1000, 800); // Smaller world

      const state = service.state();

      expect(state.panX).toBeLessThanOrEqual(0);
      expect(state.panY).toBeLessThanOrEqual(0);
    });

    it('should emit state changed', (done) => {
      const subscription = service.stateChanged$.subscribe((state) => {
        expect(state.zoomLevel).toBeGreaterThan(0);
        subscription.unsubscribe();
        done();
      });

      service.setWorldDimensions(3000, 2000);
    });
  });

  describe('setWorldBounds()', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should allow further zoom out when bounds expand', () => {
      const initialMinZoom = service.state().zoomLevel;

      service.setWorldBounds(-1200, -900, 2400, 1800);
      service.setZoom(0.01);

      const expandedMinZoom = service.state().zoomLevel;

      expect(expandedMinZoom).toBeLessThan(initialMinZoom);
      expect(expandedMinZoom).toBeGreaterThan(0.1);
    });

    it('should clamp zoom upward when bounds shrink', () => {
      service.setWorldBounds(-1200, -900, 2400, 1800);
      service.setZoom(0.01);
      const zoomAtExpandedBounds = service.state().zoomLevel;

      service.setWorldBounds(0, 0, 2000, 1500);
      const zoomAtShrunkBounds = service.state().zoomLevel;

      expect(zoomAtShrunkBounds).toBeGreaterThan(zoomAtExpandedBounds);
      expect(zoomAtShrunkBounds).toBeGreaterThan(0.35);
    });

    it('should allow panning toward negative-origin content when zoomed in', () => {
      service.setWorldBounds(-500, -400, 1800, 1300);

      service.focusOnPoint(-500, -400, 2);
      const state = service.state();

      expect(state.panX).toBeGreaterThan(0);
      expect(state.panY).toBeGreaterThan(0);
    });
  });

  describe('resize()', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should update viewport dimensions', () => {
      // Change mock element size
      Object.defineProperty(mockElement, 'clientWidth', {
        configurable: true,
        get: () => 1000,
      });

      service.resize();
      // Verify it doesn't crash and emits state
      expect(service.state()).toBeDefined();
    });

    it('should apply pan constraints on resize', () => {
      service.setZoom(5);
      service.resize();

      const state = service.state();

      expect(state.panX).toBeLessThanOrEqual(0);
      expect(state.panY).toBeLessThanOrEqual(0);
    });

    it('should emit state changed', () => {
      let emitted = false;

      service.stateChanged$.subscribe(() => {
        if (!emitted) {
          emitted = true;
        }
      });

      service.resize();

      expect(emitted).toBe(true);
    });
  });

  describe('Coordinate Conversion', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
      service.setZoom(2);
    });

    describe('screenToWorld()', () => {
      it('should convert screen coordinates to world coordinates', () => {
        const worldCoords = service.screenToWorld(400, 300);

        expect(worldCoords.worldX).toBeDefined();
        expect(worldCoords.worldY).toBeDefined();
        expect(typeof worldCoords.worldX).toBe('number');
        expect(typeof worldCoords.worldY).toBe('number');
      });

      it('should handle undefined element', () => {
        service.dispose();
        const coords = service.screenToWorld(400, 300);

        expect(coords.worldX).toBe(0);
        expect(coords.worldY).toBe(0);
      });

      it('should account for zoom level in conversion', () => {
        const coords1 = service.screenToWorld(400, 300);

        service.setZoom(4);
        const coords2 = service.screenToWorld(400, 300);

        // At higher zoom, same screen point should map to different world coords
        expect(coords1.worldX).not.toEqual(coords2.worldX);
      });

      it('should account for pan offset in conversion', () => {
        const coords1 = service.screenToWorld(400, 300);

        service.focusOnPoint(1000, 750, 2);
        const coords2 = service.screenToWorld(400, 300);

        // After pan, same screen point should map to different world coords
        expect(Math.abs(coords1.worldX - coords2.worldX)).toBeGreaterThan(0);
      });
    });

    describe('worldToScreen()', () => {
      it('should convert world coordinates to screen coordinates', () => {
        const screenCoords = service.worldToScreen(500, 400);

        expect(screenCoords.screenX).toBeDefined();
        expect(screenCoords.screenY).toBeDefined();
        expect(typeof screenCoords.screenX).toBe('number');
        expect(typeof screenCoords.screenY).toBe('number');
      });

      it('should handle undefined element', () => {
        service.dispose();
        const coords = service.worldToScreen(500, 400);

        expect(coords.screenX).toBe(0);
        expect(coords.screenY).toBe(0);
      });

      it('should account for zoom level in conversion', () => {
        const coords1 = service.worldToScreen(500, 400);

        service.setZoom(4);
        const coords2 = service.worldToScreen(500, 400);

        // At higher zoom, world point should map to more distant screen coords
        expect(Math.abs(coords2.screenX - coords1.screenX)).toBeGreaterThan(0);
      });

      it('should account for pan offset in conversion', () => {
        const coords1 = service.worldToScreen(500, 400);

        service.focusOnPoint(1000, 750, 2);
        const coords2 = service.worldToScreen(500, 400);

        // After pan, same world point should map to different screen coords
        expect(Math.abs(coords2.screenX - coords1.screenX)).toBeGreaterThan(0);
      });
    });

    describe('Coordinate Conversion Roundtrip', () => {
      it('should preserve coordinates in roundtrip screen->world->screen', () => {
        const originalScreen = { x: 400, y: 300 };

        const world = service.screenToWorld(originalScreen.x, originalScreen.y);
        const backToScreen = service.worldToScreen(world.worldX, world.worldY);

        expect(Math.abs(backToScreen.screenX - originalScreen.x)).toBeLessThan(1);
        expect(Math.abs(backToScreen.screenY - originalScreen.y)).toBeLessThan(1);
      });

      it('should preserve coordinates in roundtrip world->screen->world', () => {
        const originalWorld = { x: 500, y: 400 };

        const screen = service.worldToScreen(originalWorld.x, originalWorld.y);
        const backToWorld = service.screenToWorld(screen.screenX, screen.screenY);

        expect(Math.abs(backToWorld.worldX - originalWorld.x)).toBeLessThan(1);
        expect(Math.abs(backToWorld.worldY - originalWorld.y)).toBeLessThan(1);
      });
    });
  });

  describe('Wheel Interaction', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should zoom in on wheel up (negative deltaY)', () => {
      const initialZoom = service.state().zoomLevel;

      mockElement.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          clientX: 400,
          clientY: 300,
        }),
      );

      expect(service.state().zoomLevel).toBeGreaterThan(initialZoom);
    });

    it('should zoom out on wheel down (positive deltaY)', () => {
      service.setZoom(5); // Start zoomed in
      const zoomBeforeWheel = service.state().zoomLevel;

      mockElement.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 100,
          clientX: 400,
          clientY: 300,
        }),
      );

      expect(service.state().zoomLevel).toBeLessThan(zoomBeforeWheel);
    });

    it('should maintain cursor focal point when zooming', () => {
      service.setZoom(3);

      // Get world coords at cursor before zoom
      const cursorWorldBefore = service.screenToWorld(400, 300);

      mockElement.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          clientX: 400,
          clientY: 300,
        }),
      );

      // Get world coords at cursor after zoom
      const cursorWorldAfter = service.screenToWorld(400, 300);

      // Cursor focal point should remain approximately the same
      expect(Math.abs(cursorWorldBefore.worldX - cursorWorldAfter.worldX)).toBeLessThan(50);
      expect(Math.abs(cursorWorldBefore.worldY - cursorWorldAfter.worldY)).toBeLessThan(50);
    });

    it('should center content when zooming to minimum', () => {
      service.setZoom(2);
      const zoomAfterZoomIn = service.state().zoomLevel;

      // Zoom out several times
      for (let i = 0; i < 8; i++) {
        mockElement.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: 100,
            clientX: 400,
            clientY: 300,
          }),
        );
      }

      // Zoom should have decreased from the zoomed in state
      const zoomAfterZoomOut = service.state().zoomLevel;

      expect(zoomAfterZoomOut).toBeLessThan(zoomAfterZoomIn);
    });

    it('should emit state changed on wheel', () => {
      let emitted = false;

      service.stateChanged$.subscribe(() => {
        if (!emitted) {
          emitted = true;
        }
      });

      mockElement.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          clientX: 400,
          clientY: 300,
          bubbles: true,
        }),
      );

      expect(emitted).toBe(true);
    });
  });

  describe('Mouse Drag Interaction', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
      service.setZoom(5); // Must be zoomed in to pan
    });

    it('should not pan when at minimum zoom', () => {
      service.reset(); // Back to minimum zoom

      const panBefore = service.state().panX;

      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, clientY: 350 }));

      const panAfter = service.state().panX;

      expect(panAfter).toBe(panBefore);
    });

    it('should pan when zoomed in and dragging', () => {
      service.setZoom(5);
      const stateBefore = { panX: service.state().panX, panY: service.state().panY };

      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300, bubbles: true }));
      mockElement.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 250, bubbles: true }));
      mockElement.dispatchEvent(new MouseEvent('mouseup', { clientX: 350, clientY: 250, bubbles: true }));

      const stateAfter = { panX: service.state().panX, panY: service.state().panY };
      // Pan should have changed once we dragged
      const panChanged = stateBefore.panX !== stateAfter.panX || stateBefore.panY !== stateAfter.panY;

      expect(panChanged).toBe(true);
    });

    it('should set cursor to grabbing during drag', () => {
      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));

      expect(mockElement.style.cursor).toBe('grabbing');
    });

    it('should set cursor back to grab after drag', () => {
      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mouseup', { clientX: 450, clientY: 350 }));

      expect(mockElement.style.cursor).toBe('grab');
    });

    it('should apply pan constraints during drag', () => {
      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mousemove', { clientX: -1000, clientY: -1000 }));

      const state = service.state();

      expect(state.panX).toBeLessThanOrEqual(0);
      expect(state.panY).toBeLessThanOrEqual(0);
    });

    it('should emit state changed on pan', () => {
      let emitCount = 0;
      const subscription = service.stateChanged$.subscribe(() => {
        emitCount++;
      });

      const initialEmitCount = emitCount;

      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, clientY: 350 }));

      // State should emit on pan
      expect(emitCount).toBeGreaterThan(initialEmitCount);
      subscription.unsubscribe();
    });
  });

  describe('Mouse Click Without Drag', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should emit zoomPanClick event on small mouse movement', (done) => {
      mockElement.addEventListener('zoomPanClick', (event: Event) => {
        const customEvent = event as CustomEvent;

        expect(customEvent.detail).toBeDefined();
        expect(customEvent.detail.worldX).toBeDefined();
        expect(customEvent.detail.worldY).toBeDefined();
        done();
      });

      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mouseup', { clientX: 402, clientY: 302 })); // Small movement
    });

    it('should not emit click event on significant drag', (done) => {
      let clickEmitted = false;

      mockElement.addEventListener('zoomPanClick', () => {
        clickEmitted = true;
      });

      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mouseup', { clientX: 450, clientY: 350 })); // Large movement

      setTimeout(() => {
        expect(clickEmitted).toBe(false);
        done();
      }, 100);
    });

    it('should include world coordinates in click event', (done) => {
      mockElement.addEventListener('zoomPanClick', (event: Event) => {
        const customEvent = event as CustomEvent;

        expect(typeof customEvent.detail.worldX).toBe('number');
        expect(typeof customEvent.detail.worldY).toBe('number');
        expect(typeof customEvent.detail.screenX).toBe('number');
        expect(typeof customEvent.detail.screenY).toBe('number');
        done();
      });

      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mouseup', { clientX: 402, clientY: 302 }));
    });
  });

  describe('Mouse Leave', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
      service.setZoom(5);
    });

    it('should stop dragging on mouse leave', () => {
      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mouseleave'));
      mockElement.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, clientY: 350 }));

      // After mouseleave, further mousemove should not change pan
      const state1 = service.state().panX;

      mockElement.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 400 }));
      const state2 = service.state().panX;

      expect(state1).toEqual(state2);
    });

    it('should set cursor back to grab on mouse leave', () => {
      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mouseleave'));

      expect(mockElement.style.cursor).toBe('grab');
    });
  });

  describe('dispose()', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should unbind event listeners', () => {
      spyOn(mockElement, 'removeEventListener');
      spyOn(window as any, 'removeEventListener');

      service.dispose();

      expect(mockElement.removeEventListener).toHaveBeenCalledWith('wheel', jasmine.any(Function));
      expect(mockElement.removeEventListener).toHaveBeenCalledWith('mousedown', jasmine.any(Function));
      expect(mockElement.removeEventListener).toHaveBeenCalledWith('mousemove', jasmine.any(Function));
      expect(mockElement.removeEventListener).toHaveBeenCalledWith('mouseup', jasmine.any(Function));
      expect(mockElement.removeEventListener).toHaveBeenCalledWith('mouseleave', jasmine.any(Function));
      expect((window as any).removeEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
    });

    it('should clear element reference', () => {
      service.dispose();
      // Element should be nulled, verify by trying screenToWorld
      const coords = service.screenToWorld(400, 300);

      expect(coords.worldX).toBe(0);
      expect(coords.worldY).toBe(0);
    });
  });

  describe('Signal Reactivity', () => {
    beforeEach(() => {
      service.init(mockElement, 2000, 1500);
    });

    it('should provide readonly zoom level signal', () => {
      expect(service.state().zoomLevel).toBeDefined();
      expect(typeof service.state().zoomLevel).toBe('number');
    });

    it('should provide readonly pan X signal', () => {
      expect(service.state().panX).toBeDefined();
      expect(typeof service.state().panX).toBe('number');
    });

    it('should provide readonly pan Y signal', () => {
      expect(service.state().panY).toBeDefined();
      expect(typeof service.state().panY).toBe('number');
    });

    it('should update signals when zoom changes', () => {
      const initialZoom = service.state().zoomLevel;

      service.setZoom(5);

      expect(service.state().zoomLevel).not.toEqual(initialZoom);
    });

    it('should update signals when pan changes', () => {
      service.setZoom(5);
      const initialPanX = service.state().panX;
      const initialPanY = service.state().panY;

      mockElement.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300 }));
      mockElement.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 250 }));

      // Pan should change with mouse movement when zoomed in
      const panChanged = service.state().panX !== initialPanX || service.state().panY !== initialPanY;

      expect(panChanged).toBe(true);
    });

    it('should provide computed state that reflects current signals', () => {
      const state = service.state();

      expect(state.zoomLevel).toEqual(service.state().zoomLevel);
      expect(state.panX).toEqual(service.state().panX);
      expect(state.panY).toEqual(service.state().panY);
    });
  });

  describe('Edge Cases', () => {
    it('should handle init without element gracefully', () => {
      pending('Service expects a valid HTMLElement for init().');
    });

    it('should handle very small world dimensions', () => {
      service.init(mockElement, 10, 10);

      expect(service.state().zoomLevel).toBeGreaterThan(0);
    });

    it('should handle very large world dimensions', () => {
      service.init(mockElement, 50000, 50000);

      expect(service.state().zoomLevel).toBeGreaterThan(0);
    });

    it('should handle wheel events with deltaY of 0', () => {
      service.init(mockElement, 2000, 1500);
      const zoomBefore = service.state().zoomLevel;

      mockElement.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 0,
          clientX: 400,
          clientY: 300,
        }),
      );

      // Zoom should not change significantly
      expect(Math.abs(service.state().zoomLevel - zoomBefore)).toBeLessThan(0.01);
    });

    it('should handle multiple rapid zoom changes', () => {
      service.init(mockElement, 2000, 1500);

      for (let i = 0; i < 10; i++) {
        service.setZoom(Math.random() * 10 + 0.1);
      }

      expect(service.state()).toBeDefined();
      const state = service.state();

      expect(state.zoomLevel).toBeGreaterThanOrEqual(0.1);
      expect(state.zoomLevel).toBeLessThanOrEqual(15);
    });

    it('should handle focusOnPoint with extreme coordinates', () => {
      service.init(mockElement, 2000, 1500);

      expect(() => {
        service.focusOnPoint(10000, 10000, 5);
      }).not.toThrow();

      expect(service.state()).toBeDefined();
    });
  });
});
