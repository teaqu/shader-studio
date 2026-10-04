import { describe, expect, it } from 'vitest';
import { isUsableCanvasSize, retainUsableCanvasSize } from '../lib/util/canvasSize';

describe('retainUsableCanvasSize', () => {
  it('keeps the last usable size while a panel is hidden', () => {
    const visible = retainUsableCanvasSize({ width: 0, height: 0 }, { width: 640.4, height: 360.4 });
    expect(visible).toEqual({ width: 640, height: 360 });
    expect(retainUsableCanvasSize(visible, { width: 0, height: 0 })).toEqual(visible);
  });

  it('rejects partially invalid and non-finite dimensions', () => {
    const current = { width: 640, height: 360 };
    expect(retainUsableCanvasSize(current, { width: 640, height: 0 })).toEqual(current);
    expect(retainUsableCanvasSize(current, { width: Number.NaN, height: 360 })).toEqual(current);
  });
});

describe('isUsableCanvasSize', () => {
  it.each([
    [{ width: 1, height: 1 }, true],
    [{ width: 0.5, height: 0.5 }, true],
    [{ width: 0, height: 360 }, false],
    [{ width: -640, height: 360 }, false],
    [{ width: 640, height: -1 }, false],
    [{ width: Number.POSITIVE_INFINITY, height: 360 }, false],
    [{ width: 640, height: Number.NaN }, false],
  ])('treats %j as usable: %s', (size, usable) => {
    expect(isUsableCanvasSize(size)).toBe(usable);
  });

  it('rounds a usable size to whole pixels in both directions', () => {
    expect(retainUsableCanvasSize({ width: 1, height: 1 }, { width: 640.5, height: 359.4 })).toEqual({ width: 641, height: 359 });
  });

  it('keeps an unusable current size when the next one is unusable too', () => {
    const current = { width: 0, height: 0 };

    expect(retainUsableCanvasSize(current, { width: -1, height: -1 })).toBe(current);
  });
});
