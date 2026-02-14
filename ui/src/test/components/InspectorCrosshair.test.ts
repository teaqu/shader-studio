import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import InspectorCrosshair from '../../lib/components/InspectorCrosshair.svelte';

describe('InspectorCrosshair Component', () => {
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    mockCanvas = {
      width: 800,
      height: 600,
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 800,
        height: 600,
        right: 900,
        bottom: 650,
        x: 100,
        y: 50,
        toJSON: () => {},
      }),
    } as HTMLCanvasElement;
  });

  const defaultProps = {
    isVisible: false,
    canvasX: 0,
    canvasY: 0,
    canvasElement: null as HTMLCanvasElement | null,
  };

  describe('Visibility', () => {
    it('should not render when isVisible is false', () => {
      const { container } = render(InspectorCrosshair, { props: defaultProps });
      expect(container.querySelector('.crosshair')).not.toBeInTheDocument();
    });

    it('should not render when canvasElement is null', () => {
      const { container } = render(InspectorCrosshair, {
        props: { ...defaultProps, isVisible: true },
      });
      expect(container.querySelector('.crosshair')).not.toBeInTheDocument();
    });

    it('should render when isVisible is true and canvasElement is provided', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 400,
          canvasY: 300,
        },
      });
      expect(container.querySelector('.crosshair')).toBeInTheDocument();
    });
  });

  describe('Structure', () => {
    it('should render horizontal line', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 400,
          canvasY: 300,
        },
      });

      const horizontalLine = container.querySelector('.line.horizontal');
      expect(horizontalLine).toBeInTheDocument();
    });

    it('should render vertical line', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 400,
          canvasY: 300,
        },
      });

      const verticalLine = container.querySelector('.line.vertical');
      expect(verticalLine).toBeInTheDocument();
    });

    it('should render center dot', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 400,
          canvasY: 300,
        },
      });

      const centerDot = container.querySelector('.center-dot');
      expect(centerDot).toBeInTheDocument();
    });

    it('should have all three elements (crosshair structure)', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 400,
          canvasY: 300,
        },
      });

      expect(container.querySelector('.crosshair')).toBeInTheDocument();
      expect(container.querySelector('.line.horizontal')).toBeInTheDocument();
      expect(container.querySelector('.line.vertical')).toBeInTheDocument();
      expect(container.querySelector('.center-dot')).toBeInTheDocument();
    });
  });

  describe('Positioning', () => {
    it('should convert canvas coordinates to screen coordinates', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 400, // Middle of 800px canvas
          canvasY: 300, // Middle of 600px canvas
        },
      });

      const crosshair = container.querySelector('.crosshair') as HTMLElement;
      expect(crosshair).toBeInTheDocument();

      // Canvas: 800x600, positioned at (100, 50)
      // Canvas center (400, 300) should map to screen (100 + 400, 50 + 300) = (500, 350)
      expect(crosshair).toHaveStyle('left: 500px');
      expect(crosshair).toHaveStyle('top: 350px');
    });

    it('should handle top-left corner position', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 0,
          canvasY: 0,
        },
      });

      const crosshair = container.querySelector('.crosshair') as HTMLElement;
      // Canvas at (100, 50), position (0,0) maps to (100, 50)
      expect(crosshair).toHaveStyle('left: 100px');
      expect(crosshair).toHaveStyle('top: 50px');
    });

    it('should handle bottom-right corner position', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 800,
          canvasY: 600,
        },
      });

      const crosshair = container.querySelector('.crosshair') as HTMLElement;
      // Canvas at (100, 50), size 800x600, position (800,600) maps to (900, 650)
      expect(crosshair).toHaveStyle('left: 900px');
      expect(crosshair).toHaveStyle('top: 650px');
    });

  });

  describe('CSS Classes', () => {
    it('should have correct CSS classes', () => {
      const { container } = render(InspectorCrosshair, {
        props: {
          ...defaultProps,
          isVisible: true,
          canvasElement: mockCanvas,
          canvasX: 400,
          canvasY: 300,
        },
      });

      const crosshair = container.querySelector('.crosshair');
      const horizontalLine = container.querySelector('.line.horizontal');
      const verticalLine = container.querySelector('.line.vertical');
      const centerDot = container.querySelector('.center-dot');

      expect(crosshair).toHaveClass('crosshair');
      expect(horizontalLine).toHaveClass('line', 'horizontal');
      expect(verticalLine).toHaveClass('line', 'vertical');
      expect(centerDot).toHaveClass('center-dot');
    });
  });
});
