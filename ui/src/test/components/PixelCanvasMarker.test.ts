import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import '@testing-library/jest-dom';
import PixelCanvasMarker from '../../lib/components/PixelCanvasMarker.svelte';
import { setInspectorState } from '../../lib/state/pixelInspectorState.svelte';
import { debugPanelStore } from '../../lib/stores/debugPanelStore';
import type { PixelInspectorState } from '../../lib/types/PixelInspectorState';

function makeInspectorState(overrides: Partial<PixelInspectorState> = {}): PixelInspectorState {
  return {
    isEnabled: true,
    isActive: true,
    isLocked: true,
    mouseX: 0,
    mouseY: 0,
    pixelRGB: { r: 1, g: 2, b: 3 },
    fragCoord: { x: 400, y: 300 },
    canvasPosition: { x: 400, y: 300 },
    ...overrides,
  };
}

function makeMockCtx() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
  };
}

const glCanvas = {
  width: 800,
  height: 600,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
} as unknown as HTMLCanvasElement;

const container = {
  clientWidth: 800,
  clientHeight: 600,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
} as unknown as HTMLElement;

describe('PixelCanvasMarker', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    debugPanelStore.setPixelMarkerEnabled(true);
    setInspectorState(makeInspectorState());
    originalGetContext = HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  function renderWithCtx(ctx: ReturnType<typeof makeMockCtx>) {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(ctx) as any;
    return render(PixelCanvasMarker, { props: { glCanvas, container } });
  }

  it('renders an overlay canvas', () => {
    const ctx = makeMockCtx();
    const { container: dom } = renderWithCtx(ctx);
    expect(dom.querySelector('canvas.pixel-canvas-marker')).toBeInTheDocument();
  });

  it('draws the crosshair when enabled, inspector enabled and locked', () => {
    const ctx = makeMockCtx();
    renderWithCtx(ctx);
    flushSync();
    // box around the exact pixel: pos (400,300), pixelSize 1 -> centre (400.5, 300.5)
    expect(ctx.strokeRect).toHaveBeenCalledWith(400, 300, 1, 1);
    expect(ctx.stroke).toHaveBeenCalled();
    // double stroke per draw: black outline then white -> even number of box strokes
    expect(ctx.strokeRect.mock.calls.length % 2).toBe(0);
  });

  it('clears and does not draw when the marker toggle is off', () => {
    debugPanelStore.setPixelMarkerEnabled(false);
    const ctx = makeMockCtx();
    renderWithCtx(ctx);
    flushSync();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('does not draw when the inspector is not locked', () => {
    setInspectorState(makeInspectorState({ isLocked: false }));
    const ctx = makeMockCtx();
    renderWithCtx(ctx);
    flushSync();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('does not draw when the inspector is disabled', () => {
    setInspectorState(makeInspectorState({ isEnabled: false }));
    const ctx = makeMockCtx();
    renderWithCtx(ctx);
    flushSync();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('does not draw when there is no locked canvas position', () => {
    setInspectorState(makeInspectorState({ canvasPosition: null }));
    const ctx = makeMockCtx();
    renderWithCtx(ctx);
    flushSync();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('redraws when the locked position changes', () => {
    const ctx = makeMockCtx();
    renderWithCtx(ctx);
    flushSync();
    ctx.strokeRect.mockClear();
    setInspectorState(makeInspectorState({ canvasPosition: { x: 100, y: 200 } }));
    flushSync();
    expect(ctx.strokeRect).toHaveBeenCalledWith(100, 200, 1, 1);
  });
});
