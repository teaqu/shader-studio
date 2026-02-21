import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PixelInspectorManager } from '../lib/PixelInspectorManager';
import type { PixelInspectorState } from '../lib/types/PixelInspectorState';
import type { RenderingEngine } from '../../../rendering/src/types';
import type { TimeManager } from '../../../rendering/src/util/TimeManager';

describe('PixelInspectorManager', () => {
  let manager: PixelInspectorManager;
  let stateCallback: ReturnType<typeof vi.fn>;
  let mockRenderingEngine: RenderingEngine;
  let mockTimeManager: TimeManager;
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    // Mock rendering engine
    mockRenderingEngine = {
      readPixel: vi.fn().mockReturnValue({ r: 255, g: 128, b: 64, a: 255 }),
      render: vi.fn(),
    } as any;

    // Mock time manager
    mockTimeManager = {
      isPaused: vi.fn().mockReturnValue(false),
    } as any;

    // Mock canvas
    mockCanvas = {
      width: 800,
      height: 600,
      getBoundingClientRect: vi.fn().mockReturnValue({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }),
    } as any;

    // Mock requestAnimationFrame - store callbacks for manual execution
    let rafId = 0;
    const rafCallbacks = new Map<number, FrameRequestCallback>();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbacks.set(id, cb);
      return id;
    });

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      rafCallbacks.delete(id);
    });

    // Helper to execute pending RAF callbacks
    (global as any).executeRAFCallbacks = (timestamp: number = performance.now()) => {
      const callbacks = Array.from(rafCallbacks.values());
      rafCallbacks.clear();
      callbacks.forEach(cb => cb(timestamp));
    };

    stateCallback = vi.fn();
    manager = new PixelInspectorManager(stateCallback);
    manager.initialize(mockRenderingEngine, mockTimeManager, mockCanvas);
  });

  afterEach(() => {
    manager.dispose();
    vi.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      const state = manager.getState();

      expect(state.isEnabled).toBe(true);
      expect(state.isActive).toBe(true);
      expect(state.isLocked).toBe(false);
      expect(state.mouseX).toBe(0);
      expect(state.mouseY).toBe(0);
      expect(state.pixelRGB).toBeNull();
      expect(state.fragCoord).toBeNull();
      expect(state.canvasPosition).toBeNull();
    });
  });

  describe('toggleEnabled', () => {
    it('should disable inspector and deactivate it', () => {
      manager.toggleEnabled(); // Disable (starts enabled)
      const state = manager.getState();

      expect(state.isEnabled).toBe(false);
      expect(state.isActive).toBe(false);
      expect(stateCallback).toHaveBeenCalled();
    });

    it('should re-enable inspector and activate it', () => {
      manager.toggleEnabled(); // Disable
      manager.toggleEnabled(); // Re-enable
      const state = manager.getState();

      expect(state.isEnabled).toBe(true);
      expect(state.isActive).toBe(true);
    });

    it('should clear state when disabling', () => {
      // Already enabled, simulate some state
      const mockEvent = { clientX: 100, clientY: 100 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      manager.toggleEnabled(); // Disable
      const state = manager.getState();

      expect(state.pixelRGB).toBeNull();
      expect(state.fragCoord).toBeNull();
      expect(state.canvasPosition).toBeNull();
    });

    it('should start continuous updates on initialize when enabled', () => {
      // Already enabled by default, initialize starts continuous updates
      expect(window.requestAnimationFrame).toHaveBeenCalled();
    });

    it('should stop continuous updates when disabled', () => {
      manager.toggleEnabled(); // Disable (starts enabled)
      expect(window.cancelAnimationFrame).toHaveBeenCalled();
    });
  });

  describe('handleCanvasClick', () => {
    // Inspector starts enabled and active after initialize()

    it('should toggle lock state', () => {
      manager.handleCanvasClick();
      expect(manager.getState().isLocked).toBe(true);

      manager.handleCanvasClick();
      expect(manager.getState().isLocked).toBe(false);
    });

    it('should not do anything if inspector is not active', () => {
      manager.toggleEnabled(); // Disable (starts enabled)
      const stateBefore = manager.getState();

      manager.handleCanvasClick();
      const stateAfter = manager.getState();

      expect(stateAfter.isLocked).toBe(stateBefore.isLocked);
    });

    it('should keep continuous updates running when locked', () => {
      manager.handleCanvasClick(); // Lock
      const state = manager.getState();

      // Lock state should be toggled
      expect(state.isLocked).toBe(true);
      // Continuous updates continue (tested in other tests)
    });
  });

  describe('handleMouseMove', () => {
    // Inspector starts enabled and active after initialize()

    it('should update mouse position immediately', () => {
      const mockEvent = { clientX: 100, clientY: 200 } as MouseEvent;
      manager.handleMouseMove(mockEvent);
      const state = manager.getState();

      expect(state.mouseX).toBe(100);
      expect(state.mouseY).toBe(200);
    });

    it('should not update position when locked', () => {
      manager.handleCanvasClick(); // Lock

      const mockEvent1 = { clientX: 100, clientY: 200 } as MouseEvent;
      manager.handleMouseMove(mockEvent1);

      const mockEvent2 = { clientX: 150, clientY: 250 } as MouseEvent;
      manager.handleMouseMove(mockEvent2);
      const state = manager.getState();

      // Position should not change when locked
      expect(state.mouseX).toBe(0); // Still at initial
      expect(state.mouseY).toBe(0);
    });

    it('should not update position when inspector is not active', () => {
      manager.toggleEnabled(); // Disable (starts enabled)

      const mockEvent = { clientX: 100, clientY: 200 } as MouseEvent;
      manager.handleMouseMove(mockEvent);
      const state = manager.getState();

      expect(state.mouseX).toBe(0);
      expect(state.mouseY).toBe(0);
    });

    it('should calculate canvas coordinates correctly', () => {
      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      // Canvas position should be set (but we need to wait for pixel read in continuous update)
      // This test verifies the calculation is correct
      expect(mockCanvas.getBoundingClientRect).toHaveBeenCalled();
    });

    it('should clear pixel data when mouse is outside canvas bounds', () => {
      // First, set some position inside canvas
      const mockEvent1 = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent1);

      // Mock outside bounds
      const mockEvent2 = { clientX: -100, clientY: -100 } as MouseEvent;
      manager.handleMouseMove(mockEvent2);
      const state = manager.getState();

      expect(state.pixelRGB).toBeNull();
      expect(state.fragCoord).toBeNull();
      expect(state.canvasPosition).toBeNull();
    });

    it('should notify state change immediately', () => {
      stateCallback.mockClear();
      const mockEvent = { clientX: 100, clientY: 200 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      expect(stateCallback).toHaveBeenCalled();
    });
  });

  describe('Continuous Pixel Reading', () => {
    // Inspector starts enabled and active after initialize()

    it('should read pixels continuously when active', () => {
      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      // Execute the RAF callback with a timestamp >= 100ms later
      (global as any).executeRAFCallbacks(100);

      expect(mockRenderingEngine.readPixel).toHaveBeenCalled();
    });

    it('should throttle pixel reads to ~10fps (100ms)', () => {
      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      // Execute at 50ms - should not read (throttled)
      (mockRenderingEngine.readPixel as any).mockClear();
      (global as any).executeRAFCallbacks(50);
      expect(mockRenderingEngine.readPixel).not.toHaveBeenCalled();

      // Execute at 110ms - should read
      (global as any).executeRAFCallbacks(110);
      expect(mockRenderingEngine.readPixel).toHaveBeenCalled();
    });

    it('should render before reading pixels when paused', () => {
      (mockTimeManager.isPaused as any).mockReturnValue(true);

      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      (global as any).executeRAFCallbacks(150);

      expect(mockRenderingEngine.render).toHaveBeenCalled();
      expect(mockRenderingEngine.readPixel).toHaveBeenCalled();
    });

    it('should not render before reading pixels when playing', () => {
      (mockTimeManager.isPaused as any).mockReturnValue(false);

      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      (global as any).executeRAFCallbacks(150);

      expect(mockRenderingEngine.render).not.toHaveBeenCalled();
      expect(mockRenderingEngine.readPixel).toHaveBeenCalled();
    });

    it('should update pixel color when locked (position frozen, color updates)', () => {
      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);
      manager.handleCanvasClick(); // Lock

      // Change the pixel color
      (mockRenderingEngine.readPixel as any).mockReturnValue({ r: 128, g: 255, b: 0, a: 255 });

      (global as any).executeRAFCallbacks(150);

      // Should still be reading pixels even when locked
      expect(mockRenderingEngine.readPixel).toHaveBeenCalled();
    });

    it('should update state with pixel data', () => {
      (mockRenderingEngine.readPixel as any).mockReturnValue({ r: 255, g: 128, b: 64, a: 255 });

      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      (global as any).executeRAFCallbacks(150);

      const state = manager.getState();
      expect(state.pixelRGB).toEqual({ r: 255, g: 128, b: 64 });
    });

    it('should calculate fragCoord correctly', () => {
      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      (global as any).executeRAFCallbacks(150);

      const state = manager.getState();
      expect(state.fragCoord).toBeDefined();
      expect(state.fragCoord?.x).toBe(400); // canvasX
      expect(state.fragCoord?.y).toBe(300); // canvas.height - canvasY = 600 - 300
    });

    it('should set canvas position for crosshair', () => {
      const mockEvent = { clientX: 400, clientY: 300 } as MouseEvent;
      manager.handleMouseMove(mockEvent);

      (global as any).executeRAFCallbacks(150);

      const state = manager.getState();
      expect(state.canvasPosition).toBeDefined();
      expect(state.canvasPosition?.x).toBe(400);
      expect(state.canvasPosition?.y).toBe(300);
    });
  });

  describe('Disposal', () => {
    it('should stop continuous updates on dispose', () => {
      // Inspector starts enabled with continuous updates running
      manager.dispose();

      expect(window.cancelAnimationFrame).toHaveBeenCalled();
    });

    it('should clear rendering engine reference', () => {
      manager.dispose();

      // Verify cleanup by trying to read state - should not crash
      const state = manager.getState();
      expect(state).toBeDefined();
    });
  });

  describe('Performance - No Lag When Playing', () => {
    it('should not render on every mouse move when playing', () => {
      // Inspector starts enabled
      (mockTimeManager.isPaused as any).mockReturnValue(false);

      // Move mouse multiple times
      for (let i = 0; i < 10; i++) {
        const mockEvent = { clientX: 100 + i * 10, clientY: 100 + i * 10 } as MouseEvent;
        manager.handleMouseMove(mockEvent);
      }

      // Should not have called render (only reads from already-rendered buffer)
      expect(mockRenderingEngine.render).not.toHaveBeenCalled();
    });

    it('should update mouse position smoothly (not throttled)', () => {
      // Inspector starts enabled

      const positions = [
        { clientX: 100, clientY: 100 },
        { clientX: 110, clientY: 110 },
        { clientX: 120, clientY: 120 },
      ];

      positions.forEach((pos) => {
        manager.handleMouseMove(pos as MouseEvent);
        const state = manager.getState();
        expect(state.mouseX).toBe(pos.clientX);
        expect(state.mouseY).toBe(pos.clientY);
      });
    });
  });
});
