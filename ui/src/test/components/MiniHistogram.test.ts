import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import MiniHistogram from '../../lib/components/debug/MiniHistogram.svelte';

describe('MiniHistogram', () => {
  it('renders correct number of bars (= bins.length)', () => {
    const { container } = render(MiniHistogram, {
      props: { bins: [3, 5, 4, 2, 6, 8, 1], min: 0, max: 1 },
    });
    const bars = container.querySelectorAll('rect.bar');
    expect(bars).toHaveLength(7);
  });

  it('tallest bar corresponds to the maximum bin count', () => {
    const { container } = render(MiniHistogram, {
      props: { bins: [1, 10, 2], min: 0, max: 1 },
    });
    const bars = Array.from(container.querySelectorAll('rect.bar'));
    // The middle bar has max count (10), so it should have the tallest height
    const heights = bars.map(b => parseFloat(b.getAttribute('height') ?? '0'));
    const maxHeight = Math.max(...heights);
    expect(heights[1]).toBe(maxHeight);
  });

  it('shows zero-crossing line when min < 0 < max', () => {
    const { container } = render(MiniHistogram, {
      props: { bins: [2, 3, 2], min: -1, max: 1 },
    });
    const zeroLine = container.querySelector('line.zero-line');
    expect(zeroLine).toBeInTheDocument();
  });

  it('does not show zero-crossing line when range is all positive', () => {
    const { container } = render(MiniHistogram, {
      props: { bins: [2, 3, 2], min: 0.1, max: 1 },
    });
    const zeroLine = container.querySelector('line.zero-line');
    expect(zeroLine).not.toBeInTheDocument();
  });

  it('does not show zero-crossing line when range is all negative', () => {
    const { container } = render(MiniHistogram, {
      props: { bins: [2, 3, 2], min: -2, max: -0.1 },
    });
    const zeroLine = container.querySelector('line.zero-line');
    expect(zeroLine).not.toBeInTheDocument();
  });

  it('shows min/max labels', () => {
    const { container } = render(MiniHistogram, {
      props: { bins: [1, 2, 3], min: -0.5, max: 1.5 },
    });
    const content = container.textContent ?? '';
    expect(content).toContain('-0.500');
    expect(content).toContain('1.500');
  });
});
