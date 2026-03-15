import { describe, it, expect } from 'vitest';
import { formatTime } from '../../lib/util/formatTime';

describe('formatTime', () => {
  describe('basic formatting', () => {
    it('should format 0 seconds as 0:00', () => {
      expect(formatTime(0)).toBe('0:00');
    });

    it('should format seconds under a minute', () => {
      expect(formatTime(5)).toBe('0:05');
      expect(formatTime(9)).toBe('0:09');
      expect(formatTime(10)).toBe('0:10');
      expect(formatTime(59)).toBe('0:59');
    });

    it('should format exact minutes', () => {
      expect(formatTime(60)).toBe('1:00');
      expect(formatTime(120)).toBe('2:00');
      expect(formatTime(600)).toBe('10:00');
    });

    it('should format minutes and seconds', () => {
      expect(formatTime(61)).toBe('1:01');
      expect(formatTime(90)).toBe('1:30');
      expect(formatTime(125)).toBe('2:05');
      expect(formatTime(3661)).toBe('61:01');
    });

    it('should pad seconds with leading zero', () => {
      expect(formatTime(1)).toBe('0:01');
      expect(formatTime(62)).toBe('1:02');
    });

    it('should not pad minutes with leading zero', () => {
      expect(formatTime(5)).toBe('0:05');
      expect(formatTime(65)).toBe('1:05');
    });
  });

  describe('fractional seconds', () => {
    it('should floor fractional seconds', () => {
      expect(formatTime(1.9)).toBe('0:01');
      expect(formatTime(59.99)).toBe('0:59');
      expect(formatTime(60.5)).toBe('1:00');
      expect(formatTime(90.7)).toBe('1:30');
    });
  });

  describe('edge cases', () => {
    it('should return 0:00 for negative values', () => {
      expect(formatTime(-1)).toBe('0:00');
      expect(formatTime(-100)).toBe('0:00');
    });

    it('should return 0:00 for NaN', () => {
      expect(formatTime(NaN)).toBe('0:00');
    });

    it('should return 0:00 for Infinity', () => {
      expect(formatTime(Infinity)).toBe('0:00');
      expect(formatTime(-Infinity)).toBe('0:00');
    });

    it('should handle large values', () => {
      expect(formatTime(3600)).toBe('60:00');
      expect(formatTime(7200)).toBe('120:00');
    });
  });
});
