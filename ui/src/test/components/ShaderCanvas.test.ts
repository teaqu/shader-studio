import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import ShaderCanvas from '../../lib/components/ShaderCanvas.svelte';
import { resolutionStore } from '../../lib/stores/resolutionStore';

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe('ShaderCanvas Component', () => {
  const defaultProps = {
    zoomLevel: 1.0,
    onCanvasReady: vi.fn(),
    onCanvasResize: vi.fn(),
    onCanvasClick: vi.fn(),
    isInspectorActive: false,
  };

  describe('Focus behavior', () => {
    it('should not programmatically call focus() on the canvas', () => {
      const { container } = render(ShaderCanvas, {
        props: defaultProps,
      });

      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      const focusSpy = vi.spyOn(canvas, 'focus');

      // The canvas should be focusable but not auto-focused
      expect(canvas.tabIndex).toBe(0);
      expect(focusSpy).not.toHaveBeenCalled();

      focusSpy.mockRestore();
    });

    it('should focus the canvas on pixel inspector click', async () => {
      const { container } = render(ShaderCanvas, {
        props: {
          ...defaultProps,
          isInspectorActive: true,
        },
      });

      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      const canvasContainer = container.querySelector('.canvas-container') as HTMLElement;
      const focusSpy = vi.spyOn(canvas, 'focus');

      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.click(canvasContainer, { clientX: 100, clientY: 100 });

      expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('should focus the canvas on pixel inspector drag start', async () => {
      const { container } = render(ShaderCanvas, {
        props: {
          ...defaultProps,
          isInspectorActive: true,
        },
      });

      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      const canvasContainer = container.querySelector('.canvas-container') as HTMLElement;
      const focusSpy = vi.spyOn(canvas, 'focus');

      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.click(canvasContainer, { clientX: 150, clientY: 150 });

      expect(focusSpy).toHaveBeenCalledOnce();
    });
  });

  describe('image-rendering', () => {
    it('should set image-rendering: pixelated on the canvas element', () => {
      const { container } = render(ShaderCanvas, { props: defaultProps });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      expect(canvas.style.imageRendering).toBe('pixelated');
    });
  });

  describe('background override', () => {
    it('should apply a black canvas background when forced in the resolution store', async () => {
      resolutionStore.setForceBlackBackground(true);

      const { container } = render(ShaderCanvas, {
        props: defaultProps,
      });

      const canvasContainer = container.querySelector('.canvas-container') as HTMLElement;
      expect(canvasContainer.classList.contains('force-black-background')).toBe(true);

      resolutionStore.setForceBlackBackground(false);
    });
  });

  describe('Click vs Drag Detection', () => {
    it('should trigger onCanvasClick when clicking without dragging', async () => {
      const onCanvasClick = vi.fn();
      const { container } = render(ShaderCanvas, {
        props: {
          ...defaultProps,
          onCanvasClick,
          isInspectorActive: true,
        },
      });

      const canvasContainer = container.querySelector('.canvas-container') as HTMLElement;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // Simulate click (mousedown and click at same position)
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.click(canvasContainer, { clientX: 100, clientY: 100 });

      expect(onCanvasClick).toHaveBeenCalledOnce();
    });

    it('should NOT trigger onCanvasClick when dragging', async () => {
      const onCanvasClick = vi.fn();
      const { container } = render(ShaderCanvas, {
        props: {
          ...defaultProps,
          onCanvasClick,
          isInspectorActive: true,
        },
      });

      const canvasContainer = container.querySelector('.canvas-container') as HTMLElement;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // Simulate drag (mousedown at one position, click at another)
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.click(canvasContainer, { clientX: 150, clientY: 150 });

      expect(onCanvasClick).not.toHaveBeenCalled();
    });

    it('should trigger onCanvasClick when drag distance is within threshold', async () => {
      const onCanvasClick = vi.fn();
      const { container } = render(ShaderCanvas, {
        props: {
          ...defaultProps,
          onCanvasClick,
          isInspectorActive: true,
        },
      });

      const canvasContainer = container.querySelector('.canvas-container') as HTMLElement;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // Simulate small movement (within 5px threshold)
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.click(canvasContainer, { clientX: 102, clientY: 103 });

      expect(onCanvasClick).toHaveBeenCalledOnce();
    });

    it('should NOT trigger onCanvasClick when drag distance exceeds threshold', async () => {
      const onCanvasClick = vi.fn();
      const { container } = render(ShaderCanvas, {
        props: {
          ...defaultProps,
          onCanvasClick,
          isInspectorActive: true,
        },
      });

      const canvasContainer = container.querySelector('.canvas-container') as HTMLElement;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // Simulate drag beyond threshold (>5px)
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.click(canvasContainer, { clientX: 110, clientY: 110 });

      expect(onCanvasClick).not.toHaveBeenCalled();
    });

    it('should work when inspector is not active', async () => {
      const onCanvasClick = vi.fn();
      const { container } = render(ShaderCanvas, {
        props: {
          ...defaultProps,
          onCanvasClick,
          isInspectorActive: false,
        },
      });

      const canvasContainer = container.querySelector('.canvas-container') as HTMLElement;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // Click should still work
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.click(canvasContainer, { clientX: 100, clientY: 100 });

      expect(onCanvasClick).toHaveBeenCalledOnce();
    });
  });
});
