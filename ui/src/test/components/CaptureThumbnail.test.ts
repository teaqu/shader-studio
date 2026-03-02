import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import CaptureThumbnail from '../../lib/components/debug/CaptureThumbnail.svelte';

function makePixels(gridSize: number): Uint8ClampedArray {
  return new Uint8ClampedArray(gridSize * gridSize * 4).fill(128);
}

describe('CaptureThumbnail', () => {
  it('renders a canvas at the specified display size', () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(32), size: 32 } });
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.style.width).toBe('32px');
    expect(canvas.style.height).toBe('32px');
  });

  it('does not show expanded preview when grid size equals display size', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(32), size: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    const expanded = document.querySelector('.thumb-expanded');
    expect(expanded).not.toBeInTheDocument();
  });

  it('shows expanded preview on hover when grid size exceeds display size', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(64), size: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    const expanded = document.querySelector('.thumb-expanded') as HTMLCanvasElement;
    expect(expanded).toBeInTheDocument();
    expect(expanded.style.width).toBe('64px');
    expect(expanded.style.height).toBe('64px');
  });

  it('hides expanded preview on mouse leave', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(64), size: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    expect(document.querySelector('.thumb-expanded')).toBeInTheDocument();
    await fireEvent.mouseLeave(wrap);
    expect(document.querySelector('.thumb-expanded')).not.toBeInTheDocument();
  });

  it('does not show expanded preview for 16x16 grid at default size', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(16), size: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    expect(document.querySelector('.thumb-expanded')).not.toBeInTheDocument();
  });

  it('shows expanded preview for 128x128 grid', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(128), size: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    const expanded = document.querySelector('.thumb-expanded') as HTMLCanvasElement;
    expect(expanded).toBeInTheDocument();
    expect(expanded.style.width).toBe('128px');
    expect(expanded.style.height).toBe('128px');
  });
});
