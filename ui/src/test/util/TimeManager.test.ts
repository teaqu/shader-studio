import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimeManager } from '../../../../rendering/src/util/TimeManager';

describe('TimeManager', () => {
  let timeManager: TimeManager;

  beforeEach(() => {
    timeManager = new TimeManager();
  });

  describe('initial state', () => {
    it('should start at time ~0', () => {
      const time = timeManager.getCurrentTime(performance.now());
      expect(time).toBeCloseTo(0, 0);
    });

    it('should start at frame 0', () => {
      expect(timeManager.getFrame()).toBe(0);
    });

    it('should not be paused initially', () => {
      expect(timeManager.isPaused()).toBe(false);
    });

    it('should have speed 1.0', () => {
      expect(timeManager.getSpeed()).toBe(1.0);
    });
  });

  describe('cleanup (time reset)', () => {
    it('should reset time to 0', () => {
      // Advance time artificially via setTime
      timeManager.setTime(10);
      const timeBefore = timeManager.getCurrentTime(performance.now());
      expect(timeBefore).toBeCloseTo(10, 0);

      timeManager.cleanup();
      const timeAfter = timeManager.getCurrentTime(performance.now());
      expect(timeAfter).toBeCloseTo(0, 0);
    });

    it('should reset frame to 0', () => {
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      expect(timeManager.getFrame()).toBe(2);

      timeManager.cleanup();
      expect(timeManager.getFrame()).toBe(0);
    });

    it('should reset paused time offset', () => {
      timeManager.setTime(5);
      timeManager.togglePause(); // pause
      timeManager.cleanup();
      const time = timeManager.getCurrentTime(performance.now());
      expect(time).toBeCloseTo(0, 0);
    });
  });

  describe('setTime', () => {
    it('should set the current shader time', () => {
      timeManager.setTime(42);
      const time = timeManager.getCurrentTime(performance.now());
      expect(time).toBeCloseTo(42, 0);
    });

    it('should work with speed multiplier', () => {
      timeManager.setSpeed(2.0);
      timeManager.setTime(10);
      const time = timeManager.getCurrentTime(performance.now());
      expect(time).toBeCloseTo(10, 0);
    });
  });

  describe('pause/resume', () => {
    it('should freeze time when paused', () => {
      timeManager.setTime(5);
      timeManager.togglePause();
      expect(timeManager.isPaused()).toBe(true);

      const time = timeManager.getCurrentTime(performance.now());
      expect(time).toBeCloseTo(5, 0);
    });

    it('should resume from same time', () => {
      timeManager.setTime(5);
      timeManager.togglePause();
      timeManager.togglePause(); // resume
      expect(timeManager.isPaused()).toBe(false);

      const time = timeManager.getCurrentTime(performance.now());
      expect(time).toBeCloseTo(5, 0);
    });
  });

  describe('speed', () => {
    it('should clamp speed to min 0.25', () => {
      timeManager.setSpeed(0.1);
      expect(timeManager.getSpeed()).toBe(0.25);
    });

    it('should clamp speed to max 4.0', () => {
      timeManager.setSpeed(10);
      expect(timeManager.getSpeed()).toBe(4.0);
    });

    it('should preserve current time when changing speed', () => {
      timeManager.setTime(10);
      const timeBefore = timeManager.getCurrentTime(performance.now());

      timeManager.setSpeed(2.0);
      const timeAfter = timeManager.getCurrentTime(performance.now());

      expect(timeAfter).toBeCloseTo(timeBefore, 0);
    });
  });

  describe('loop', () => {
    it('should not loop by default', () => {
      expect(timeManager.isLoopEnabled()).toBe(false);
    });

    it('should wrap time when looping', () => {
      timeManager.setLoopEnabled(true);
      timeManager.setLoopDuration(10);
      timeManager.setTime(15);

      const time = timeManager.getCurrentTime(performance.now());
      expect(time).toBeCloseTo(5, 0);
    });
  });

  describe('frame counting', () => {
    it('should increment frames', () => {
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      expect(timeManager.getFrame()).toBe(3);
    });

    it('should reset frame to 0 only on cleanup', () => {
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      expect(timeManager.getFrame()).toBe(3);

      // cleanup resets frame
      timeManager.cleanup();
      expect(timeManager.getFrame()).toBe(0);
    });

    it('should preserve frame count across setTime calls', () => {
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      expect(timeManager.getFrame()).toBe(3);

      // setTime should NOT reset frame count
      timeManager.setTime(42);
      expect(timeManager.getFrame()).toBe(3);
    });

    it('should preserve frame count across speed changes', () => {
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      expect(timeManager.getFrame()).toBe(2);

      timeManager.setSpeed(2.0);
      expect(timeManager.getFrame()).toBe(2);
    });

    it('should preserve frame count across pause/resume', () => {
      timeManager.incrementFrame();
      timeManager.incrementFrame();
      expect(timeManager.getFrame()).toBe(2);

      timeManager.togglePause();
      expect(timeManager.getFrame()).toBe(2);

      timeManager.togglePause();
      expect(timeManager.getFrame()).toBe(2);
    });
  });
});
