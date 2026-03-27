import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AspectRatioCalculator, type CalculationResult } from '../../lib/util/AspectRatioCalculator';

// Mock the aspect ratio store
vi.mock('../../lib/stores/aspectRatioStore', () => ({
  getAspectRatio: (mode: string) => {
    const ratios: Record<string, number | null> = {
      '16:9': 16 / 9,
      '4:3': 4 / 3,
      '1:1': 1,
      'fill': null,
      'auto': null,
    };
    return ratios[mode] ?? null;
  },
}));

// Mock the resolution store
vi.mock('../../lib/stores/resolutionStore', () => ({
  parseDimension: (value: string, referenceSize: number) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed.endsWith('%')) {
      const pct = parseFloat(trimmed);
      if (isNaN(pct) || pct <= 0) {
        return undefined;
      }
      return Math.round(referenceSize * pct / 100);
    }
    const num = parseFloat(trimmed.replace(/px$/i, ''));
    if (isNaN(num) || num <= 0) {
      return undefined;
    }
    return Math.round(num);
  },
}));

function createMockContainer(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  // Mock clientWidth/clientHeight
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  // Mock getComputedStyle
  const origGetComputedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    if (element === el) {
      return {
        paddingLeft: '0',
        paddingRight: '0',
      } as CSSStyleDeclaration;
    }
    return origGetComputedStyle(element);
  });
  return el;
}

describe('AspectRatioCalculator', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true });
    Object.defineProperty(window.screen, 'width', { value: 1920, writable: true, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 1080, writable: true, configurable: true });
  });

  describe('standard aspect ratios', () => {
    it('should calculate 16:9 dimensions fitting in container', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('16:9', 1, 1);

      // 800 / 600 = 1.33, 16/9 = 1.78 — container is taller, so width-limited
      expect(result.visualWidth).toBe(800);
      expect(result.visualHeight).toBe(800 / (16 / 9));
    });

    it('should calculate 4:3 dimensions', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('4:3', 1, 1);

      expect(result.visualWidth).toBe(800);
      expect(result.visualHeight).toBe(600);
    });

    it('should calculate 1:1 square dimensions', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('1:1', 1, 1);

      // Square: limited by height
      expect(result.visualWidth).toBe(600);
      expect(result.visualHeight).toBe(600);
    });

    it('should calculate fill to match container exactly', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('fill', 1, 1);

      expect(result.visualWidth).toBe(800);
      expect(result.visualHeight).toBe(600);
    });
  });

  describe('resolution scale', () => {
    it('should scale render dimensions by resolution scale', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const result1x = calc.calculate('fill', 1, 1);
      const result2x = calc.calculate('fill', 2, 1);
      const resultHalf = calc.calculate('fill', 0.5, 1);

      expect(result2x.renderWidth).toBe(result1x.renderWidth * 2);
      expect(result2x.renderHeight).toBe(result1x.renderHeight * 2);
      expect(resultHalf.renderWidth).toBe(Math.floor(result1x.renderWidth * 0.5));
      expect(resultHalf.renderHeight).toBe(Math.floor(result1x.renderHeight * 0.5));
    });

    it('should not change visual dimensions with resolution scale', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const result1x = calc.calculate('fill', 1, 1);
      const result4x = calc.calculate('fill', 4, 1);

      expect(result4x.visualWidth).toBe(result1x.visualWidth);
      expect(result4x.visualHeight).toBe(result1x.visualHeight);
    });
  });

  describe('zoom', () => {
    it('should scale visual dimensions by zoom level', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const result = calc.calculate('fill', 1, 2.0);

      expect(result.visualWidth).toBe(800 * 2.0);
      expect(result.visualHeight).toBe(600 * 2.0);
    });

    it('should not increase render resolution above 1x zoom', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const result1x = calc.calculate('fill', 1, 1);
      const result2x = calc.calculate('fill', 1, 2.0);

      // Render dims should be the same at zoom > 1
      expect(result2x.renderWidth).toBe(result1x.renderWidth);
      expect(result2x.renderHeight).toBe(result1x.renderHeight);
    });

    it('should decrease render resolution below 1x zoom', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const result1x = calc.calculate('fill', 1, 1);
      const resultHalfZoom = calc.calculate('fill', 1, 0.5);

      expect(resultHalfZoom.renderWidth).toBeLessThan(result1x.renderWidth);
      expect(resultHalfZoom.renderHeight).toBeLessThan(result1x.renderHeight);
    });
  });

  describe('custom resolution with px values', () => {
    it('should use exact pixel dimensions for render size', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('fill', 1, 1, '1920', '1080');

      expect(result.renderWidth).toBe(1920);
      expect(result.renderHeight).toBe(1080);
    });

    it('should accept px suffix', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('fill', 1, 1, '512px', '256px');

      expect(result.renderWidth).toBe(512);
      expect(result.renderHeight).toBe(256);
    });

    it('should fit custom aspect ratio into container for visual size', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('fill', 1, 1, '1920', '1080');

      // Custom aspect is 16:9 = 1.78, container is 800x600 = 1.33
      // Width-limited: visual should be 800 wide
      const customAspect = 1920 / 1080;
      expect(result.visualWidth).toBe(800);
      expect(result.visualHeight).toBeCloseTo(800 / customAspect, 5);
    });

    it('should apply zoom to visual dimensions with custom resolution', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const result1x = calc.calculate('fill', 1, 1, '512', '512');
      const result2x = calc.calculate('fill', 1, 2, '512', '512');

      expect(result2x.visualWidth).toBe(result1x.visualWidth * 2);
      expect(result2x.visualHeight).toBe(result1x.visualHeight * 2);
    });

    it('should not change render dims with zoom when custom resolution', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const result1x = calc.calculate('fill', 1, 1, '512', '512');
      const result3x = calc.calculate('fill', 1, 3, '512', '512');

      expect(result3x.renderWidth).toBe(result1x.renderWidth);
      expect(result3x.renderHeight).toBe(result1x.renderHeight);
    });

    it('should ignore resolution scale when custom resolution is set', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const result = calc.calculate('fill', 4, 1, '256', '256');

      expect(result.renderWidth).toBe(256);
      expect(result.renderHeight).toBe(256);
    });
  });

  describe('custom resolution with percentage values', () => {
    it('should resolve percentage of native container size', () => {
      container = createMockContainer(800, 600);
      Object.defineProperty(window, 'devicePixelRatio', { value: 2, writable: true, configurable: true });
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('fill', 1, 1, '50%', '50%');

      // Native = container * devicePixelRatio: 1600x1200
      // 50% of 1600 = 800, 50% of 1200 = 600
      expect(result.renderWidth).toBe(800);
      expect(result.renderHeight).toBe(600);
    });

    it('should resolve 100% to full native resolution', () => {
      container = createMockContainer(800, 600);
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true });
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('fill', 1, 1, '100%', '100%');

      expect(result.renderWidth).toBe(800);
      expect(result.renderHeight).toBe(600);
    });

    it('should allow percentage greater than 100', () => {
      container = createMockContainer(800, 600);
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true });
      const calc = new AspectRatioCalculator(container);
      const result = calc.calculate('fill', 1, 1, '200%', '200%');

      expect(result.renderWidth).toBe(1600);
      expect(result.renderHeight).toBe(1200);
    });
  });

  describe('custom resolution edge cases', () => {
    it('should fall back to standard calc if only width is provided', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const resultCustom = calc.calculate('fill', 1, 1, '512', undefined);
      const resultStandard = calc.calculate('fill', 1, 1);

      expect(resultCustom.renderWidth).toBe(resultStandard.renderWidth);
      expect(resultCustom.renderHeight).toBe(resultStandard.renderHeight);
    });

    it('should fall back to standard calc if only height is provided', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const resultCustom = calc.calculate('fill', 1, 1, undefined, '512');
      const resultStandard = calc.calculate('fill', 1, 1);

      expect(resultCustom.renderWidth).toBe(resultStandard.renderWidth);
    });

    it('should fall back if custom values are invalid', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const resultCustom = calc.calculate('fill', 1, 1, 'abc', 'xyz');
      const resultStandard = calc.calculate('fill', 1, 1);

      expect(resultCustom.renderWidth).toBe(resultStandard.renderWidth);
    });

    it('should fall back if custom values are zero', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const resultCustom = calc.calculate('fill', 1, 1, '0', '0');
      const resultStandard = calc.calculate('fill', 1, 1);

      expect(resultCustom.renderWidth).toBe(resultStandard.renderWidth);
    });

    it('should fall back if custom values are negative', () => {
      container = createMockContainer(800, 600);
      const calc = new AspectRatioCalculator(container);

      const resultCustom = calc.calculate('fill', 1, 1, '-100', '-100');
      const resultStandard = calc.calculate('fill', 1, 1);

      expect(resultCustom.renderWidth).toBe(resultStandard.renderWidth);
    });
  });
});
