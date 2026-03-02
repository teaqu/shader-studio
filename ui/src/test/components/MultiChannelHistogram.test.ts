import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import MultiChannelHistogram from '../../lib/components/debug/MultiChannelHistogram.svelte';

const CHANNELS_3 = [
  { bins: [1, 2, 3], min: 0, max: 1, label: 'x' },
  { bins: [3, 2, 1], min: 0, max: 0.6, label: 'y' },
  { bins: [2, 3, 2], min: 0.5, max: 1, label: 'z' },
];

const CHANNELS_4 = [
  ...CHANNELS_3,
  { bins: [1, 1, 1], min: 0, max: 1, label: 'w' },
];

describe('MultiChannelHistogram', () => {
  it('renders one label per channel', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const labels = container.querySelectorAll('.ch-label');
    expect(labels).toHaveLength(3);
  });

  it('renders correct label text for each channel', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const labels = Array.from(container.querySelectorAll('.ch-label'));
    expect(labels[0].textContent).toBe('x');
    expect(labels[1].textContent).toBe('y');
    expect(labels[2].textContent).toBe('z');
  });

  it('renders one histogram (svg) per channel', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(3);
  });

  // ----------------------------------------------------------------
  // Label colours — each channel gets its own distinguishing colour
  // ----------------------------------------------------------------

  it('x label uses red channel colour', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const label = container.querySelectorAll('.ch-label')[0] as HTMLElement;
    expect(label.style.color).toContain('charts-red');
  });

  it('y label uses green channel colour', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const label = container.querySelectorAll('.ch-label')[1] as HTMLElement;
    expect(label.style.color).toContain('charts-green');
  });

  it('z label uses blue channel colour', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const label = container.querySelectorAll('.ch-label')[2] as HTMLElement;
    expect(label.style.color).toContain('charts-blue');
  });

  it('w label uses purple channel colour', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_4 } });
    const label = container.querySelectorAll('.ch-label')[3] as HTMLElement;
    expect(label.style.color).toContain('charts-purple');
  });

  // ----------------------------------------------------------------
  // Bar colours — all bars use the same blue colour regardless of channel
  // ----------------------------------------------------------------

  it('all bars across all channels use the same fill colour', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const bars = Array.from(container.querySelectorAll('rect.bar'));
    expect(bars.length).toBeGreaterThan(0);

    const fills = bars.map(b => b.getAttribute('fill'));
    const uniqueFills = new Set(fills);
    expect(uniqueFills.size).toBe(1); // all bars same colour
  });

  it('bar colour is blue, not the per-channel label colour', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const bars = Array.from(container.querySelectorAll('rect.bar'));
    const barFill = bars[0]?.getAttribute('fill') ?? '';

    // Bars must be blue
    expect(barFill).toContain('charts-blue');

    // Bars must NOT be the x-channel red or y-channel green
    expect(barFill).not.toContain('charts-red');
    expect(barFill).not.toContain('charts-green');
  });

  it('x-channel bars are blue, not red (label colour ≠ bar colour)', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    // First SVG belongs to x channel
    const firstSvg = container.querySelector('svg');
    const bars = Array.from(firstSvg!.querySelectorAll('rect.bar'));

    bars.forEach(bar => {
      expect(bar.getAttribute('fill')).not.toContain('charts-red');
      expect(bar.getAttribute('fill')).toContain('charts-blue');
    });
  });

  it('y-channel bars are blue, not green (label colour ≠ bar colour)', () => {
    const { container } = render(MultiChannelHistogram, { props: { channels: CHANNELS_3 } });
    const svgs = container.querySelectorAll('svg');
    const bars = Array.from(svgs[1]!.querySelectorAll('rect.bar'));

    bars.forEach(bar => {
      expect(bar.getAttribute('fill')).not.toContain('charts-green');
      expect(bar.getAttribute('fill')).toContain('charts-blue');
    });
  });
});
