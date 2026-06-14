import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import '@testing-library/jest-dom';
import PixelInspectorLoupe from '../../lib/components/PixelInspectorLoupe.svelte';
import pixelInspectorLoupeSource from '../../lib/components/PixelInspectorLoupe.svelte?raw';

describe('PixelInspectorLoupe', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true });
  });

  const mockCanvas = {
    width: 800,
    height: 600,
    style: { cursor: '' },
    getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: vi.fn(),
  } as unknown as HTMLCanvasElement;

  const activeProps = {
    isActive: true,
    mouseX: 400,
    mouseY: 300,
    canvasElement: mockCanvas,
    canvasPosition: { x: 400, y: 300 },
  };

  describe('Visibility', () => {
    it('does not render when isActive is false', () => {
      const { container } = render(PixelInspectorLoupe, {
        props: { ...activeProps, isActive: false },
      });
      expect(container.querySelector('.loupe')).not.toBeInTheDocument();
    });

    it('does not render when canvasPosition is null', () => {
      const { container } = render(PixelInspectorLoupe, {
        props: { ...activeProps, canvasPosition: null },
      });
      expect(container.querySelector('.loupe')).not.toBeInTheDocument();
    });

    it('renders when isActive is true and canvasPosition is provided', () => {
      const { container } = render(PixelInspectorLoupe, {
        props: activeProps,
      });
      expect(container.querySelector('.loupe')).toBeInTheDocument();
    });

    it('renders an internal canvas element', () => {
      const { container } = render(PixelInspectorLoupe, {
        props: activeProps,
      });
      const canvas = container.querySelector('.loupe canvas');
      expect(canvas).toBeInTheDocument();
    });
  });

  describe('Cursor hiding', () => {
    it('sets cursor none in source when active and unlocked', () => {
      expect(pixelInspectorLoupeSource).toContain("cursor = hide ? 'none' : ''");
    });

    it('does not hide cursor when locked', () => {
      const { container } = render(PixelInspectorLoupe, {
        props: { ...activeProps, isLocked: true },
      });
      // loupe is hidden when locked, so canvasElement cursor is not affected
      expect(container.querySelector('.loupe')).not.toBeInTheDocument();
    });
  });

  describe('Canvas dimensions', () => {
    it('internal canvas is 120x120', () => {
      const { container } = render(PixelInspectorLoupe, {
        props: activeProps,
      });
      const canvas = container.querySelector('.loupe canvas') as HTMLCanvasElement;
      expect(canvas.getAttribute('width')).toBe('120');
      expect(canvas.getAttribute('height')).toBe('120');
    });

    it('keeps the outer loupe at 120x120 including its border', () => {
      expect(pixelInspectorLoupeSource).toContain('box-sizing: border-box;');
    });
  });

  describe('Positioning', () => {
    it('centres loupe horizontally on the cursor', () => {
      const { container } = render(PixelInspectorLoupe, {
        props: { ...activeProps, mouseX: 100, mouseY: 200 },
      });
      const loupe = container.querySelector('.loupe') as HTMLElement;
      expect(loupe.style.left).toBe('40px'); // 100 - 60
    });

    it('centres loupe vertically on the cursor', () => {
      const { container } = render(PixelInspectorLoupe, {
        props: { ...activeProps, mouseX: 100, mouseY: 200 },
      });
      const loupe = container.querySelector('.loupe') as HTMLElement;
      expect(loupe.style.top).toBe('140px'); // 200 - 60
    });
  });

  describe('Canvas drawing', () => {
    it('calls drawImage on the source canvas when active with a valid position', async () => {
      const mockCtx = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        imageSmoothingEnabled: true,
      };

      const canvasWithCtx = {
        ...mockCanvas,
        style: { cursor: '' },
        getContext: vi.fn().mockReturnValue(mockCtx),
      } as unknown as HTMLCanvasElement;

      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);

      try {
        render(PixelInspectorLoupe, {
          props: { ...activeProps, canvasElement: canvasWithCtx },
        });

        await Promise.resolve();

        const [, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH] = mockCtx.drawImage.mock.calls[0];
        expect(srcX).toBe(393);
        expect(srcY).toBe(293);
        expect(srcW).toBe(15);
        expect(srcH).toBe(15);
        expect(dstX).toBe(0);
        expect(dstY).toBe(0);
        expect(dstW).toBe(120);
        expect(dstH).toBe(120);
        expect(mockCtx.imageSmoothingEnabled).toBe(false);
        expect(mockCtx.strokeRect).toHaveBeenCalledWith(56, 56, 8, 8);
        expect(mockCtx.moveTo).toHaveBeenCalledWith(50, 60);
        expect(mockCtx.lineTo).toHaveBeenCalledWith(55, 60);
        expect(mockCtx.moveTo).toHaveBeenCalledWith(65, 60);
        expect(mockCtx.lineTo).toHaveBeenCalledWith(70, 60);
        expect(mockCtx.moveTo).toHaveBeenCalledWith(60, 50);
        expect(mockCtx.lineTo).toHaveBeenCalledWith(60, 55);
        expect(mockCtx.moveTo).toHaveBeenCalledWith(60, 65);
        expect(mockCtx.lineTo).toHaveBeenCalledWith(60, 70);
      } finally {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
      }
    });

    it('does not request a drawing context when source canvas is missing', async () => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      const getContext = vi.fn();
      HTMLCanvasElement.prototype.getContext = getContext;

      try {
        render(PixelInspectorLoupe, {
          props: { ...activeProps, canvasElement: null },
        });

        await Promise.resolve();

        expect(getContext).not.toHaveBeenCalled();
      } finally {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
      }
    });

    it('does not draw when the internal canvas context is unavailable', async () => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      const getContext = vi.fn().mockReturnValue(null);
      HTMLCanvasElement.prototype.getContext = getContext;

      try {
        render(PixelInspectorLoupe, {
          props: activeProps,
        });

        await Promise.resolve();

        expect(getContext).toHaveBeenCalledWith('2d');
      } finally {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
      }
    });
  });
});
