import { describe, it, expect, beforeEach, vi } from "vitest";
import { TimeManager } from "../../util/TimeManager";

describe('TimeManager', () => {
    let timeManager: TimeManager;
    let mockPerformanceNow: number;

    beforeEach(() => {
        mockPerformanceNow = 1000000; // Start at 1000 seconds
        vi.spyOn(performance, 'now').mockImplementation(() => mockPerformanceNow);
        timeManager = new TimeManager();
    });

    describe('Basic Time Management', () => {
        it('should initialize with time at 0', () => {
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBe(0);
        });

        it('should track elapsed time correctly', () => {
            mockPerformanceNow += 5000; // Advance 5 seconds
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(5.0, 1);
        });

        it('should pause and resume correctly', () => {
            mockPerformanceNow += 2000; // Advance 2 seconds
            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1);

            // Pause
            timeManager.togglePause();
            expect(timeManager.isPaused()).toBe(true);

            mockPerformanceNow += 3000; // Advance 3 more seconds while paused
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1); // Should still be 2 seconds

            // Resume
            timeManager.togglePause();
            expect(timeManager.isPaused()).toBe(false);

            mockPerformanceNow += 1000; // Advance 1 second after resume
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(3.0, 1); // Should be 3 seconds total
        });

        it('should reset time to zero', () => {
            mockPerformanceNow += 5000; // Advance 5 seconds
            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(5.0, 1);

            timeManager.cleanup();
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBe(0);
        });
    });

    describe('Speed Multiplier', () => {
        it('should initialize with speed 1.0', () => {
            expect(timeManager.getSpeed()).toBe(1.0);
        });

        it('should set and get speed', () => {
            timeManager.setSpeed(2.0);
            expect(timeManager.getSpeed()).toBe(2.0);
        });

        it('should double time progression at 2x speed', () => {
            timeManager.setSpeed(2.0);

            mockPerformanceNow += 1000; // Advance 1 real second
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1); // Should be 2 shader seconds
        });

        it('should half time progression at 0.5x speed', () => {
            timeManager.setSpeed(0.5);

            mockPerformanceNow += 2000; // Advance 2 real seconds
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(1.0, 1); // Should be 1 shader second
        });

        it('should quarter time progression at 0.25x speed', () => {
            timeManager.setSpeed(0.25);

            mockPerformanceNow += 4000; // Advance 4 real seconds
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(1.0, 1); // Should be 1 shader second
        });

        it('should quadruple time progression at 4x speed', () => {
            timeManager.setSpeed(4.0);

            mockPerformanceNow += 1000; // Advance 1 real second
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(4.0, 1); // Should be 4 shader seconds
        });

        it('should clamp speed to minimum 0.25', () => {
            timeManager.setSpeed(0.1);
            expect(timeManager.getSpeed()).toBe(0.25);
        });

        it('should clamp speed to maximum 4.0', () => {
            timeManager.setSpeed(10.0);
            expect(timeManager.getSpeed()).toBe(4.0);
        });

        it('should apply speed even when paused', () => {
            timeManager.setSpeed(2.0);
            mockPerformanceNow += 1000; // Advance 1 second

            timeManager.togglePause();
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1); // Should be 2 seconds (1s * 2x speed)
        });
    });

    describe('Loop Mode', () => {
        it('should initialize with loop disabled', () => {
            expect(timeManager.isLoopEnabled()).toBe(false);
        });

        it('should initialize with default loop duration of 60s (1 minute)', () => {
            expect(timeManager.getLoopDuration()).toBe(60);
        });

        it('should enable and disable loop', () => {
            timeManager.setLoopEnabled(true);
            expect(timeManager.isLoopEnabled()).toBe(true);

            timeManager.setLoopEnabled(false);
            expect(timeManager.isLoopEnabled()).toBe(false);
        });

        it('should set and get loop duration', () => {
            timeManager.setLoopDuration(10);
            expect(timeManager.getLoopDuration()).toBe(10);
        });

        it('should loop time when enabled', () => {
            timeManager.setLoopEnabled(true);
            timeManager.setLoopDuration(5.0);

            mockPerformanceNow += 7000; // Advance 7 seconds
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1); // Should wrap to 2 seconds (7 % 5)
        });

        it('should loop at 2π duration correctly', () => {
            timeManager.setLoopEnabled(true);
            timeManager.setLoopDuration(Math.PI * 2);

            mockPerformanceNow += 10000; // Advance 10 seconds
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            const expected = 10.0 % (Math.PI * 2);
            expect(time).toBeCloseTo(expected, 2);
        });

        it('should not loop when disabled', () => {
            timeManager.setLoopEnabled(false);
            timeManager.setLoopDuration(5.0);

            mockPerformanceNow += 7000; // Advance 7 seconds
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(7.0, 1); // Should NOT wrap
        });

        it('should apply speed before looping', () => {
            timeManager.setSpeed(2.0);
            timeManager.setLoopEnabled(true);
            timeManager.setLoopDuration(5.0);

            mockPerformanceNow += 4000; // Advance 4 real seconds
            // At 2x speed, this is 8 shader seconds
            // 8 % 5 = 3
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(3.0, 1);
        });

        it('should clamp negative loop duration to 0', () => {
            timeManager.setLoopDuration(-5.0);
            expect(timeManager.getLoopDuration()).toBe(0);
        });

        it('should handle loop duration of 0 gracefully', () => {
            timeManager.setLoopEnabled(true);
            timeManager.setLoopDuration(0);

            mockPerformanceNow += 5000;
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            // With loop duration of 0, the condition (loopDuration > 0) prevents modulo
            // so time progresses normally
            expect(time).toBeCloseTo(5.0, 1);
        });
    });

    describe('Manual Time Setting (Scrubbing)', () => {
        it('should set time to specific value', () => {
            timeManager.setTime(3.5);
            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(3.5, 1);
        });

        it('should set time accounting for speed multiplier', () => {
            timeManager.setSpeed(2.0);
            timeManager.setTime(4.0);

            // Immediately after setting
            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(4.0, 1);

            // Advance 1 second - should add 2 seconds at 2x speed
            mockPerformanceNow += 1000;
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(6.0, 1);
        });

        it('should allow scrubbing while paused', () => {
            timeManager.togglePause();
            timeManager.setTime(2.5);

            const time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.5, 1);
        });

        it('should work with loop mode', () => {
            timeManager.setLoopEnabled(true);
            timeManager.setLoopDuration(5.0);
            timeManager.setTime(3.0);

            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(3.0, 1);

            // Advance past the loop duration
            mockPerformanceNow += 3000; // +3 seconds = 6 total
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(1.0, 1); // Should loop to 1 (6 % 5)
        });

        it('should maintain continuity after scrubbing', () => {
            // Start at time 0
            mockPerformanceNow += 2000; // Advance to 2 seconds
            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1);

            // Scrub to 5 seconds
            timeManager.setTime(5.0);
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(5.0, 1);

            // Advance 3 more seconds
            mockPerformanceNow += 3000;
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(8.0, 1); // Should be 5 + 3
        });
    });

    describe('Frame Management', () => {
        it('should track frame count', () => {
            expect(timeManager.getFrame()).toBe(0);

            timeManager.incrementFrame();
            expect(timeManager.getFrame()).toBe(1);

            timeManager.incrementFrame();
            expect(timeManager.getFrame()).toBe(2);
        });

        it('should reset frame count on cleanup', () => {
            timeManager.incrementFrame();
            timeManager.incrementFrame();
            expect(timeManager.getFrame()).toBe(2);

            timeManager.cleanup();
            expect(timeManager.getFrame()).toBe(0);
        });

        it('should calculate delta time', () => {
            timeManager.updateFrame(mockPerformanceNow);

            mockPerformanceNow += 16.67; // ~60 FPS
            timeManager.updateFrame(mockPerformanceNow);

            const deltaTime = timeManager.getDeltaTime();
            expect(deltaTime).toBeCloseTo(0.01667, 3);
        });

        it('should not calculate delta time when paused', () => {
            timeManager.updateFrame(mockPerformanceNow);
            mockPerformanceNow += 16.67;
            timeManager.updateFrame(mockPerformanceNow);

            const deltaBeforePause = timeManager.getDeltaTime();

            timeManager.togglePause();
            mockPerformanceNow += 100; // Advance while paused
            timeManager.updateFrame(mockPerformanceNow);

            const deltaAfterPause = timeManager.getDeltaTime();
            expect(deltaAfterPause).toBe(deltaBeforePause); // Should not change
        });
    });

    describe('Date Functions', () => {
        it('should return current date as Float32Array', () => {
            const date = timeManager.getCurrentDate();

            expect(date).toBeInstanceOf(Float32Array);
            expect(date.length).toBe(4);

            // Should contain [year, month, day, timeInSeconds]
            expect(date[0]).toBeGreaterThan(2020); // Year
            expect(date[1]).toBeGreaterThanOrEqual(0); // Month (0-11)
            expect(date[1]).toBeLessThan(12);
            expect(date[2]).toBeGreaterThan(0); // Day
            expect(date[2]).toBeLessThanOrEqual(31);
            expect(date[3]).toBeGreaterThanOrEqual(0); // Time in seconds
            expect(date[3]).toBeLessThan(86400); // Less than 24 hours
        });
    });

    describe('Complex Scenarios', () => {
        it('should handle pause, speed change, resume sequence', () => {
            // Start and advance 2 seconds at 1x speed
            mockPerformanceNow += 2000;
            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1);

            // Pause
            timeManager.togglePause();

            // Change speed while paused (preserves current time)
            timeManager.setSpeed(2.0);
            // Time should stay at 2 seconds (preserved when speed changes)
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1);

            // Resume and advance 1 real second (= 2 shader seconds at 2x)
            timeManager.togglePause();
            mockPerformanceNow += 1000;
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(4.0, 1); // 2 + (1 * 2x speed)
        });

        it('should handle loop with varying speeds', () => {
            timeManager.setLoopEnabled(true);
            timeManager.setLoopDuration(10.0);

            // Start at 1x speed, advance 5 real seconds
            mockPerformanceNow += 5000;
            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(5.0, 1);

            // Change to 2x speed - preserves current time
            // Time stays at 5 seconds when speed changes
            timeManager.setSpeed(2.0);
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(5.0, 1);

            // Advance 0.5 real seconds = 1 shader second at 2x
            mockPerformanceNow += 500;
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(6.0, 1); // 5 + 1
        });

        it('should handle scrubbing, then looping', () => {
            timeManager.setLoopEnabled(true);
            timeManager.setLoopDuration(5.0);

            // Scrub to 4.5 seconds
            timeManager.setTime(4.5);
            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(4.5, 1);

            // Advance 1 second - should loop
            mockPerformanceNow += 1000;
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(0.5, 1); // 5.5 % 5 = 0.5
        });

        it('should handle multiple resets', () => {
            mockPerformanceNow += 5000;
            timeManager.cleanup();

            mockPerformanceNow += 3000;
            let time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(3.0, 1);

            timeManager.cleanup();
            mockPerformanceNow += 2000;
            time = timeManager.getCurrentTime(mockPerformanceNow);
            expect(time).toBeCloseTo(2.0, 1);
        });
    });
});
