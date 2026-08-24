import { beforeEach, describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import CaptureThumbnail from '../../lib/components/debug/CaptureThumbnail.svelte';
import { resetVariablePreview } from '../../lib/state/variablePreviewState.svelte';

function makePixels(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(128);
}

const PREVIEW_PROPS = {
  varName: 'previewVar',
  varType: 'vec3',
  debugLine: 7,
  activeBufferName: 'Image',
  filePath: '/shaders/image.glsl',
};

describe('CaptureThumbnail', () => {
  beforeEach(() => {
    resetVariablePreview();
  });

  it('scales a 16×16 canvas up to the compact display size', () => {
    render(CaptureThumbnail, { props: { ...PREVIEW_PROPS, pixels: makePixels(16, 16), gridWidth: 16, gridHeight: 16 } });
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.style.width).toBe('32px');
    expect(canvas.style.height).toBe('32px');
  });

  it('renders a wide canvas at the compact display size', () => {
    // 16:9 aspect ratio: 43x24
    render(CaptureThumbnail, { props: { ...PREVIEW_PROPS, pixels: makePixels(43, 24), gridWidth: 43, gridHeight: 24 } });
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.style.width).toBe('32px');
    expect(canvas.style.height).toBe('18px');
  });

  it('renders a tall canvas at the compact display size', () => {
    // Portrait: 24x43
    render(CaptureThumbnail, { props: { ...PREVIEW_PROPS, pixels: makePixels(24, 43), gridWidth: 24, gridHeight: 43 } });
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.style.height).toBe('32px');
    expect(canvas.style.width).toBe('18px');
  });

  it('renders a 64×64 canvas at its captured dimensions', () => {
    render(CaptureThumbnail, { props: { ...PREVIEW_PROPS, pixels: makePixels(64, 64), gridWidth: 64, gridHeight: 64 } });
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;

    expect(canvas.style.width).toBe('64px');
    expect(canvas.style.height).toBe('64px');
  });

  it('does not resize a native-size canvas on hover', async () => {
    render(CaptureThumbnail, { props: { ...PREVIEW_PROPS, pixels: makePixels(128, 72), gridWidth: 128, gridHeight: 72 } });
    const wrap = document.querySelector('.thumb-wrap') as HTMLElement;
    await fireEvent.mouseEnter(wrap);
    const canvas = document.querySelector('.thumb') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('128px');
    expect(canvas.style.height).toBe('72px');
    expect(document.querySelector('.thumb-expanded')).not.toBeInTheDocument();
  });

});
