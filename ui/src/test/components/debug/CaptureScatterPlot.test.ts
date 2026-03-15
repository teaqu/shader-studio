import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import CaptureScatterPlot from '../../../lib/components/debug/CaptureScatterPlot.svelte';

// Mock canvas context
function createMockContext() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };
}

let mockCtx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  mockCtx = createMockContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
});

const defaultProps = {
  xData: new Float32Array([0.1, 0.5, 0.9]),
  yData: new Float32Array([0.2, 0.6, 0.8]),
  xMin: 0,
  xMax: 1,
  yMin: 0,
  yMax: 1,
};

describe('CaptureScatterPlot', () => {
  describe('rendering', () => {
    it('should render a canvas element', () => {
      const { container } = render(CaptureScatterPlot, { props: defaultProps });
      const canvas = container.querySelector('canvas');
      expect(canvas).toBeTruthy();
    });

    it('should render the scatter-wrap container', () => {
      const { container } = render(CaptureScatterPlot, { props: defaultProps });
      expect(container.querySelector('.scatter-wrap')).toBeTruthy();
    });

    it('should set canvas dimensions to 160x120', () => {
      const { container } = render(CaptureScatterPlot, { props: defaultProps });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      expect(canvas.width).toBe(160);
      expect(canvas.height).toBe(120);
    });
  });

  describe('canvas drawing', () => {
    it('should get 2d context and draw on mount', () => {
      render(CaptureScatterPlot, { props: defaultProps });
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d');
    });

    it('should clear the canvas before drawing', () => {
      render(CaptureScatterPlot, { props: defaultProps });
      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 160, 120);
    });

    it('should draw background rectangle', () => {
      render(CaptureScatterPlot, { props: defaultProps });
      // Background fill
      expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('should draw a dot for each data point', () => {
      render(CaptureScatterPlot, { props: defaultProps });
      // 1 background fillRect + 3 dot fillRects + 1 border strokeRect
      // Each dot calls fillRect once
      const fillRectCalls = mockCtx.fillRect.mock.calls;
      // First call is background, then 3 dots
      expect(fillRectCalls.length).toBeGreaterThanOrEqual(4); // bg + 3 dots
    });

    it('should draw border rectangle', () => {
      render(CaptureScatterPlot, { props: defaultProps });
      expect(mockCtx.strokeRect).toHaveBeenCalled();
    });
  });

  describe('zero-crossing guide lines', () => {
    it('should draw vertical zero line when range spans zero on x-axis', () => {
      render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: -1, xMax: 1 },
      });
      expect(mockCtx.setLineDash).toHaveBeenCalledWith([2, 2]);
      // Should draw guide line (beginPath + moveTo + lineTo + stroke)
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalled();
      expect(mockCtx.lineTo).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });

    it('should draw horizontal zero line when range spans zero on y-axis', () => {
      render(CaptureScatterPlot, {
        props: { ...defaultProps, yMin: -1, yMax: 1 },
      });
      expect(mockCtx.beginPath).toHaveBeenCalled();
    });

    it('should not draw vertical zero line when range does not span zero', () => {
      mockCtx.beginPath.mockClear();
      mockCtx.moveTo.mockClear();
      render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: 0.5, xMax: 1, yMin: 0.5, yMax: 1 },
      });
      // beginPath is not called for guide lines (only border doesn't use beginPath)
      // No zero-crossing lines should be drawn
      expect(mockCtx.beginPath).not.toHaveBeenCalled();
    });

    it('should reset line dash after drawing guide lines', () => {
      render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: -1, xMax: 1 },
      });
      // Last setLineDash call should reset to empty
      const calls = mockCtx.setLineDash.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toEqual([]);
    });
  });

  describe('axis labels', () => {
    it('should render axis labels container', () => {
      const { container } = render(CaptureScatterPlot, { props: defaultProps });
      expect(container.querySelector('.axis-labels')).toBeTruthy();
    });

    it('should display x-axis label with formatted min and max', () => {
      const { container } = render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: 0, xMax: 1 },
      });
      const labels = container.querySelector('.axis-labels');
      const text = labels?.textContent ?? '';
      expect(text).toContain('x');
      expect(text).toContain('0.000');
      expect(text).toContain('1.000');
    });

    it('should display y-axis label with formatted min and max', () => {
      const { container } = render(CaptureScatterPlot, {
        props: { ...defaultProps, yMin: 0, yMax: 1 },
      });
      const labels = container.querySelector('.axis-labels');
      const text = labels?.textContent ?? '';
      expect(text).toContain('y');
      expect(text).toContain('0.000');
      expect(text).toContain('1.000');
    });
  });

  describe('fmt function (number formatting via labels)', () => {
    it('should format large numbers with no decimal places', () => {
      const { container } = render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: 1000, xMax: 2000 },
      });
      const text = container.querySelector('.axis-labels')?.textContent ?? '';
      expect(text).toContain('1000');
      expect(text).toContain('2000');
    });

    it('should format medium numbers with 1 decimal place', () => {
      const { container } = render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: 10, xMax: 50 },
      });
      const text = container.querySelector('.axis-labels')?.textContent ?? '';
      expect(text).toContain('10.0');
      expect(text).toContain('50.0');
    });

    it('should format small numbers with 3 decimal places', () => {
      const { container } = render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: 0.1, xMax: 0.9 },
      });
      const text = container.querySelector('.axis-labels')?.textContent ?? '';
      expect(text).toContain('0.100');
      expect(text).toContain('0.900');
    });
  });

  describe('edge cases', () => {
    it('should handle empty data arrays', () => {
      const { container } = render(CaptureScatterPlot, {
        props: {
          ...defaultProps,
          xData: new Float32Array([]),
          yData: new Float32Array([]),
        },
      });
      expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should handle equal min and max values (zero range)', () => {
      const { container } = render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: 5, xMax: 5, yMin: 3, yMax: 3 },
      });
      expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should handle negative ranges', () => {
      const { container } = render(CaptureScatterPlot, {
        props: { ...defaultProps, xMin: -10, xMax: -5, yMin: -8, yMax: -2 },
      });
      const text = container.querySelector('.axis-labels')?.textContent ?? '';
      expect(text).toContain('-10.0');
      expect(text).toContain('-5.0');
    });
  });
});
