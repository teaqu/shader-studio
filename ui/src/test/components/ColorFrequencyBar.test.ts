import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import ColorFrequencyBar from '../../lib/components/debug/ColorFrequencyBar.svelte';

const colors = [
  { r: 1.0, g: 0.5, b: 0.25, freq: 0.6 },
  { r: 0.0, g: 0.0, b: 0.0, freq: 0.4 },
];

describe('ColorFrequencyBar', () => {
  it('renders segments for each color', () => {
    render(ColorFrequencyBar, { props: { colors } });
    const segments = document.querySelectorAll('.segment');
    expect(segments.length).toBe(2);
  });

  it('shows hex color code on hover', async () => {
    render(ColorFrequencyBar, { props: { colors } });
    const segment = document.querySelector('.segment') as HTMLElement;
    await fireEvent.mouseEnter(segment);
    const content = document.body.textContent ?? '';
    expect(content).toContain('#ff8040');
  });

  it('shows RGB float values on hover', async () => {
    render(ColorFrequencyBar, { props: { colors } });
    const segment = document.querySelector('.segment') as HTMLElement;
    await fireEvent.mouseEnter(segment);
    const content = document.body.textContent ?? '';
    expect(content).toContain('1.000');
    expect(content).toContain('0.500');
    expect(content).toContain('0.250');
  });

  it('shows frequency percentage on hover', async () => {
    render(ColorFrequencyBar, { props: { colors } });
    const segment = document.querySelector('.segment') as HTMLElement;
    await fireEvent.mouseEnter(segment);
    const content = document.body.textContent ?? '';
    expect(content).toContain('60.0%');
  });

  it('shows color swatch on hover', async () => {
    render(ColorFrequencyBar, { props: { colors } });
    const segment = document.querySelector('.segment') as HTMLElement;
    await fireEvent.mouseEnter(segment);
    const swatch = document.querySelector('.swatch') as HTMLElement;
    expect(swatch).toBeInTheDocument();
    expect(swatch.style.background).toBeTruthy();
  });

  it('hides tooltip on mouse leave', async () => {
    render(ColorFrequencyBar, { props: { colors } });
    const segment = document.querySelector('.segment') as HTMLElement;
    await fireEvent.mouseEnter(segment);
    expect(document.body.textContent).toContain('#ff8040');
    await fireEvent.mouseLeave(segment);
    expect(document.body.textContent).not.toContain('#ff8040');
  });
});
