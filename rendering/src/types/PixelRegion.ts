/** The square pixel region captured for the pixel-inspector preview. */
export const PIXEL_INSPECTOR_REGION_SIZE = 60;

export interface PixelRegionRequest {
  requestId: number;
  /** Pixel coordinates in top-left logical canvas space. */
  centerX: number;
  /** Pixel coordinates in top-left logical canvas space. */
  centerY: number;
}

export interface PixelRegionResult extends PixelRegionRequest {
  width: number;
  height: number;
  /** A top-left-origin, row-major RGBA byte buffer. */
  rgba: Uint8ClampedArray;
}
