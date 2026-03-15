import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceMonitor, type PerformanceData } from '../lib/PerformanceMonitor';
import type { RenderingEngine } from '../../../rendering/src/RenderingEngine';

describe('PerformanceMonitor', () => {
    let monitor: PerformanceMonitor;
    let mockRenderingEngine: {
        getFrameTimeHistory: ReturnType<typeof vi.fn>;
        getCurrentFPS: ReturnType<typeof vi.fn>;
        getFrameTimeCount: ReturnType<typeof vi.fn>;
    };
    let rafCallbacks: Map<number, FrameRequestCallback>;
    let nextRafId: number;

    beforeEach(() => {
        mockRenderingEngine = {
            getFrameTimeHistory: vi.fn().mockReturnValue([]),
            getCurrentFPS: vi.fn().mockReturnValue(60),
            getFrameTimeCount: vi.fn().mockReturnValue(0),
        };

        rafCallbacks = new Map();
        nextRafId = 1;

        vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
            const id = nextRafId++;
            rafCallbacks.set(id, cb);
            return id;
        }));

        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
            rafCallbacks.delete(id);
        }));

        monitor = new PerformanceMonitor(mockRenderingEngine as unknown as RenderingEngine);
    });

    afterEach(() => {
        monitor.dispose();
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should create an instance', () => {
            expect(monitor).toBeInstanceOf(PerformanceMonitor);
        });
    });

    describe('setStateCallback', () => {
        it('should set the callback', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([16.67]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(60);

            monitor.start();

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({
                currentFPS: 60,
            }));
        });
    });

    describe('start', () => {
        it('should begin the RAF loop', () => {
            monitor.start();

            expect(requestAnimationFrame).toHaveBeenCalledOnce();
        });

        it('should be idempotent - calling twice does not double-start', () => {
            monitor.start();
            monitor.start();

            expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
        });
    });

    describe('stop', () => {
        it('should cancel the RAF loop', () => {
            monitor.start();

            // Trigger the first RAF callback so a new one is scheduled
            const firstCallback = rafCallbacks.get(1)!;
            firstCallback(0);

            // Now there should be a second RAF scheduled
            expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

            monitor.stop();

            expect(cancelAnimationFrame).toHaveBeenCalled();
        });

        it('should not throw if called when not running', () => {
            expect(() => monitor.stop()).not.toThrow();
        });
    });

    describe('dispose', () => {
        it('should stop the monitor and clear the callback', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);
            monitor.start();

            // After start, tick runs poll then schedules RAF, so rafId is set
            expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

            monitor.dispose();

            // dispose calls stop, which cancels the pending RAF
            expect(cancelAnimationFrame).toHaveBeenCalledWith(1);

            // Callback should have been cleared - simulate a RAF firing after dispose
            callback.mockClear();
            const scheduledCallback = rafCallbacks.get(1);
            if (scheduledCallback) {
                scheduledCallback(0);
            }

            // Callback should not be called since running is false
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('poll (via start/tick)', () => {
        it('should compute correct statistics from frame time history', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([10, 20, 30]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(50);

            monitor.start();

            expect(callback).toHaveBeenCalledWith({
                currentFPS: 50,
                avgFrameTime: 20,
                minFrameTime: 10,
                maxFrameTime: 30,
                frameTimeHistory: [10, 20, 30],
                frameTimeCount: 0,
            });
        });

        it('should handle empty history with min = 0', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(0);

            monitor.start();

            expect(callback).toHaveBeenCalledWith({
                currentFPS: 0,
                avgFrameTime: 0,
                minFrameTime: 0,
                maxFrameTime: 0,
                frameTimeHistory: [],
                frameTimeCount: 0,
            });
        });

        it('should handle single-element history', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([16.67]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(60);

            monitor.start();

            expect(callback).toHaveBeenCalledWith({
                currentFPS: 60,
                avgFrameTime: 16.67,
                minFrameTime: 16.67,
                maxFrameTime: 16.67,
                frameTimeHistory: [16.67],
                frameTimeCount: 0,
            });
        });

        it('should not call callback if none is set', () => {
            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([10, 20]);

            // No callback set - should not throw
            expect(() => monitor.start()).not.toThrow();

            // Rendering engine should not even be queried if no callback
            expect(mockRenderingEngine.getFrameTimeHistory).not.toHaveBeenCalled();
        });
    });

    describe('tick', () => {
        it('should call poll and schedule the next RAF', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([16]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(60);

            monitor.start();

            // First tick: poll is called, next RAF is scheduled
            expect(callback).toHaveBeenCalledTimes(1);
            expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

            // Simulate RAF firing the callback
            const scheduledCallback = rafCallbacks.get(1)!;
            scheduledCallback(0);

            expect(callback).toHaveBeenCalledTimes(2);
            expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
        });

        it('should not poll or schedule if stopped between frames', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([16]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(60);

            monitor.start();
            expect(callback).toHaveBeenCalledTimes(1);

            // Grab the scheduled RAF callback before stopping
            const scheduledCallback = rafCallbacks.get(1)!;

            monitor.stop();
            callback.mockClear();

            // Simulate RAF firing after stop - tick should bail out
            scheduledCallback(0);

            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('frameTimeCount passthrough', () => {
        it('should pass frameTimeCount from rendering engine to callback', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([16, 17]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(60);
            mockRenderingEngine.getFrameTimeCount.mockReturnValue(500);

            monitor.start();

            expect(callback).toHaveBeenCalledWith(expect.objectContaining({
                frameTimeCount: 500,
            }));
        });

        it('should update frameTimeCount as rendering engine count grows', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([16]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(60);
            mockRenderingEngine.getFrameTimeCount.mockReturnValue(100);

            monitor.start();

            expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
                frameTimeCount: 100,
            }));

            // Simulate next tick with updated count
            mockRenderingEngine.getFrameTimeCount.mockReturnValue(101);
            const scheduledCallback = rafCallbacks.get(1)!;
            scheduledCallback(0);

            expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
                frameTimeCount: 101,
            }));
        });

        it('should pass frameTimeCount even with empty history', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(0);
            mockRenderingEngine.getFrameTimeCount.mockReturnValue(0);

            monitor.start();

            expect(callback).toHaveBeenCalledWith(expect.objectContaining({
                frameTimeCount: 0,
                frameTimeHistory: [],
            }));
        });

        it('should pass frameTimeCount greater than history length when history is capped', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            // Simulate capped history: 3600 entries but 5000 total frames seen
            mockRenderingEngine.getFrameTimeHistory.mockReturnValue(Array.from({ length: 3600 }, () => 16));
            mockRenderingEngine.getCurrentFPS.mockReturnValue(60);
            mockRenderingEngine.getFrameTimeCount.mockReturnValue(5000);

            monitor.start();

            const data = callback.mock.calls[0][0] as PerformanceData;
            expect(data.frameTimeCount).toBe(5000);
            expect(data.frameTimeHistory).toHaveLength(3600);
            expect(data.frameTimeCount).toBeGreaterThan(data.frameTimeHistory.length);
        });
    });

    describe('full integration', () => {
        it('should start, poll on each frame, and deliver correct data to callback', () => {
            const callback = vi.fn();
            monitor.setStateCallback(callback);

            // Frame 1 data
            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([8, 12, 16]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(75);

            monitor.start();

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith({
                currentFPS: 75,
                avgFrameTime: 12,
                minFrameTime: 8,
                maxFrameTime: 16,
                frameTimeHistory: [8, 12, 16],
                frameTimeCount: 0,
            });

            // Frame 2 data changes
            mockRenderingEngine.getFrameTimeHistory.mockReturnValue([10, 14, 18, 22]);
            mockRenderingEngine.getCurrentFPS.mockReturnValue(55);

            const scheduledCallback = rafCallbacks.get(1)!;
            scheduledCallback(0);

            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenLastCalledWith({
                currentFPS: 55,
                avgFrameTime: 16,
                minFrameTime: 10,
                maxFrameTime: 22,
                frameTimeHistory: [10, 14, 18, 22],
                frameTimeCount: 0,
            });

            // Stop and verify no more callbacks
            monitor.stop();
            callback.mockClear();

            // Even if we trigger old RAF references, nothing happens
            const lastCallback = rafCallbacks.get(2);
            if (lastCallback) {
                lastCallback(0);
            }
            expect(callback).not.toHaveBeenCalled();
        });
    });
});
