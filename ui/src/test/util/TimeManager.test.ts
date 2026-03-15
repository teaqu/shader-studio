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

  describe('setFrame', () => {
    it('should set the frame directly', () => {
      timeManager.setFrame(42);
      expect(timeManager.getFrame()).toBe(42);
    });

    it('should override previously set frame', () => {
      timeManager.setFrame(5);
      timeManager.setFrame(100);
      expect(timeManager.getFrame()).toBe(100);
    });
  });

  describe('setDeltaTime', () => {
    it('should set delta time directly', () => {
      timeManager.setDeltaTime(0.016);
      expect(timeManager.getDeltaTime()).toBeCloseTo(0.016);
    });

    it('should allow setting to zero', () => {
      timeManager.setDeltaTime(0);
      expect(timeManager.getDeltaTime()).toBe(0);
    });
  });

  describe('getState / setState', () => {
    it('should return current state', () => {
      const state = timeManager.getState();
      expect(state).toHaveProperty('paused');
      expect(state).toHaveProperty('frame');
      expect(state).toHaveProperty('deltaTime');
      expect(state).toHaveProperty('speedMultiplier');
      expect(state).toHaveProperty('loopEnabled');
      expect(state).toHaveProperty('loopDuration');
    });

    it('should capture paused state', () => {
      timeManager.togglePause();
      const state = timeManager.getState();
      expect(state.paused).toBe(true);
    });

    it('should capture speed', () => {
      timeManager.setSpeed(2.0);
      const state = timeManager.getState();
      expect(state.speedMultiplier).toBe(2.0);
    });

    it('should capture frame', () => {
      timeManager.setFrame(77);
      const state = timeManager.getState();
      expect(state.frame).toBe(77);
    });

    it('should capture loop settings', () => {
      timeManager.setLoopEnabled(true);
      timeManager.setLoopDuration(30);
      const state = timeManager.getState();
      expect(state.loopEnabled).toBe(true);
      expect(state.loopDuration).toBe(30);
    });

    it('should restore state from setState', () => {
      timeManager.setSpeed(3.0);
      timeManager.setFrame(50);
      timeManager.togglePause();
      timeManager.setLoopEnabled(true);
      timeManager.setLoopDuration(10);
      const saved = timeManager.getState();

      // Create a fresh manager and restore
      const fresh = new TimeManager();
      fresh.setState(saved);

      expect(fresh.isPaused()).toBe(true);
      expect(fresh.getFrame()).toBe(50);
      expect(fresh.getSpeed()).toBe(3.0);
      expect(fresh.isLoopEnabled()).toBe(true);
      expect(fresh.getLoopDuration()).toBe(10);
    });

    it('should round-trip state correctly', () => {
      timeManager.setDeltaTime(0.033);
      timeManager.setFrame(99);
      const state1 = timeManager.getState();

      const other = new TimeManager();
      other.setState(state1);
      const state2 = other.getState();

      expect(state2.frame).toBe(state1.frame);
      expect(state2.deltaTime).toBe(state1.deltaTime);
      expect(state2.speedMultiplier).toBe(state1.speedMultiplier);
    });
  });
});
