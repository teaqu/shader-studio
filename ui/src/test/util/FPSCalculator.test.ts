import { describe, it, expect, beforeEach } from 'vitest';
import { FPSCalculator } from '../../../src/lib/util/FPSCalculator';

describe('FPSCalculator', () => {
  let fpsCalculator: FPSCalculator;

  beforeEach(() => {
    fpsCalculator = new FPSCalculator(30, 5);
  });

  it('should initialize with default values', () => {
    expect(fpsCalculator.getFPS()).toBe(0); // Initial FPS is 0, not 60
    expect(fpsCalculator.getRawFPS()).toBe(0);
    expect(fpsCalculator.getSampleCount()).toBe(0);
    expect(fpsCalculator.isStable()).toBe(false);
  });

  it('should handle first frame correctly', () => {
    const result = fpsCalculator.updateFrame(100);
    expect(result).toBe(false);
    expect(fpsCalculator.getFPS()).toBe(60);
    expect(fpsCalculator.getSampleCount()).toBe(0);
  });

  it('should calculate FPS from frame times', () => {
    fpsCalculator.updateFrame(0);
    
    // Simulate 60 FPS (16.67ms per frame)
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 16.67);
    }
    
    expect(fpsCalculator.isStable()).toBe(true);
    expect(fpsCalculator.getSampleCount()).toBe(9); // 9 frame times for 10 frames
    expect(fpsCalculator.getFPS()).toBeCloseTo(60, 0);
  });

  it('should calculate FPS for different frame rates', () => {
    fpsCalculator.updateFrame(0);
    
    // Simulate 30 FPS (33.33ms per frame)
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 33.33);
    }
    
    expect(fpsCalculator.getFPS()).toBeCloseTo(30, 0);
  });

  it('should maintain rolling window size', () => {
    const smallCalculator = new FPSCalculator(5, 3);
    smallCalculator.updateFrame(0);
    
    // Add more frames than window size
    for (let i = 1; i <= 10; i++) {
      smallCalculator.updateFrame(i * 16.67);
    }
    
    expect(smallCalculator.getSampleCount()).toBe(5);
  });

  it('should ignore invalid frame times', () => {
    fpsCalculator.updateFrame(0);
    
    // Add enough valid frames to reach minimum
    for (let i = 1; i <= 6; i++) {
      fpsCalculator.updateFrame(i * 16.67);
    }
    expect(fpsCalculator.getSampleCount()).toBe(5);
    
    // Add invalid frame (too long - <10 FPS, >100ms)
    fpsCalculator.updateFrame(1000); // Way too long frame time
    expect(fpsCalculator.getSampleCount()).toBe(5); // Should not increase
    
    // Add another valid frame
    fpsCalculator.updateFrame(1016.67);
    expect(fpsCalculator.getSampleCount()).toBe(6); // Should increase now
  });

  it('should reset correctly', () => {
    fpsCalculator.updateFrame(0);
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 16.67);
    }
    
    expect(fpsCalculator.getSampleCount()).toBeGreaterThan(0);
    
    fpsCalculator.reset();
    
    expect(fpsCalculator.getFPS()).toBe(60);
    expect(fpsCalculator.getSampleCount()).toBe(0);
    expect(fpsCalculator.isStable()).toBe(false);
  });

  it('should return rounded vs raw FPS correctly', () => {
    fpsCalculator.updateFrame(0);
    
    // Simulate slightly irregular timing that would result in non-integer FPS
    const frameTimes = [16.1, 16.8, 16.5, 16.9, 16.3];
    let time = 0;
    
    frameTimes.forEach(frameTime => {
      time += frameTime;
      fpsCalculator.updateFrame(time);
    });
    
    const rawFPS = fpsCalculator.getRawFPS();
    const roundedFPS = fpsCalculator.getFPS(true);
    const unroundedFPS = fpsCalculator.getFPS(false);
    
    expect(roundedFPS).toBe(Math.round(rawFPS));
    expect(unroundedFPS).toBe(rawFPS);
  });

  it('should handle high frame rates', () => {
    fpsCalculator.updateFrame(0);
    
    // Simulate 120 FPS (8.33ms per frame)
    for (let i = 1; i <= 10; i++) {
      fpsCalculator.updateFrame(i * 8.33);
    }
    
    expect(fpsCalculator.getFPS()).toBeCloseTo(120, 0);
  });

  it('should require minimum samples for stability', () => {
    const calculator = new FPSCalculator(30, 8);
    calculator.updateFrame(0);
    
    // Add fewer than minimum samples
    for (let i = 1; i <= 5; i++) {
      calculator.updateFrame(i * 16.67);
    }
    
    expect(calculator.isStable()).toBe(false);
    
    // Add more samples to reach minimum
    for (let i = 6; i <= 10; i++) {
      calculator.updateFrame(i * 16.67);
    }
    
    expect(calculator.isStable()).toBe(true);
  });
});
