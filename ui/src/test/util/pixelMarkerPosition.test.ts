import { describe, it, expect } from 'vitest';
import { computeMarkerScreenPos } from '../../lib/util/pixelMarkerPosition';

type Rect = { left: number; top: number; width: number; height: number };

describe('computeMarkerScreenPos', () => {
  it('maps a render-pixel position to container CSS coords at 1:1 scale', () => {
    const glRect: Rect = { left: 0, top: 0, width: 200, height: 100 };
    const containerRect: Rect = { left: 0, top: 0, width: 200, height: 100 };
    const pos = computeMarkerScreenPos(glRect, containerRect, 200, 100, { x: 50, y: 25 });
    expect(pos).toEqual({ x: 50, y: 25, pixelSize: 1 });
  });

  it('accounts for aspect-ratio centering offset within the container', () => {
    // Canvas 200x100 centered in a 300x140 container -> offset (50, 20)
    const glRect: Rect = { left: 50, top: 20, width: 200, height: 100 };
    const containerRect: Rect = { left: 0, top: 0, width: 300, height: 140 };
    const pos = computeMarkerScreenPos(glRect, containerRect, 200, 100, { x: 10, y: 10 });
    expect(pos).toEqual({ x: 60, y: 30, pixelSize: 1 });
  });

  it('scales render coords up when the canvas is displayed larger (zoom)', () => {
    // Render resolution 100x50 shown at 400x200 -> scale 4x
    const glRect: Rect = { left: 0, top: 0, width: 400, height: 200 };
    const containerRect: Rect = { left: 0, top: 0, width: 400, height: 200 };
    const pos = computeMarkerScreenPos(glRect, containerRect, 100, 50, { x: 25, y: 10 });
    expect(pos).toEqual({ x: 100, y: 40, pixelSize: 4 });
  });

  it('handles fractional render coordinates', () => {
    const glRect: Rect = { left: 0, top: 0, width: 200, height: 100 };
    const containerRect: Rect = { left: 0, top: 0, width: 200, height: 100 };
    const pos = computeMarkerScreenPos(glRect, containerRect, 100, 50, { x: 10.5, y: 4.25 });
    expect(pos).toEqual({ x: 21, y: 8.5, pixelSize: 2 });
  });

  it('combines container offset and zoom scale together', () => {
    const glRect: Rect = { left: 30, top: 10, width: 400, height: 200 };
    const containerRect: Rect = { left: 0, top: 0, width: 460, height: 220 };
    const pos = computeMarkerScreenPos(glRect, containerRect, 100, 50, { x: 25, y: 10 });
    expect(pos).toEqual({ x: 130, y: 50, pixelSize: 4 });
  });

  it('returns null when the render resolution is degenerate', () => {
    const glRect: Rect = { left: 0, top: 0, width: 200, height: 100 };
    const containerRect: Rect = { left: 0, top: 0, width: 200, height: 100 };
    expect(computeMarkerScreenPos(glRect, containerRect, 0, 100, { x: 1, y: 1 })).toBeNull();
    expect(computeMarkerScreenPos(glRect, containerRect, 200, 0, { x: 1, y: 1 })).toBeNull();
  });

  it('returns null when the displayed canvas has zero size', () => {
    const glRect: Rect = { left: 0, top: 0, width: 0, height: 0 };
    const containerRect: Rect = { left: 0, top: 0, width: 200, height: 100 };
    expect(computeMarkerScreenPos(glRect, containerRect, 200, 100, { x: 1, y: 1 })).toBeNull();
  });
});
