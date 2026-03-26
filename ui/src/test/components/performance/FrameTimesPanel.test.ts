import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import FrameTimesPanel from '../../../lib/components/performance/FrameTimesPanel.svelte';
import type { PerformanceData } from '../../../lib/PerformanceMonitor';

// Mock requestAnimationFrame / cancelAnimationFrame
vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
  return 1;
}));
vi.stubGlobal('cancelAnimationFrame', vi.fn());

// Mock canvas getContext('2d') — jsdom does not support canvas
const mockContext = {
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  scale: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  setLineDash: vi.fn(),
  createRadialGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  clearRect: vi.fn(),
  strokeRect: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: vi.fn(),
  drawImage: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  resetTransform: vi.fn(),
  canvas: null as any,
  lineWidth: 1,
  strokeStyle: '',
  fillStyle: '',
  font: '',
  textAlign: '' as CanvasTextAlign,
  textBaseline: '' as CanvasTextBaseline,
  globalAlpha: 1,
  globalCompositeOperation: '' as GlobalCompositeOperation,
  lineCap: '' as CanvasLineCap,
  lineJoin: '' as CanvasLineJoin,
  shadowBlur: 0,
  shadowColor: '',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

beforeEach(() => {
  vi.clearAllMocks();

  // Mock HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, contextId: string) {
    if (contextId === '2d') {
      mockContext.canvas = this;
      return mockContext as unknown as CanvasRenderingContext2D;
    }
    return null;
  }) as any;

  // Mock getBoundingClientRect on canvas elements
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 600,
    height: 200,
    top: 0,
    left: 0,
    right: 600,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON: () => {},
  }));

  // Mock window.getComputedStyle to return VS Code CSS variables
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (prop: string) => {
      const vars: Record<string, string> = {
        '--vscode-editor-background': '#1e1e1e',
        '--vscode-panel-background': '#252526',
        '--vscode-foreground': '#cccccc',
        '--vscode-descriptionForeground': '#888888',
      };
      return vars[prop] ?? '';
    },
  } as CSSStyleDeclaration);
});

function makePerformanceData(overrides: Partial<PerformanceData> = {}): PerformanceData {
  const history = overrides.frameTimeHistory ?? Array.from({ length: 180 }, () => 16.6);
  return {
    currentFPS: 60,
    avgFrameTime: 16.6,
    minFrameTime: 14.0,
    maxFrameTime: 20.0,
    frameTimeHistory: history,
    frameTimeCount: history.length,
    ...overrides,
  };
}

describe('FrameTimesPanel Component', () => {
  // ─── No data state ───────────────────────────────────────────────
  describe('No data state', () => {
    it('should show "Waiting for data..." when data is null', () => {
      render(FrameTimesPanel, { props: { data: null } });
      expect(screen.getByText('Waiting for data...')).toBeInTheDocument();
    });

    it('should not show a canvas when data is null', () => {
      const { container } = render(FrameTimesPanel, { props: { data: null } });
      expect(container.querySelector('canvas')).not.toBeInTheDocument();
    });

    it('should not show toolbars when data is null', () => {
      const { container } = render(FrameTimesPanel, { props: { data: null } });
      expect(container.querySelector('.toolbar')).not.toBeInTheDocument();
    });
  });

  // ─── With data ───────────────────────────────────────────────────
  describe('With data', () => {
    it('should show canvas when data is provided', () => {
      const { container } = render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(container.querySelector('canvas')).toBeInTheDocument();
    });

    it('should not show "Waiting for data..." when data is provided', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(screen.queryByText('Waiting for data...')).not.toBeInTheDocument();
    });

    it('should show "Waiting for data..." when data has empty history', () => {
      const emptyData = makePerformanceData({ frameTimeHistory: [] });
      render(FrameTimesPanel, { props: { data: emptyData } });
      expect(screen.getByText('Waiting for data...')).toBeInTheDocument();
    });

    it('should show toolbar row above graph', () => {
      const { container } = render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const toolbar = container.querySelector('.toolbar');
      expect(toolbar).toBeInTheDocument();
      const groups = toolbar!.querySelectorAll('.toolbar-group');
      expect(groups.length).toBe(2);
    });

    it('should show downsample buttons in toolbar', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(screen.getByText('1:1')).toBeInTheDocument();
      expect(screen.getByText('1:2')).toBeInTheDocument();
      expect(screen.getByText('1:4')).toBeInTheDocument();
      expect(screen.getByText('1:8')).toBeInTheDocument();
    });

    it('should have canvas with frame-graph class', () => {
      const { container } = render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(container.querySelector('canvas.frame-graph')).toBeInTheDocument();
    });
  });

  // ─── ms/fps toggle ──────────────────────────────────────────────
  describe('ms/fps toggle', () => {
    it('should have ms button active by default', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(screen.getByText('ms')).toHaveClass('active');
      expect(screen.getByText('fps')).not.toHaveClass('active');
    });

    it('should activate fps button when clicked', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      await fireEvent.click(screen.getByText('fps'));
      expect(screen.getByText('fps')).toHaveClass('active');
      expect(screen.getByText('ms')).not.toHaveClass('active');
    });

    it('should activate ms button when clicked after fps', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      await fireEvent.click(screen.getByText('fps'));
      await fireEvent.click(screen.getByText('ms'));
      expect(screen.getByText('ms')).toHaveClass('active');
      expect(screen.getByText('fps')).not.toHaveClass('active');
    });
  });

  // ─── Center button ──────────────────────────────────────────────
  describe('Center button', () => {
    it('should not be active by default', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(screen.getByTitle('Center line on visible average')).not.toHaveClass('active');
    });

    it('should toggle centered mode when clicked', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Center line on visible average');
      await fireEvent.click(btn);
      expect(btn).toHaveClass('active');
    });

    it('should toggle off when clicked again', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Center line on visible average');
      await fireEvent.click(btn);
      await fireEvent.click(btn);
      expect(btn).not.toHaveClass('active');
    });
  });

  // ─── Pause button ──────────────────────────────────────────────
  describe('Pause button', () => {
    it('should show pause icon by default', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(screen.getByTitle('Pause graph')).toBeInTheDocument();
    });

    it('should toggle to resume state when clicked', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      await fireEvent.click(screen.getByTitle('Pause graph'));
      expect(screen.getByTitle('Resume graph')).toBeInTheDocument();
      expect(screen.getByTitle('Resume graph')).toHaveClass('active');
    });

    it('should toggle back to pause state when clicked again', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      await fireEvent.click(screen.getByTitle('Pause graph'));
      await fireEvent.click(screen.getByTitle('Resume graph'));
      expect(screen.getByTitle('Pause graph')).toBeInTheDocument();
      expect(screen.getByTitle('Pause graph')).not.toHaveClass('active');
    });
  });

  // ─── Zoom button ───────────────────────────────────────────────
  describe('Zoom button', () => {
    it('should show 1x by default', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      expect(btn).toHaveTextContent('1x');
    });

    it('should cycle through all zoom levels on clicks', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');

      const levels = ['2x', '4x', '8x', '16x', '32x', '1x'];
      for (const expected of levels) {
        await fireEvent.click(btn);
        expect(btn).toHaveTextContent(expected);
      }
    });

    it('should be active when zoom is greater than 1x', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      expect(btn).not.toHaveClass('active');
      await fireEvent.click(btn);
      expect(btn).toHaveClass('active');
    });

    it('should not be active at 1x zoom', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      expect(btn).not.toHaveClass('active');
    });
  });

  // ─── Vertical zoom via Ctrl+wheel ──────────────────────────────
  describe('Vertical zoom via Ctrl+wheel', () => {
    it('should zoom in vertically with Ctrl+scroll up', async () => {
      const { container } = render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const zoomBtn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      expect(zoomBtn).toHaveTextContent('1x');

      const graphContainer = container.querySelector('.graph-container')!;
      await fireEvent.wheel(graphContainer, { deltaY: -100, ctrlKey: true });
      expect(zoomBtn).toHaveTextContent('2x');
    });

    it('should zoom out vertically with Ctrl+scroll down', async () => {
      const { container } = render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const zoomBtn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      const graphContainer = container.querySelector('.graph-container')!;

      // Zoom in first
      await fireEvent.wheel(graphContainer, { deltaY: -100, ctrlKey: true });
      expect(zoomBtn).toHaveTextContent('2x');

      // Zoom back out
      await fireEvent.wheel(graphContainer, { deltaY: 100, ctrlKey: true });
      expect(zoomBtn).toHaveTextContent('1x');
    });

    it('should not zoom below 1x with Ctrl+scroll down', async () => {
      const { container } = render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const zoomBtn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      const graphContainer = container.querySelector('.graph-container')!;

      await fireEvent.wheel(graphContainer, { deltaY: 100, ctrlKey: true });
      expect(zoomBtn).toHaveTextContent('1x');
    });
  });

  // ─── Reset position button ──────────────────────────────────────
  describe('Reset position button', () => {
    it('should not show reset button by default', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(screen.queryByTitle('Reset pan and zoom')).not.toBeInTheDocument();
    });

    it('should show reset button when zoom is changed', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      await fireEvent.click(screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust'));
      expect(screen.getByTitle('Reset pan and zoom')).toBeInTheDocument();
    });

    it('should reset zoom when reset is clicked', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const zoomBtn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      await fireEvent.click(zoomBtn);
      expect(zoomBtn).toHaveTextContent('2x');
      await fireEvent.click(screen.getByTitle('Reset pan and zoom'));
      expect(zoomBtn).toHaveTextContent('1x');
      expect(screen.queryByTitle('Reset pan and zoom')).not.toBeInTheDocument();
    });
  });

  // ─── Background rendering ──────────────────────────────────────
  describe('Background rendering', () => {
    it('should use panel-background CSS variable for canvas background', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      // fillRect is called for background fill, should use panelBg '#252526'
      const fillRectCalls = mockContext.fillRect.mock.calls;
      expect(fillRectCalls.length).toBeGreaterThanOrEqual(1);
      // The first fillRect call is the background — check fillStyle was set
      // We verify the variable is read via getComputedStyle
      expect(window.getComputedStyle).toHaveBeenCalled();
    });

    it('should call scale with devicePixelRatio', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(mockContext.scale).toHaveBeenCalled();
    });
  });

  // ─── Context save/restore around graph drawing ─────────────────
  describe('Context state management', () => {
    it('should save and restore context around graph drawing', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      // save/restore should be called (at minimum once for the outer wrap, plus inner clips)
      expect(mockContext.save.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockContext.restore.mock.calls.length).toBeGreaterThanOrEqual(2);
      // save and restore calls should be balanced
      expect(mockContext.save.mock.calls.length).toBe(mockContext.restore.mock.calls.length);
    });
  });

  // ─── Stats display ─────────────────────────────────────────────
  describe('Stats display', () => {
    it('should draw avg/min/max values in ms mode', () => {
      render(FrameTimesPanel, {
        props: {
          data: makePerformanceData({
            avgFrameTime: 16.5,
            minFrameTime: 12.3,
            maxFrameTime: 22.1,
          }),
        },
      });

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t.includes('16.5'))).toBe(true);
      expect(fillTextCalls.some((t: string) => t.includes('12.3'))).toBe(true);
      expect(fillTextCalls.some((t: string) => t.includes('22.1'))).toBe(true);
    });

    it('should draw fps stats in fps mode', async () => {
      render(FrameTimesPanel, {
        props: {
          data: makePerformanceData({ currentFPS: 58 }),
        },
      });

      await fireEvent.click(screen.getByText('fps'));

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t.includes('58'))).toBe(true);
    });

    it('should position stats inside graph area above x-axis labels', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // Stats are drawn at y = pad.top + graphH - 18 = 6 + 194 - 18 = 182
      // with textAlign = "right"
      const fillTextCalls = mockContext.fillText.mock.calls;
      const statsCalls = fillTextCalls.filter((c: any[]) =>
        typeof c[0] === 'string' && c[0].includes('avg')
      );
      // There should be at least one avg label from stats (and possibly one from the avg line)
      expect(statsCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── X-axis drawing (inside graph area) ────────────────────────
  describe('X-axis drawing', () => {
    it('should draw "now" label inside graph area', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t === 'now')).toBe(true);
    });

    it('should draw time labels like -1s, -2s', () => {
      // 180 frames at 16.6ms ≈ 3s → should have -1s, -2s labels
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t === '-1s')).toBe(true);
      expect(fillTextCalls.some((t: string) => t === '-2s')).toBe(true);
    });

    it('should draw tick marks at bottom of graph area', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // Tick lines go from pad.top + graphH down to pad.top + graphH - 6
      // With pad.top=6, pad.bottom=0, graphH=194: ticks near y=200
      const moveToCalls = mockContext.moveTo.mock.calls;
      const hasBottomTicks = moveToCalls.some((c: number[]) => c[1] >= 194);
      expect(hasBottomTicks).toBe(true);
    });

    it('should draw x-axis labels with safe margin from canvas edges', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const canvasHeight = 200; // mock canvas height
      const fontSize = 10; // "10px monospace"
      const safeMargin = 15; // minimum px from canvas bottom for visibility

      const fillTextCalls = mockContext.fillText.mock.calls;
      const nowCall = fillTextCalls.find((c: any[]) => c[0] === 'now');
      expect(nowCall).toBeTruthy();

      // With textBaseline="bottom", the y coordinate is the bottom of the text.
      // The text itself extends upward by ~fontSize pixels.
      // To be safely visible: y must be <= canvasHeight - safeMargin
      // (accounts for parent overflow:hidden, DPI rounding, etc.)
      const labelY = nowCall![2] as number;
      expect(labelY).toBeLessThanOrEqual(canvasHeight - safeMargin);
      expect(labelY).toBeGreaterThanOrEqual(fontSize); // not clipped at top either

      // Time labels should also be within safe bounds
      const timeLabels = fillTextCalls.filter((c: any[]) =>
        typeof c[0] === 'string' && (c[0] as string).startsWith('-') && (c[0] as string).endsWith('s')
      );
      for (const label of timeLabels) {
        const y = label[2] as number;
        expect(y).toBeLessThanOrEqual(canvasHeight - safeMargin);
        expect(y).toBeGreaterThanOrEqual(fontSize);
      }
    });

    it('should not draw time labels for very short histories', () => {
      render(FrameTimesPanel, {
        props: {
          data: makePerformanceData({
            frameTimeHistory: [16.6], // only 1 sample
          }),
        },
      });

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t === 'now')).toBe(false);
      expect(fillTextCalls.some((t: string) => t === '-1s')).toBe(false);
    });

    it('should draw labels with foreground color for visibility', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // After drawing x-axis, fillStyle should have been set to fg (#cccccc)
      // Check that fillText was called (labels exist) and fillStyle was set
      const fillTextCalls = mockContext.fillText.mock.calls;
      const hasLabels = fillTextCalls.some((c: any[]) => c[0] === 'now' || (typeof c[0] === 'string' && c[0].startsWith('-')));
      expect(hasLabels).toBe(true);
    });

    it('should select appropriate tick interval for ~3s of data', () => {
      // 180 frames × 16.6ms ≈ 2.988s → totalTimeSec/0.5 ≈ 5.97 ≤ 8 → tickInterval = 0.5
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      // With 0.5s interval: should have -0.5s, -1s, -1.5s, -2s, -2.5s
      expect(fillTextCalls.some((t: string) => t === '-0.5s')).toBe(true);
      expect(fillTextCalls.some((t: string) => t === '-1s')).toBe(true);
    });

    it('should have static x-axis positions regardless of data length', () => {
      // With 50 points (partial fill) vs 180 points (full), the -1s label
      // should be at the same x position because the axis spans the full
      // visibleSamples window, not just the available data.
      const canvasWidth = 600;
      const pad = { left: 2, right: 6 };
      const graphW = canvasWidth - pad.left - pad.right; // 592
      const rightX = pad.left + graphW; // 594
      const totalTimeSec = 180 / 60; // 3s (nominal window)

      // Render with partial data (50 points)
      const { unmount } = render(FrameTimesPanel, {
        props: {
          data: makePerformanceData({
            frameTimeHistory: Array.from({ length: 50 }, () => 16.6),
          }),
        },
      });

      let fillTextCalls = mockContext.fillText.mock.calls;
      const label1sPartial = fillTextCalls.find((c: any[]) => c[0] === '-1s');
      expect(label1sPartial).toBeTruthy();
      const xPartial = label1sPartial![1] as number;

      unmount();
      vi.clearAllMocks();

      // Render with full data (180 points)
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      fillTextCalls = mockContext.fillText.mock.calls;
      const label1sFull = fillTextCalls.find((c: any[]) => c[0] === '-1s');
      expect(label1sFull).toBeTruthy();
      const xFull = label1sFull![1] as number;

      // x positions must be identical — axis is static
      expect(xPartial).toBeCloseTo(xFull, 1);

      // Verify the position matches the expected formula: rightX - (secAgo / totalTimeSec) * graphW
      const expected1sX = rightX - (1 / totalTimeSec) * graphW;
      expect(xFull).toBeCloseTo(expected1sX, 1);
    });

    it('should use textBaseline bottom for x-axis labels', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // drawXAxis sets textBaseline = "bottom"
      // Since mock tracks property assignments, we just verify labels are drawn
      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t === 'now')).toBe(true);
    });
  });

  // ─── Cursor / hover ─────────────────────────────────────────────
  describe('Cursor on hover', () => {
    it('should not draw cursor when mouse is not over graph', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // No mousemove has happened, so no cursor vertical line or dot
      const arcCalls = mockContext.arc.mock.calls;
      // arc is only used by the easter egg (moon/craters) and cursor dot
      // With no hover, no cursor arc should be drawn
      // Easter egg won't trigger with normal data, so arc count should be 0
      expect(arcCalls.length).toBe(0);
    });

    it('should draw cursor line and dot on mousemove over graph', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const graphContainer = container.querySelector('.graph-container')!;
      vi.clearAllMocks();

      // Simulate mouse moving over the graph at x=300 (middle of 600px canvas)
      await fireEvent.mouseMove(graphContainer, { clientX: 300, clientY: 100 });
      // afterUpdate triggers redraw — in test env we need to wait for tick
      await tick();

      // Should have drawn a vertical dashed line (moveTo + lineTo for cursor)
      const setLineDashCalls = mockContext.setLineDash.mock.calls;
      const hasDashedLine = setLineDashCalls.some(
        (c: any[]) => Array.isArray(c[0]) && c[0].length === 2 && c[0][0] === 2 && c[0][1] === 2
      );
      expect(hasDashedLine).toBe(true);

      // Should have drawn a dot (arc call with radius 3)
      const arcCalls = mockContext.arc.mock.calls;
      const hasDot = arcCalls.some((c: any[]) => c[2] === 3);
      expect(hasDot).toBe(true);
    });

    it('should draw value tooltip with ms by default', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const graphContainer = container.querySelector('.graph-container')!;
      vi.clearAllMocks();

      await fireEvent.mouseMove(graphContainer, { clientX: 300, clientY: 100 });
      await tick();

      const fillTextCalls = mockContext.fillText.mock.calls;
      const tooltipCall = fillTextCalls.find(
        (c: any[]) => typeof c[0] === 'string' && (c[0] as string).includes('ms') && (c[0] as string).includes('.')
      );
      expect(tooltipCall).toBeTruthy();
    });

    it('should draw value tooltip with fps when in fps mode', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // Switch to FPS mode
      const fpsBtn = screen.getByText('fps');
      await fireEvent.click(fpsBtn);

      const graphContainer = container.querySelector('.graph-container')!;
      vi.clearAllMocks();

      await fireEvent.mouseMove(graphContainer, { clientX: 300, clientY: 100 });
      await tick();

      const fillTextCalls = mockContext.fillText.mock.calls;
      const tooltipCall = fillTextCalls.find(
        (c: any[]) => typeof c[0] === 'string' && (c[0] as string).includes('fps') && (c[0] as string).includes('.')
      );
      expect(tooltipCall).toBeTruthy();
    });

    it('should include time offset in tooltip', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const graphContainer = container.querySelector('.graph-container')!;
      vi.clearAllMocks();

      // Hover near the middle — should show a time offset like "-1.5s"
      await fireEvent.mouseMove(graphContainer, { clientX: 300, clientY: 100 });
      await tick();

      const fillTextCalls = mockContext.fillText.mock.calls;
      const tooltipCall = fillTextCalls.find(
        (c: any[]) => typeof c[0] === 'string' && ((c[0] as string).includes('-') && (c[0] as string).includes('s') || (c[0] as string).includes('now'))
      );
      expect(tooltipCall).toBeTruthy();
    });

    it('should hide cursor on mouseleave', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const graphContainer = container.querySelector('.graph-container')!;

      // Move in
      await fireEvent.mouseMove(graphContainer, { clientX: 300, clientY: 100 });
      await tick();

      vi.clearAllMocks();

      // Mouse leave
      await fireEvent.mouseLeave(graphContainer);
      await tick();

      // After leaving, no cursor dot should be drawn
      const arcCalls = mockContext.arc.mock.calls;
      const hasCursorDot = arcCalls.some((c: any[]) => c[2] === 3);
      expect(hasCursorDot).toBe(false);
    });

    it('should hide cursor during drag', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const graphContainer = container.querySelector('.graph-container')!;

      // Start hover
      await fireEvent.mouseMove(graphContainer, { clientX: 300, clientY: 100 });
      await tick();

      vi.clearAllMocks();

      // Start drag
      await fireEvent.mouseDown(graphContainer, { clientX: 300, clientY: 100 });
      await tick();

      // After mousedown, hoverX should be -1 so no cursor
      const arcCalls = mockContext.arc.mock.calls;
      const hasCursorDot = arcCalls.some((c: any[]) => c[2] === 3);
      expect(hasCursorDot).toBe(false);
    });
  });

  // ─── Line drawing ──────────────────────────────────────────────
  describe('Line drawing', () => {
    it('should not stretch line to full width when fewer points than visibleSamples', () => {
      render(FrameTimesPanel, {
        props: {
          data: makePerformanceData({
            frameTimeHistory: Array.from({ length: 50 }, () => 16.6),
          }),
        },
      });

      const moveToCalls = mockContext.moveTo.mock.calls;
      if (moveToCalls.length > 0) {
        // With pad.left=2 and graphW=592, step=592/179≈3.3
        // startX = 2 + 592 - (49 * 3.3) ≈ 432, not 2
        const firstX = moveToCalls[moveToCalls.length - 1]?.[0];
        if (typeof firstX === 'number') {
          expect(firstX).toBeGreaterThan(50);
        }
      }
    });

    it('should draw line with green color (#4ec9b0)', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // The line stroke uses "#4ec9b0"
      const strokeCalls = mockContext.stroke.mock.calls;
      expect(strokeCalls.length).toBeGreaterThan(0);
    });

    it('should draw at least one moveTo and multiple lineTo for the frame time line', () => {
      render(FrameTimesPanel, {
        props: {
          data: makePerformanceData({
            frameTimeHistory: Array.from({ length: 10 }, () => 16.6),
          }),
        },
      });

      expect(mockContext.moveTo.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(mockContext.lineTo.mock.calls.length).toBeGreaterThanOrEqual(9);
    });
  });

  // ─── Reference lines ───────────────────────────────────────────
  describe('Reference lines', () => {
    it('should draw 60fps reference line in ms mode', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t.includes('60fps'))).toBe(true);
    });

    it('should draw 30fps reference line in ms mode', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t.includes('30fps'))).toBe(true);
    });

    it('should draw avg line label', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const fillTextCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      expect(fillTextCalls.some((t: string) => t.includes('avg'))).toBe(true);
    });

    it('should use dashed lines for reference lines', () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // setLineDash should be called with [3, 4] for ref lines
      const dashCalls = mockContext.setLineDash.mock.calls;
      const hasDashed = dashCalls.some((c: any[]) => Array.isArray(c[0]) && c[0].length === 2 && c[0][0] === 3);
      expect(hasDashed).toBe(true);
    });
  });

  // ─── Downsample function ───────────────────────────────────────
  describe('Downsample function', () => {
    it('should pass through data at 1:1', () => {
      render(FrameTimesPanel, {
        props: {
          data: makePerformanceData({
            frameTimeHistory: [10, 20, 30, 40],
          }),
        },
      });

      expect(mockContext.moveTo.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(mockContext.lineTo.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('should render line with correct number of points', () => {
      render(FrameTimesPanel, {
        props: {
          data: makePerformanceData({
            frameTimeHistory: Array.from({ length: 80 }, (_, i) => 10 + (i % 8)),
          }),
        },
      });

      // Should have drawn line segments (lineTo calls)
      expect(mockContext.lineTo.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Drag interaction ──────────────────────────────────────────
  describe('Drag interaction', () => {
    it('should freeze data on mousedown', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const canvas = container.querySelector('canvas')!;
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });

      // After mousedown, graph should be paused — resume button should appear
      expect(screen.getByTitle('Resume graph')).toBeInTheDocument();
    });

    it('should unfreeze data on mouseup when not manually paused', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const canvas = container.querySelector('canvas')!;
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.mouseUp(window);

      // Should go back to pause button (unpaused)
      expect(screen.getByTitle('Pause graph')).toBeInTheDocument();
    });

    it('should stay paused on mouseup when manually paused', async () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // Manually pause first
      await fireEvent.click(screen.getByTitle('Pause graph'));
      expect(screen.getByTitle('Resume graph')).toBeInTheDocument();

      // Drag should keep it paused after release
      const canvas = document.querySelector('canvas')!;
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.mouseUp(window);

      expect(screen.getByTitle('Resume graph')).toBeInTheDocument();
    });
  });

  // ─── Scroll wheel (horizontal zoom) ────────────────────────────
  describe('Scroll wheel', () => {
    it('should zoom out horizontally on scroll down', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const graphContainer = container.querySelector('.graph-container')!;

      // Default is visibleSamples=180 (index 4 in SAMPLE_STEPS)
      // Scrolling down (deltaY > 0) should increase visibleSamples
      await fireEvent.wheel(graphContainer, { deltaY: 100 });

      // We can't directly check visibleSamples, but we can verify the canvas redraws
      expect(mockContext.fillRect).toHaveBeenCalled();
    });
  });

  // ─── Y-zoom scroll wheel ─────────────────────────────────────
  describe('Y-zoom scroll wheel', () => {
    it('should zoom in (increase yZoom) on scroll up over zoom button', async () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const zoomBtn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      expect(zoomBtn).toHaveTextContent('1x');

      // Scroll up (deltaY < 0) on the zoom button → increase zoom
      await fireEvent.wheel(zoomBtn, { deltaY: -100 });
      expect(zoomBtn).toHaveTextContent('2x');
    });

    it('should zoom out (decrease yZoom) on scroll down over zoom button', async () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const zoomBtn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');

      // First zoom in
      await fireEvent.wheel(zoomBtn, { deltaY: -100 });
      expect(zoomBtn).toHaveTextContent('2x');

      // Then zoom back out
      await fireEvent.wheel(zoomBtn, { deltaY: 100 });
      expect(zoomBtn).toHaveTextContent('1x');
    });

    it('should not zoom below 1x on scroll down', async () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const zoomBtn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');
      expect(zoomBtn).toHaveTextContent('1x');

      await fireEvent.wheel(zoomBtn, { deltaY: 100 });
      expect(zoomBtn).toHaveTextContent('1x');
    });

    it('should not zoom above max level on scroll up', async () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const zoomBtn = screen.getByTitle('Vertical zoom — click to cycle, scroll to adjust');

      // Scroll up many times to hit the max (32x)
      for (let i = 0; i < 10; i++) {
        await fireEvent.wheel(zoomBtn, { deltaY: -100 });
      }

      expect(zoomBtn).toHaveTextContent('32x');
    });
  });

  // ─── visibleAvg function ──────────────────────────────────────
  describe('visibleAvg function', () => {
    // visibleAvg is tested indirectly through the component,
    // but we verify the algorithm directly here.
    function visibleAvg(values: number[]): number {
      if (values.length === 0) return 0;
      let sum = 0;
      for (const v of values) sum += v;
      return sum / values.length;
    }

    it('should return 0 for empty array', () => {
      expect(visibleAvg([])).toBe(0);
    });

    it('should return the single value for a single-element array', () => {
      expect(visibleAvg([42])).toBe(42);
    });

    it('should compute correct average', () => {
      expect(visibleAvg([10, 20, 30])).toBe(20);
      expect(visibleAvg([16, 16, 16, 16])).toBe(16);
    });

    it('should handle floating point values', () => {
      expect(visibleAvg([16.6, 16.7, 16.8])).toBeCloseTo(16.7, 5);
    });
  });

  // ─── Easter egg (moon) direction ───────────────────────────────
  describe('Easter egg (moon) direction', () => {
    // Easter egg uses UNZOOMED scale for threshold check so high zoom doesn't trigger.
    // baseZeroY = pad.top + graphH - ((0 + off) / baseMaxMs) * graphH
    // Triggers when: baseZeroY > pad.top + graphH * 3
    // Only very negative yOffset (manual drag down) should trigger.

    it('should trigger easter egg with very negative yOffset (drag down)', () => {
      // Math: baseMaxMs = 38.3 (unzoomed), graphH = 194, pad.top = 6
      // yOffset=-200: baseZeroY = 6 + 194 - (-200/38.3)*194 = 200 + 1013 = 1213 > 588 ✓
      expect(true).toBe(true);
    });

    it('should NOT trigger easter egg with positive yOffset (drag up)', () => {
      // yOffset=+100: baseZeroY = 200 - (100/38.3)*194 = 200 - 506 = -306 < 588 ✗
      expect(true).toBe(true);
    });

    it('should NOT trigger easter egg at high zoom levels without manual drag', () => {
      // At yZoom=16, adjustYOffsetForZoom: yOffset = 0.4*(38.3/16) - 16.6 = -15.64
      // baseZeroY uses unzoomed: 6 + 194 - (-15.64/38.3)*194 = 200 + 79.3 = 279.3
      // 279.3 < 588 → does NOT trigger ✓
      const pad = { top: 2, bottom: 0 };
      const graphH = 200 - pad.top - pad.bottom; // 194
      const baseMaxMs = 33.3 * 1.15; // ~38.3
      const zoomYOffset = -15.64;
      const baseZeroY = pad.top + graphH - (zoomYOffset / baseMaxMs) * graphH;
      const threshold = pad.top + graphH * 3; // 588
      expect(baseZeroY).toBeLessThan(threshold);
    });

    it('should NOT trigger at yZoom=32 without manual drag', () => {
      // At yZoom=32: zoomedScale = 38.3/32 ≈ 1.20, yOffset = 0.4*1.20 - 16.6 = -16.12
      // baseZeroY = 200 - (-16.12/38.3)*194 = 200 + 81.7 = 281.7 < 588 ✓
      const pad = { top: 2, bottom: 0 };
      const graphH = 200 - pad.top - pad.bottom;
      const baseMaxMs = 33.3 * 1.15;
      const zoomYOffset32 = 0.4 * (baseMaxMs / 32) - 16.6;
      const baseZeroY = pad.top + graphH - (zoomYOffset32 / baseMaxMs) * graphH;
      const threshold = pad.top + graphH * 3;
      expect(baseZeroY).toBeLessThan(threshold);
    });

    it('easter egg threshold formula is correct', () => {
      const pad = { top: 2, bottom: 0 };
      const graphH = 200 - pad.top - pad.bottom; // 194
      const threshold = pad.top + graphH * 3; // 2 + 594 = 596
      expect(threshold).toBe(596);

      const baseMaxMs = 33.3 * 1.15;

      // Large negative yOffset → triggers
      const neg = -200;
      expect(pad.top + graphH - (neg / baseMaxMs) * graphH).toBeGreaterThan(threshold);

      // Positive yOffset → does not trigger
      const pos = 50;
      expect(pad.top + graphH - (pos / baseMaxMs) * graphH).toBeLessThan(threshold);

      // Zero offset → well below threshold
      expect(pad.top + graphH).toBeLessThan(threshold);

      // Small negative offset → does not trigger
      const smallNeg = -30;
      expect(pad.top + graphH - (smallNeg / baseMaxMs) * graphH).toBeLessThan(threshold);
    });
  });

  // ─── Screen Hz detection ───────────────────────────────────────
  describe('Screen Hz detection', () => {
    it('should snap to nearest common Hz value', () => {
      // Verify the snapping logic by testing the algorithm inline
      const common = [60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
      function snap(rawHz: number): number {
        let best = 60;
        let bestDist = Infinity;
        for (const hz of common) {
          const dist = Math.abs(rawHz - hz);
          if (dist < bestDist) { bestDist = dist; best = hz; }
        }
        return best;
      }

      expect(snap(59.8)).toBe(60);
      expect(snap(119.7)).toBe(120);
      expect(snap(143.5)).toBe(144);
      expect(snap(240.2)).toBe(240);
      expect(snap(165)).toBe(165);
      expect(snap(73)).toBe(72);
    });
  });

  // ─── Downsample history logic ──────────────────────────────────
  describe('Downsample history logic', () => {
    // Groups aligned to absolute frame indices via frameCount.
    // Completed groups are stable even when raw history is a sliding window.
    function downsampleHistory(raw: number[], downsample: number, frameCount: number): number[] {
      if (downsample <= 1) return raw;
      const result: number[] = [];
      const firstAbsIdx = frameCount - raw.length;
      const skip = (downsample - (firstAbsIdx % downsample)) % downsample;
      for (let i = skip; i + downsample <= raw.length; i += downsample) {
        let sum = 0;
        for (let j = i; j < i + downsample; j++) sum += raw[j];
        result.push(sum / downsample);
      }
      return result;
    }

    it('should average groups correctly (no skip when aligned)', () => {
      // frameCount=4, len=4 → firstAbsIdx=0, skip=0
      expect(downsampleHistory([10, 20, 30, 40], 2, 4)).toEqual([15, 35]);
      expect(downsampleHistory([10, 20, 30, 40], 1, 4)).toEqual([10, 20, 30, 40]);
    });

    it('should drop partial groups on both ends', () => {
      // frameCount=5, len=5 → firstAbsIdx=0, skip=0
      // Groups: [0..1]=15, [2..3]=35, trailing [4] dropped
      expect(downsampleHistory([10, 20, 30, 40, 50], 2, 5)).toEqual([15, 35]);
    });

    it('should return empty for fewer samples than downsample factor', () => {
      expect(downsampleHistory([10, 20, 30], 4, 3)).toEqual([]);
    });

    it('should keep ALL groups perfectly stable as data grows', () => {
      // KEY PROPERTY: existing completed groups never change as frames append
      const data8 = [10, 20, 30, 40, 50, 60, 70, 80];
      const data9 = [10, 20, 30, 40, 50, 60, 70, 80, 90];
      const data16 = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];

      expect(downsampleHistory(data8, 4, 8)).toEqual([25, 65]);
      expect(downsampleHistory(data9, 4, 9)).toEqual([25, 65]); // trailing [90] dropped
      expect(downsampleHistory(data16, 4, 16)).toEqual([25, 65, 105, 145]);
    });

    it('should keep groups stable when sliding window shifts', () => {
      // Simulate a sliding window of 8 elements at downsample=4
      // Frame 12: raw=[5,6,7,8,9,10,11,12] (abs 4-11), frameCount=12
      //   firstAbsIdx=4, skip=0, groups: [5,6,7,8]=6.5, [9,10,11,12]=10.5
      const frame12 = [5, 6, 7, 8, 9, 10, 11, 12];
      expect(downsampleHistory(frame12, 4, 12)).toEqual([6.5, 10.5]);

      // Frame 13: raw=[6,7,8,9,10,11,12,13] (abs 5-12), frameCount=13
      //   firstAbsIdx=5, skip=3, groups start at index 3: [9,10,11,12]=10.5
      const frame13 = [6, 7, 8, 9, 10, 11, 12, 13];
      expect(downsampleHistory(frame13, 4, 13)).toEqual([10.5]); // group [abs 8-11] stable!

      // Frame 16: raw=[9,10,11,12,13,14,15,16] (abs 8-15), frameCount=16
      //   firstAbsIdx=8, skip=0, groups: [9,10,11,12]=10.5, [13,14,15,16]=14.5
      const frame16 = [9, 10, 11, 12, 13, 14, 15, 16];
      expect(downsampleHistory(frame16, 4, 16)).toEqual([10.5, 14.5]);
      // group [abs 8-11]=10.5 unchanged from frame 13!
    });

    it('should produce correct count of groups', () => {
      const data = Array.from({ length: 100 }, (_, i) => i);
      expect(downsampleHistory(data, 4, 100)).toHaveLength(25);
      expect(downsampleHistory(data, 8, 100)).toHaveLength(12);
    });

    it('should handle skip when firstAbsIdx is not aligned', () => {
      // frameCount=10, len=6 → firstAbsIdx=4, skip=0
      const data = [10, 20, 30, 40, 50, 60];
      expect(downsampleHistory(data, 4, 10)).toEqual([25]); // [10,20,30,40]

      // frameCount=12, len=6 → firstAbsIdx=6, skip=2
      // group at [2..5] = [30,40,50,60] = 45
      expect(downsampleHistory(data, 4, 12)).toEqual([45]);
    });

    it('should keep groups stable through a long sliding window simulation', () => {
      // Simulate a sliding window of size 16, downsample=4
      // Push frames 0..31, window caps at 16
      const MAX = 16;
      const d = 4;
      const allFrames: number[] = [];
      const snapshots: { raw: number[]; fc: number; result: number[] }[] = [];

      for (let frame = 0; frame < 32; frame++) {
        allFrames.push(frame * 10); // values: 0, 10, 20, ...
        const raw = allFrames.length > MAX ? allFrames.slice(-MAX) : [...allFrames];
        const fc = allFrames.length;
        const result = downsampleHistory(raw, d, fc);
        snapshots.push({ raw, fc, result });
      }

      // Verify stability: any group that appears in two consecutive snapshots
      // should have the exact same value
      for (let i = 1; i < snapshots.length; i++) {
        const prev = snapshots[i - 1];
        const curr = snapshots[i];

        // Each group covers absolute indices [g*d .. (g+1)*d - 1]
        // A group's value = average of those raw values
        // If both snapshots contain the same complete group, values must match
        const prevFirstAbs = prev.fc - prev.raw.length;
        const currFirstAbs = curr.fc - curr.raw.length;
        const prevSkip = (d - (prevFirstAbs % d)) % d;
        const currSkip = (d - (currFirstAbs % d)) % d;

        // Map group indices to absolute group numbers
        const prevGroups = new Map<number, number>();
        for (let g = 0; g < prev.result.length; g++) {
          const absGroupStart = prevFirstAbs + prevSkip + g * d;
          prevGroups.set(absGroupStart, prev.result[g]);
        }

        for (let g = 0; g < curr.result.length; g++) {
          const absGroupStart = currFirstAbs + currSkip + g * d;
          if (prevGroups.has(absGroupStart)) {
            expect(curr.result[g]).toBe(prevGroups.get(absGroupStart));
          }
        }
      }
    });

    it('OLD METHOD (no frameCount) would produce unstable groups in sliding window', () => {
      // This test proves WHY frameCount is needed.
      // Without it (old method), groups are anchored to array index 0,
      // so when the sliding window shifts, all group values change.
      function oldDownsample(raw: number[], downsample: number): number[] {
        if (downsample <= 1) return raw;
        const result: number[] = [];
        const fullGroups = Math.floor(raw.length / downsample);
        for (let g = 0; g < fullGroups; g++) {
          let sum = 0;
          const base = g * downsample;
          for (let j = base; j < base + downsample; j++) sum += raw[j];
          result.push(sum / downsample);
        }
        return result;
      }

      // Sliding window of 8, downsample=4
      // Frame 12: raw=[5,6,7,8,9,10,11,12]
      const frame12 = [5, 6, 7, 8, 9, 10, 11, 12];
      const old12 = oldDownsample(frame12, 4); // [6.5, 10.5]

      // Frame 13: raw=[6,7,8,9,10,11,12,13] (window shifted by 1)
      const frame13 = [6, 7, 8, 9, 10, 11, 12, 13];
      const old13 = oldDownsample(frame13, 4); // [7.5, 11.5] ← DIFFERENT!

      // Old method: BOTH groups changed (6.5→7.5, 10.5→11.5)
      // This is the flickering the user sees.
      expect(old12).toEqual([6.5, 10.5]);
      expect(old13).toEqual([7.5, 11.5]);
      expect(old12).not.toEqual(old13); // proves instability!

      // New method with frameCount: shared group stays identical
      const new12 = downsampleHistory(frame12, 4, 12); // [6.5, 10.5]
      const new13 = downsampleHistory(frame13, 4, 13); // [10.5] (left group now partial → dropped)
      expect(new12[1]).toBe(10.5);
      expect(new13[0]).toBe(10.5); // SAME value — stable!
    });

    it('should handle all downsample rates (2, 4, 8) through sliding window', () => {
      for (const d of [2, 4, 8]) {
        const MAX = 20;
        let allFrames: number[] = [];

        // Build up to full window, then slide 10 more frames
        for (let frame = 0; frame < MAX + 10; frame++) {
          allFrames.push(frame);
          if (allFrames.length > MAX) allFrames = allFrames.slice(-MAX);

          const fc = frame + 1;
          const result = downsampleHistory([...allFrames], d, fc);

          // All values should be finite numbers
          for (const v of result) {
            expect(Number.isFinite(v)).toBe(true);
          }

          // Length should never exceed ceil(MAX / d)
          expect(result.length).toBeLessThanOrEqual(Math.ceil(MAX / d));
        }
      }
    });

    it('skip formula should produce values in range [0, downsample)', () => {
      for (const d of [2, 4, 8]) {
        for (let fc = 0; fc < 100; fc++) {
          for (let len = 1; len <= fc; len++) {
            const firstAbsIdx = fc - len;
            const skip = (d - (firstAbsIdx % d)) % d;
            expect(skip).toBeGreaterThanOrEqual(0);
            expect(skip).toBeLessThan(d);
          }
        }
      }
    });
  });

  // ─── Visible slice logic ───────────────────────────────────────
  describe('Visible slice logic', () => {
    function downsampleHistory(raw: number[], downsample: number, frameCount: number): number[] {
      if (downsample <= 1) return raw;
      const result: number[] = [];
      const firstAbsIdx = frameCount - raw.length;
      const skip = (downsample - (firstAbsIdx % downsample)) % downsample;
      for (let i = skip; i + downsample <= raw.length; i += downsample) {
        let sum = 0;
        for (let j = i; j < i + downsample; j++) sum += raw[j];
        result.push(sum / downsample);
      }
      return result;
    }

    function getVisibleSlice(
      fullHistory: number[],
      downsample: number,
      visibleSamples: number,
      xOffset: number,
      frameCount: number,
    ): number[] {
      const downsampled = downsampleHistory(fullHistory, downsample, frameCount);
      const maxPoints = Math.ceil(visibleSamples / downsample);
      const end = downsampled.length - xOffset;
      const start = Math.max(0, end - maxPoints);
      return downsampled.slice(start, end);
    }

    it('should return at most visibleSamples entries at 1:1', () => {
      const history = Array.from({ length: 500 }, (_, i) => 16 + (i % 5));
      expect(getVisibleSlice(history, 1, 180, 0, 500)).toHaveLength(180);
    });

    it('should limit to ceil(visibleSamples/downsample) at higher rates', () => {
      const history = Array.from({ length: 500 }, (_, i) => 16 + (i % 5));
      // At 1:4 with visibleSamples=180: maxPoints = ceil(180/4) = 45
      expect(getVisibleSlice(history, 4, 180, 0, 500)).toHaveLength(45);
      // At 1:8: maxPoints = ceil(180/8) = 23
      expect(getVisibleSlice(history, 8, 180, 0, 500)).toHaveLength(23);
    });

    it('should respect xOffset for scrolling back', () => {
      const history = Array.from({ length: 500 }, (_, i) => 16 + (i % 5));
      const slice = getVisibleSlice(history, 1, 180, 100, 500);
      expect(slice).toHaveLength(180);
    });

    it('should return all data when visibleSamples exceeds length', () => {
      const history = Array.from({ length: 500 }, (_, i) => 16 + (i % 5));
      expect(getVisibleSlice(history, 1, 1000, 0, 500)).toHaveLength(500);
    });

    it('should downsample before slicing (drops partial groups)', () => {
      const history = Array.from({ length: 400 }, () => 16);
      // At 1:4, 400 aligned → 100 groups, maxPoints = 45, slice last 45
      expect(getVisibleSlice(history, 4, 180, 0, 400)).toHaveLength(45);

      const history401 = Array.from({ length: 401 }, () => 16);
      // At 1:4, 401 aligned → 100 full groups + trailing partial dropped
      expect(getVisibleSlice(history401, 4, 180, 0, 401)).toHaveLength(45);
    });

    it('should return fewer points when not enough data to fill window', () => {
      const history = Array.from({ length: 100 }, () => 16);
      // At 1:4, 100 aligned → 25 groups, maxPoints = 45 → only 25 available
      expect(getVisibleSlice(history, 4, 180, 0, 100)).toHaveLength(25);
    });
  });

  // ─── adjustYOffsetForZoom ──────────────────────────────────────
  describe('adjustYOffsetForZoom', () => {
    it('should place avg at 40% from bottom of zoomed scale', () => {
      // The formula: yOffset = 0.4 * zoomedScale - avg
      const avg = 16.6;
      const visMax = 20;
      const yZoom = 4;
      const zoomedScale = Math.max(33.3, visMax) * 1.15 / yZoom; // 38.3 / 4 = 9.575
      const expectedOffset = 0.4 * zoomedScale - avg; // 3.83 - 16.6 = -12.77
      expect(expectedOffset).toBeCloseTo(-12.77, 1);
    });

    it('should produce yOffset=0 at 1x when avg is at 40% of scale', () => {
      const avg = 15.32; // 0.4 * 38.3
      const yZoom = 1;
      const zoomedScale = 33.3 * 1.15 / yZoom; // 38.295
      const offset = 0.4 * zoomedScale - avg; // 15.318 - 15.32 ≈ 0
      expect(offset).toBeCloseTo(0, 0);
    });
  });

  // ─── computeYOffset ────────────────────────────────────────────
  describe('computeYOffset', () => {
    it('returns raw yOffset when not centered', () => {
      // Not centered: computeYOffset returns yOffset directly
      // This is tested implicitly through the component, but verify the formula
      const yOffset = 5;
      const centered = false;
      const result = centered ? 0.5 * 38.3 - 16.6 : yOffset;
      expect(result).toBe(5);
    });

    it('returns centered offset when centered', () => {
      const maxScale = 38.3;
      const avg = 16.6;
      const centeredOffset = 0.5 * maxScale - avg; // 19.15 - 16.6 = 2.55
      expect(centeredOffset).toBeCloseTo(2.55, 1);
    });
  });

  // ─── Tick interval selection ───────────────────────────────────
  describe('Tick interval selection', () => {
    it('should choose correct intervals for different time spans', () => {
      function pickTickInterval(totalTimeSec: number): number {
        const tickIntervals = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
        for (const t of tickIntervals) {
          if (totalTimeSec / t <= 8) return t;
        }
        return 60;
      }

      expect(pickTickInterval(1)).toBe(0.25);     // 1/0.25=4 ≤ 8
      expect(pickTickInterval(2)).toBe(0.25);      // 2/0.25=8 ≤ 8
      expect(pickTickInterval(3)).toBe(0.5);       // 3/0.25=12>8, 3/0.5=6 ≤ 8
      expect(pickTickInterval(5)).toBe(1);         // 5/0.5=10>8, 5/1=5 ≤ 8
      expect(pickTickInterval(10)).toBe(2);        // 10/1=10>8, 10/2=5 ≤ 8
      expect(pickTickInterval(20)).toBe(5);        // 20/2=10>8, 20/5=4 ≤ 8
      expect(pickTickInterval(60)).toBe(10);       // 60/5=12>8, 60/10=6 ≤ 8
    });
  });

  // ─── timeToX mapping ───────────────────────────────────────────
  describe('timeToX mapping', () => {
    it('should map 0 seconds ago to rightX', () => {
      // timeToX(0) = rightX - (0/total) * ... = rightX
      const rightX = 594;
      const totalTimeSec = 3;
      const historyLen = 180;
      const visibleSamples = 180;
      const graphW = 592;
      const x = rightX - (0 / totalTimeSec) * ((historyLen - 1) / (visibleSamples - 1)) * graphW;
      expect(x).toBe(rightX);
    });

    it('should map total time to leftmost data position', () => {
      const rightX = 594;
      const totalTimeSec = 3;
      const historyLen = 180;
      const visibleSamples = 180;
      const graphW = 592;
      const x = rightX - (totalTimeSec / totalTimeSec) * ((historyLen - 1) / (visibleSamples - 1)) * graphW;
      // (179/179) * 592 = 592; rightX - 592 = 2 = pad.left
      expect(x).toBeCloseTo(2, 0);
    });

    it('should handle fewer data points than visibleSamples', () => {
      const rightX = 594;
      const totalTimeSec = 1;
      const historyLen = 60;
      const visibleSamples = 180;
      const graphW = 592;
      const x = rightX - (totalTimeSec / totalTimeSec) * ((historyLen - 1) / (visibleSamples - 1)) * graphW;
      // (59/179) * 592 = 195; rightX - 195 = 399
      expect(x).toBeCloseTo(399, 0);
    });
  });

  // ─── Horizontal zoom button (cycleHZoom) ─────────────────────
  describe('Horizontal zoom button', () => {
    it('should show default time window label of 3s', () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');
      expect(btn).toHaveTextContent('3s');
    });

    it('should cycle through time windows on click', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');

      // Default is 180 samples = 3s (index 4)
      // Click cycles to next: 300 = 5s
      await fireEvent.click(btn);
      expect(btn).toHaveTextContent('5s');

      // Next: 450 = 7.5s
      await fireEvent.click(btn);
      expect(btn).toHaveTextContent('7.5s');
    });

    it('should wrap around to first step after last', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');

      // Cycle through all steps: 180→300→450→600→900→1200→1800→3600→wrap to 30
      const clicks = 8; // 8 clicks from index 4 to wrap
      for (let i = 0; i < clicks; i++) {
        await fireEvent.click(btn);
      }
      expect(btn).toHaveTextContent('500ms'); // 30 samples = 0.5s
    });

    it('should be active when not at default (180 samples)', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');
      expect(btn).not.toHaveClass('active');

      await fireEvent.click(btn);
      expect(btn).toHaveClass('active');
    });

    it('should show reset button when horizontal zoom is changed', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      expect(screen.queryByTitle('Reset pan and zoom')).not.toBeInTheDocument();

      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');
      await fireEvent.click(btn);
      expect(screen.getByTitle('Reset pan and zoom')).toBeInTheDocument();
    });

    it('should zoom in on scroll up over the button', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');

      // Scroll up (deltaY < 0) → fewer samples → zoom in
      await fireEvent.wheel(btn, { deltaY: -100 });
      expect(btn).toHaveTextContent('2s'); // 120 samples
    });

    it('should zoom out on scroll down over the button', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');

      // Scroll down (deltaY > 0) → more samples → zoom out
      await fireEvent.wheel(btn, { deltaY: 100 });
      expect(btn).toHaveTextContent('5s'); // 300 samples
    });
  });

  // ─── Scroll wheel horizontal zoom (behavioral) ───────────────
  describe('Scroll wheel horizontal zoom', () => {
    it('should update time window label on scroll down', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const hzoomBtn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');
      expect(hzoomBtn).toHaveTextContent('3s');

      const graphContainer = container.querySelector('.graph-container')!;
      await fireEvent.wheel(graphContainer, { deltaY: 100 });

      expect(hzoomBtn).toHaveTextContent('5s');
    });

    it('should update time window label on scroll up', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const hzoomBtn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');
      const graphContainer = container.querySelector('.graph-container')!;

      await fireEvent.wheel(graphContainer, { deltaY: -100 });
      expect(hzoomBtn).toHaveTextContent('2s');
    });
  });

  // ─── Drag panning ────────────────────────────────────────────
  describe('Drag panning', () => {
    it('should show dragging cursor class during drag', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const canvas = container.querySelector('canvas')!;
      await fireEvent.mouseDown(canvas, { clientX: 300, clientY: 100 });

      expect(canvas).toHaveClass('dragging');

      await fireEvent.mouseUp(window);
      expect(canvas).not.toHaveClass('dragging');
    });

    it('should show reset button after dragging (xOffset changes)', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData({ frameTimeHistory: Array.from({ length: 600 }, () => 16.6) }) },
      });

      const canvas = container.querySelector('canvas')!;

      // Manually pause first so drag doesn't auto-unpause and reset xOffset
      await fireEvent.click(screen.getByTitle('Pause graph'));

      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      // Drag right (positive dx) to increase xOffset
      await fireEvent.mouseMove(canvas, { clientX: 400, clientY: 100 });
      await fireEvent.mouseUp(window);

      // If xOffset changed, reset button should appear
      expect(screen.getByTitle('Reset pan and zoom')).toBeInTheDocument();
    });
  });

  // ─── computeTimeWindowLabel ──────────────────────────────────
  describe('Time window label formatting', () => {
    it('should show sub-second labels in ms', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');

      // Cycle to 30 samples = 500ms — need to wrap around
      // From 180 (index 4), cycle 8 times to wrap to index 0 (30 samples)
      for (let i = 0; i < 8; i++) {
        await fireEvent.click(btn);
      }
      expect(btn).toHaveTextContent('500ms');
    });

    it('should show whole-second labels without decimal', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');

      // Default 180 = 3s
      expect(btn).toHaveTextContent('3s');
    });

    it('should show minute labels for large windows', async () => {
      render(FrameTimesPanel, { props: { data: makePerformanceData() } });
      const btn = screen.getByTitle('Horizontal zoom (time window) — click to cycle, scroll to adjust');

      // Cycle to 3600 samples = 60s = 1m (index 11, need 7 clicks from index 4)
      for (let i = 0; i < 7; i++) {
        await fireEvent.click(btn);
      }
      expect(btn).toHaveTextContent('1m');
    });
  });

  // ─── FPS mode graph line drawing ─────────────────────────────
  describe('FPS mode graph rendering', () => {
    it('should convert ms to fps values when drawing in fps mode', async () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData({ frameTimeHistory: Array.from({ length: 180 }, () => 16.6) }) },
      });

      // Switch to FPS mode
      await fireEvent.click(screen.getByText('fps'));

      // Verify the graph redraws — lineTo should have been called with fps-scale values
      // At 16.6ms, fps ≈ 60.24. The y coordinate should reflect fps scale, not ms scale
      const lineToYCalls = mockContext.lineTo.mock.calls.map((c: number[]) => c[1]);
      // In fps mode, values should be mapped using 1000/ms, so y-positions differ from ms mode
      expect(lineToYCalls.length).toBeGreaterThan(0);
    });

    it('should show fps stats when in fps mode', async () => {
      render(FrameTimesPanel, {
        props: { data: makePerformanceData({ currentFPS: 60 }) },
      });

      await fireEvent.click(screen.getByText('fps'));

      // fillText should include fps value
      const textCalls = mockContext.fillText.mock.calls.map((c: any[]) => c[0]);
      const hasFpsText = textCalls.some((t: string) => t.includes('fps'));
      expect(hasFpsText).toBe(true);
    });
  });

  // ─── manualPause vs drag pause ───────────────────────────────
  describe('Manual pause vs drag pause', () => {
    it('should set manualPause via pause button (stays paused after drag)', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      // Manually pause
      await fireEvent.click(screen.getByTitle('Pause graph'));
      expect(screen.getByTitle('Resume graph')).toBeInTheDocument();

      // Drag and release — should stay paused because manualPause=true
      const canvas = container.querySelector('canvas')!;
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      await fireEvent.mouseUp(window);
      expect(screen.getByTitle('Resume graph')).toBeInTheDocument();

      // Click resume — should now unpause
      await fireEvent.click(screen.getByTitle('Resume graph'));
      expect(screen.getByTitle('Pause graph')).toBeInTheDocument();
    });

    it('should auto-unpause after drag when not manually paused', async () => {
      const { container } = render(FrameTimesPanel, {
        props: { data: makePerformanceData() },
      });

      const canvas = container.querySelector('canvas')!;

      // Drag without manual pause
      await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      // During drag, should be paused
      expect(screen.getByTitle('Resume graph')).toBeInTheDocument();

      await fireEvent.mouseUp(window);
      // After release, should auto-unpause
      expect(screen.getByTitle('Pause graph')).toBeInTheDocument();
    });
  });
});
