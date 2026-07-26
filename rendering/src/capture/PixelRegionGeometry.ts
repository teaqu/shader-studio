import { PIXEL_INSPECTOR_REGION_SIZE } from "../types/PixelRegion";

export interface PixelRegionGeometry {
  /** The requested region origin in top-left logical canvas space. */
  logicalX: number;
  logicalY: number;
  /** The in-bounds source rectangle in top-left logical canvas space. */
  sourceX: number;
  sourceY: number;
  copyWidth: number;
  copyHeight: number;
  /** The in-bounds rectangle destination in the fixed-size RGBA buffer. */
  destinationX: number;
  destinationY: number;
}

/**
 * Computes the clipped portion of a fixed-size pixel-inspector region.
 * The selected pixel is always stored at index (30, 30) in the result.
 *
 * @throws {RangeError} When any coordinate or canvas dimension is non-finite.
 */
export const getPixelRegionGeometry = (
  centerX: number,
  centerY: number,
  canvasWidth: number,
  canvasHeight: number,
): PixelRegionGeometry => {
  if (![centerX, centerY, canvasWidth, canvasHeight].every(Number.isFinite)) {
    throw new RangeError("Pixel region geometry requires finite coordinates and dimensions");
  }

  const logicalX = Math.floor(centerX) - PIXEL_INSPECTOR_REGION_SIZE / 2;
  const logicalY = Math.floor(centerY) - PIXEL_INSPECTOR_REGION_SIZE / 2;
  const safeCanvasWidth = Math.max(0, Math.floor(canvasWidth));
  const safeCanvasHeight = Math.max(0, Math.floor(canvasHeight));
  const clamp = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value));
  const sourceX = clamp(logicalX, safeCanvasWidth);
  const sourceY = clamp(logicalY, safeCanvasHeight);
  const sourceRight = clamp(logicalX + PIXEL_INSPECTOR_REGION_SIZE, safeCanvasWidth);
  const sourceBottom = clamp(logicalY + PIXEL_INSPECTOR_REGION_SIZE, safeCanvasHeight);
  const copyWidth = Math.max(0, sourceRight - sourceX);
  const copyHeight = Math.max(0, sourceBottom - sourceY);

  return {
    logicalX,
    logicalY,
    sourceX,
    sourceY,
    copyWidth,
    copyHeight,
    destinationX: clamp(sourceX - logicalX, PIXEL_INSPECTOR_REGION_SIZE),
    destinationY: clamp(sourceY - logicalY, PIXEL_INSPECTOR_REGION_SIZE),
  };
};
