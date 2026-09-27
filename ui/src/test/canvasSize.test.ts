import { describe, expect, it } from 'vitest';
import { retainUsableCanvasSize } from '../lib/util/canvasSize';

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
