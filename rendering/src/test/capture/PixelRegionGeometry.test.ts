import { describe, expect, it } from "vitest";
import { PIXEL_INSPECTOR_REGION_SIZE } from "../../types/PixelRegion";
import { getPixelRegionGeometry } from "../../capture/PixelRegionGeometry";

describe("getPixelRegionGeometry", () => {
  it("keeps the selected pixel at the fixed centre of a fully in-bounds region", () => {
    expect(getPixelRegionGeometry(50, 40, 100, 80)).toEqual({
      logicalX: 20,
      logicalY: 10,
      sourceX: 20,
      sourceY: 10,
      copyWidth: PIXEL_INSPECTOR_REGION_SIZE,
      copyHeight: PIXEL_INSPECTOR_REGION_SIZE,
      destinationX: 0,
      destinationY: 0,
    });
  });

  it("pads the top-left corner while retaining the selected pixel at index 30,30", () => {
    expect(getPixelRegionGeometry(0, 0, 100, 80)).toEqual({
      logicalX: -30,
      logicalY: -30,
      sourceX: 0,
      sourceY: 0,
      copyWidth: 30,
      copyHeight: 30,
      destinationX: 30,
      destinationY: 30,
    });
  });

  it("pads the top-right corner", () => {
    expect(getPixelRegionGeometry(99, 0, 100, 80)).toEqual({
      logicalX: 69,
      logicalY: -30,
      sourceX: 69,
      sourceY: 0,
      copyWidth: 31,
      copyHeight: 30,
      destinationX: 0,
      destinationY: 30,
    });
  });

  it("pads the bottom-left corner", () => {
    expect(getPixelRegionGeometry(0, 79, 100, 80)).toEqual({
      logicalX: -30,
      logicalY: 49,
      sourceX: 0,
      sourceY: 49,
      copyWidth: 30,
      copyHeight: 31,
      destinationX: 30,
      destinationY: 0,
    });
  });

  it("pads the bottom-right corner", () => {
    expect(getPixelRegionGeometry(99, 79, 100, 80)).toEqual({
      logicalX: 69,
      logicalY: 49,
      sourceX: 69,
      sourceY: 49,
      copyWidth: 31,
      copyHeight: 31,
      destinationX: 0,
      destinationY: 0,
    });
  });

  it("floors fractional centres before positioning the complete region", () => {
    expect(getPixelRegionGeometry(50.9, 40.1, 100, 80)).toEqual({
      logicalX: 20,
      logicalY: 10,
      sourceX: 20,
      sourceY: 10,
      copyWidth: 60,
      copyHeight: 60,
      destinationX: 0,
      destinationY: 0,
    });
  });

  it.each([
    ["left", -100, 40, {
      logicalX: -130, logicalY: 10, sourceX: 0, sourceY: 10,
      copyWidth: 0, copyHeight: 60, destinationX: 60, destinationY: 0,
    }],
    ["right", 200, 40, {
      logicalX: 170, logicalY: 10, sourceX: 100, sourceY: 10,
      copyWidth: 0, copyHeight: 60, destinationX: 0, destinationY: 0,
    }],
    ["top", 50, -100, {
      logicalX: 20, logicalY: -130, sourceX: 20, sourceY: 0,
      copyWidth: 60, copyHeight: 0, destinationX: 0, destinationY: 60,
    }],
    ["bottom", 50, 200, {
      logicalX: 20, logicalY: 170, sourceX: 20, sourceY: 80,
      copyWidth: 60, copyHeight: 0, destinationX: 0, destinationY: 0,
    }],
  ])("normalizes zero-sized copies wholly outside the canvas on the %s", (_side, centerX, centerY, expected) => {
    expect(getPixelRegionGeometry(centerX, centerY, 100, 80)).toEqual(expected);
  });

  it.each([
    [Number.NaN, 0, 100, 80],
    [0, Number.POSITIVE_INFINITY, 100, 80],
    [0, 0, Number.NEGATIVE_INFINITY, 80],
    [0, 0, 100, Number.NaN],
  ])("rejects non-finite geometry inputs", (centerX, centerY, canvasWidth, canvasHeight) => {
    expect(() => getPixelRegionGeometry(centerX, centerY, canvasWidth, canvasHeight)).toThrow(RangeError);
  });

  it("returns an empty copy for a zero-sized canvas", () => {
    expect(getPixelRegionGeometry(0, 0, 0, 0)).toEqual({
      logicalX: -30,
      logicalY: -30,
      sourceX: 0,
      sourceY: 0,
      copyWidth: 0,
      copyHeight: 0,
      destinationX: 30,
      destinationY: 30,
    });
  });
});
