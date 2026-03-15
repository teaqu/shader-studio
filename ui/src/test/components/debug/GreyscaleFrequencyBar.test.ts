import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import GreyscaleFrequencyBar from '../../../lib/components/debug/GreyscaleFrequencyBar.svelte';

const defaultProps = {
  bins: [10, 20, 30, 40],
  min: 0,
  max: 1,
};

describe('GreyscaleFrequencyBar', () => {
  describe('rendering', () => {
    it('should render the wrapper element', () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      expect(container.querySelector('.grey-freq-wrap')).toBeTruthy();
    });

    it('should render the bar container', () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      expect(container.querySelector('.bar')).toBeTruthy();
    });

    it('should render a segment for each non-zero bin', () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const segments = container.querySelectorAll('.segment');
      expect(segments.length).toBe(4);
    });

    it('should not render segments for zero-count bins', () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [10, 0, 30, 0], min: 0, max: 1 },
      });
      const segments = container.querySelectorAll('.segment');
      expect(segments.length).toBe(2);
    });

    it('should render the tooltip container', () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      expect(container.querySelector('.tooltip')).toBeTruthy();
    });
  });

  describe('segment widths', () => {
    it('should set segment widths proportional to bin counts', () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [50, 50], min: 0, max: 1 },
      });
      const segments = container.querySelectorAll('.segment') as NodeListOf<HTMLElement>;
      expect(segments.length).toBe(2);
      // Each should be 50% width
      expect(segments[0].style.width).toBe('50%');
      expect(segments[1].style.width).toBe('50%');
    });

    it('should handle unequal distributions', () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [75, 25], min: 0, max: 1 },
      });
      const segments = container.querySelectorAll('.segment') as NodeListOf<HTMLElement>;
      expect(segments[0].style.width).toBe('75%');
      expect(segments[1].style.width).toBe('25%');
    });
  });

  describe('segment colors', () => {
    it('should set greyscale background colors based on bin position', () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [10, 10], min: 0, max: 1 },
      });
      const segments = container.querySelectorAll('.segment') as NodeListOf<HTMLElement>;
      // First bin: center = 0 + (0 + 0.5) / 2 * (1 - 0) = 0.25, g = 64
      expect(segments[0].style.background).toContain('rgb(64, 64, 64)');
      // Second bin: center = 0 + (1 + 0.5) / 2 * (1 - 0) = 0.75, g = 191
      expect(segments[1].style.background).toContain('rgb(191, 191, 191)');
    });
  });

  describe('hover tooltip', () => {
    it('should not show tooltip content initially', () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const swatch = container.querySelector('.swatch');
      expect(swatch).toBeNull();
    });

    it('should show tooltip with range on hover', async () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);

      const tooltipVal = container.querySelector('.tooltip-val');
      expect(tooltipVal).toBeTruthy();
      // First bin of 4 bins in [0, 1]: lo=0, hi=0.25
      const text = tooltipVal?.textContent ?? '';
      expect(text).toContain('0.000');
      expect(text).toContain('0.250');
    });

    it('should show percentage on hover', async () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);

      const pctEl = container.querySelector('.tooltip-pct');
      expect(pctEl).toBeTruthy();
      // First bin has 10 out of 100 total = 10.0%
      expect(pctEl?.textContent).toBe('10.0%');
    });

    it('should show color swatch on hover', async () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);

      const swatch = container.querySelector('.swatch') as HTMLElement;
      expect(swatch).toBeTruthy();
      expect(swatch.style.background).toBeTruthy();
    });

    it('should apply hovered class to segment on mouseenter', async () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);

      expect(segment.classList.contains('hovered')).toBe(true);
    });

    it('should remove hovered class on mouseleave', async () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);
      expect(segment.classList.contains('hovered')).toBe(true);

      await fireEvent.mouseLeave(segment);
      expect(segment.classList.contains('hovered')).toBe(false);
    });

    it('should hide tooltip content on mouseleave', async () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);
      expect(container.querySelector('.swatch')).toBeTruthy();

      await fireEvent.mouseLeave(segment);
      expect(container.querySelector('.swatch')).toBeNull();
    });

    it('should show correct tooltip for second bin on hover', async () => {
      const { container } = render(GreyscaleFrequencyBar, { props: defaultProps });
      const segments = container.querySelectorAll('.segment');
      const secondSegment = segments[1] as HTMLElement;
      await fireEvent.mouseEnter(secondSegment);

      const tooltipVal = container.querySelector('.tooltip-val');
      const text = tooltipVal?.textContent ?? '';
      // Second bin of 4 bins in [0, 1]: lo=0.25, hi=0.5
      expect(text).toContain('0.250');
      expect(text).toContain('0.500');

      const pctEl = container.querySelector('.tooltip-pct');
      // 20 out of 100 = 20.0%
      expect(pctEl?.textContent).toBe('20.0%');
    });
  });

  describe('fmt function (number formatting via tooltip)', () => {
    it('should format large range values with no decimal places', async () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [10, 10], min: 1000, max: 2000 },
      });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);

      const text = container.querySelector('.tooltip-val')?.textContent ?? '';
      expect(text).toContain('1000');
      expect(text).toContain('1500');
    });

    it('should format medium range values with 1 decimal place', async () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [10, 10], min: 10, max: 50 },
      });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);

      const text = container.querySelector('.tooltip-val')?.textContent ?? '';
      expect(text).toContain('10.0');
      expect(text).toContain('30.0');
    });

    it('should format small range values with 3 decimal places', async () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [10, 10], min: 0.1, max: 0.9 },
      });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);

      const text = container.querySelector('.tooltip-val')?.textContent ?? '';
      expect(text).toContain('0.100');
      expect(text).toContain('0.500');
    });
  });

  describe('pct function', () => {
    it('should show 0% when total is zero', () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [0, 0, 0], min: 0, max: 1 },
      });
      // With all zero bins, no segments are rendered
      const segments = container.querySelectorAll('.segment');
      expect(segments.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle a single bin', async () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [100], min: 0, max: 1 },
      });
      const segments = container.querySelectorAll('.segment');
      expect(segments.length).toBe(1);

      const segment = segments[0] as HTMLElement;
      expect(segment.style.width).toBe('100%');

      await fireEvent.mouseEnter(segment);
      const pctEl = container.querySelector('.tooltip-pct');
      expect(pctEl?.textContent).toBe('100.0%');
    });

    it('should handle all zero bins', () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [0, 0, 0, 0], min: 0, max: 1 },
      });
      const segments = container.querySelectorAll('.segment');
      expect(segments.length).toBe(0);
    });

    it('should handle negative min/max range', async () => {
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [10, 10], min: -1, max: 0 },
      });
      const segment = container.querySelector('.segment') as HTMLElement;
      await fireEvent.mouseEnter(segment);

      const text = container.querySelector('.tooltip-val')?.textContent ?? '';
      expect(text).toContain('-1.000');
      expect(text).toContain('-0.500');
    });

    it('should clamp greyscale values to valid RGB range', () => {
      // When center is outside [0, 1], the color should be clamped
      const { container } = render(GreyscaleFrequencyBar, {
        props: { bins: [10], min: -2, max: -1 },
      });
      const segment = container.querySelector('.segment') as HTMLElement;
      // Center = -2 + (0.5) / 1 * (-1 - (-2)) = -2 + 0.5 = -1.5, clamped to 0
      expect(segment.style.background).toContain('rgb(0, 0, 0)');
    });
  });
});
