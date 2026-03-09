import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import CaptureThumbnail from '../../lib/components/debug/CaptureThumbnail.svelte';

function makePixels(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(128);
}

describe('CaptureThumbnail', () => {
  it('renders a square canvas at the specified display size', () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(32, 32), gridWidth: 32, gridHeight: 32, maxSize: 32 } });
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.style.width).toBe('32px');
    expect(canvas.style.height).toBe('32px');
  });

  it('renders a wide canvas with correct aspect ratio', () => {
    // 16:9 aspect ratio: 43x24
    render(CaptureThumbnail, { props: { pixels: makePixels(43, 24), gridWidth: 43, gridHeight: 24, maxSize: 32 } });
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    // Width is the larger dimension, so it gets maxSize
    expect(canvas.style.width).toBe('32px');
    // Height scales proportionally: 32 * (24/43) ≈ 18
    const expectedHeight = Math.round(32 * (24 / 43));
    expect(canvas.style.height).toBe(`${expectedHeight}px`);
  });

  it('renders a tall canvas with correct aspect ratio', () => {
    // Portrait: 24x43
    render(CaptureThumbnail, { props: { pixels: makePixels(24, 43), gridWidth: 24, gridHeight: 43, maxSize: 32 } });
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    // Height is the larger dimension, so it gets maxSize
    expect(canvas.style.height).toBe('32px');
    // Width scales proportionally: 32 * (24/43) ≈ 18
    const expectedWidth = Math.round(32 * (24 / 43));
    expect(canvas.style.width).toBe(`${expectedWidth}px`);
  });

  it('does not show expanded preview when grid fits in display size', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(32, 32), gridWidth: 32, gridHeight: 32, maxSize: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    const expanded = document.querySelector('.thumb-expanded');
    expect(expanded).not.toBeInTheDocument();
  });

  it('shows expanded preview on hover when grid size exceeds display size', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(64, 64), gridWidth: 64, gridHeight: 64, maxSize: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    const expanded = document.querySelector('.thumb-expanded') as HTMLCanvasElement;
    expect(expanded).toBeInTheDocument();
    expect(expanded.style.width).toBe('64px');
    expect(expanded.style.height).toBe('64px');
  });

  it('shows expanded preview for wide grid that exceeds display', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(128, 72), gridWidth: 128, gridHeight: 72, maxSize: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    const expanded = document.querySelector('.thumb-expanded') as HTMLCanvasElement;
    expect(expanded).toBeInTheDocument();
    expect(expanded.style.width).toBe('128px');
    expect(expanded.style.height).toBe('72px');
  });

  it('hides expanded preview on mouse leave', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(64, 64), gridWidth: 64, gridHeight: 64, maxSize: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    expect(document.querySelector('.thumb-expanded')).toBeInTheDocument();
    await fireEvent.mouseLeave(wrap);
    expect(document.querySelector('.thumb-expanded')).not.toBeInTheDocument();
  });

  it('does not show expanded preview for small grid', async () => {
    render(CaptureThumbnail, { props: { pixels: makePixels(16, 16), gridWidth: 16, gridHeight: 16, maxSize: 32 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    expect(document.querySelector('.thumb-expanded')).not.toBeInTheDocument();
  });
});
