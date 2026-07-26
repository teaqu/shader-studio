import { expect } from "vitest";
import type { PixelRegionResult } from "../../types/PixelRegion";

export function pixelAt(rgba: Uint8ClampedArray, x: number, y: number): number[] {
  const offset = (y * 60 + x) * 4;
  return [...rgba.slice(offset, offset + 4)];
}

/** Backend-neutral inspector bytes: top-left, row-major RGBA. */
export function expectCanonicalRegion(result: PixelRegionResult): void {
  expect(result).toMatchObject({
    centerX: 100,
    centerY: 80,
    width: 60,
    height: 60,
  });
  expect(pixelAt(result.rgba, 30, 30)).toEqual([3, 240, 2, 255]);
  expect(pixelAt(result.rgba, 5, 7)).toEqual([17, 34, 51, 68]);
  expect(result.rgba).toHaveLength(60 * 60 * 4);
}
