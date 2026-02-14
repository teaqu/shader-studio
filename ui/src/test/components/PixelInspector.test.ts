import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import PixelInspector from '../../lib/components/PixelInspector.svelte';

describe('PixelInspector Component', () => {
  const defaultProps = {
    isActive: false,
    isLocked: false,
    mouseX: 100,
    mouseY: 100,
    rgb: null as { r: number; g: number; b: number } | null,
    fragCoord: null as { x: number; y: number } | null,
    canvasWidth: 800,
    canvasHeight: 600
  };

  describe('Visibility', () => {
    it('should not render when isActive is false', () => {
      const { container } = render(PixelInspector, { props: defaultProps });
      
      expect(container.querySelector('.pixel-inspector')).not.toBeInTheDocument();
    });

    it('should not render when isActive is true but rgb is null', () => {
      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      expect(container.querySelector('.pixel-inspector')).not.toBeInTheDocument();
    });

    it('should not render when isActive is true but fragCoord is null', () => {
      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 64 }
        }
      });
      
      expect(container.querySelector('.pixel-inspector')).not.toBeInTheDocument();
    });

    it('should render when isActive is true and rgb and fragCoord are provided', () => {
      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      expect(container.querySelector('.pixel-inspector')).toBeInTheDocument();
    });
  });

  describe('RGB Display', () => {
    it('should display RGB values correctly', () => {
      render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      expect(screen.getByText('(255, 128, 64)')).toBeInTheDocument();
    });

    it('should display normalized float values correctly', () => {
      render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 0 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      // 255/255 = 1.000, 128/255 ≈ 0.502, 0/255 = 0.000
      expect(screen.getByText('(1.000, 0.502, 0.000)')).toBeInTheDocument();
    });

    it('should display hex color correctly', () => {
      render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      // 255 = ff, 128 = 80, 64 = 40
      expect(screen.getByText('#ff8040')).toBeInTheDocument();
    });

    it('should pad hex values with zeros', () => {
      render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 0, g: 15, b: 1 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      // 0 = 00, 15 = 0f, 1 = 01
      expect(screen.getByText('#000f01')).toBeInTheDocument();
    });
  });

  describe('Coordinate Display', () => {
    it('should display fragCoord values correctly', () => {
      render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400.5, y: 300.25 }
        }
      });
      
      expect(screen.getByText('(400.5, 300.3)')).toBeInTheDocument();
    });

    it('should display UV coordinates correctly', () => {
      render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 },
          canvasWidth: 800,
          canvasHeight: 600
        }
      });
      
      // UV = fragCoord / canvasSize = (400/800, 300/600) = (0.500, 0.500)
      expect(screen.getByText('(0.500, 0.500)')).toBeInTheDocument();
    });
  });

  describe('Color Preview', () => {
    it('should display color preview with correct background color', () => {
      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      const colorPreview = container.querySelector('.color-preview');
      expect(colorPreview).toBeInTheDocument();
      expect(colorPreview).toHaveStyle('background-color: rgb(255, 128, 64)');
    });
  });

  describe('Positioning', () => {
    it('should position inspector offset from mouse position (right side)', () => {
      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          mouseX: 200,
          mouseY: 150,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });

      const inspector = container.querySelector('.pixel-inspector') as HTMLElement;
      expect(inspector).toHaveStyle('left: 220px'); // mouseX + 20
      expect(inspector).toHaveStyle('top: 170px'); // mouseY + 20
    });

    it('should flip to left when would overflow on right side', () => {
      // Mock window.innerWidth to be small enough to trigger overflow
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 500
      });

      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          mouseX: 400, // Close to right edge
          mouseY: 150,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });

      const inspector = container.querySelector('.pixel-inspector') as HTMLElement;
      // Should flip left: mouseX - ESTIMATED_WIDTH - OFFSET = 400 - 250 - 20 = 130px
      expect(inspector).toHaveStyle('left: 130px');
      expect(inspector).toHaveStyle('top: 170px'); // mouseY + 20
    });

    it('should stay on right when enough space', () => {
      // Mock window.innerWidth to be large enough
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1920
      });

      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          mouseX: 200,
          mouseY: 150,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });

      const inspector = container.querySelector('.pixel-inspector') as HTMLElement;
      // Should stay on right: mouseX + 20 = 220px
      expect(inspector).toHaveStyle('left: 220px');
      expect(inspector).toHaveStyle('top: 170px');
    });
  });

  describe('Lock State', () => {
    it('should have locked class when isLocked is true', () => {
      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          isLocked: true,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      const inspector = container.querySelector('.pixel-inspector');
      expect(inspector).toHaveClass('locked');
    });

    it('should not have locked class when isLocked is false', () => {
      const { container } = render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          isLocked: false,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      const inspector = container.querySelector('.pixel-inspector');
      expect(inspector).not.toHaveClass('locked');
    });
  });

  describe('Labels', () => {
    it('should display all labels', () => {
      render(PixelInspector, {
        props: {
          ...defaultProps,
          isActive: true,
          rgb: { r: 255, g: 128, b: 64 },
          fragCoord: { x: 400, y: 300 }
        }
      });
      
      expect(screen.getByText('RGB:')).toBeInTheDocument();
      expect(screen.getByText('Float:')).toBeInTheDocument();
      expect(screen.getByText('Hex:')).toBeInTheDocument();
      expect(screen.getByText('fragCoord:')).toBeInTheDocument();
      expect(screen.getByText('UV:')).toBeInTheDocument();
    });
  });
});
