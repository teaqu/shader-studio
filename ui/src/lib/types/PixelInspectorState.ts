export interface PixelInspectorRegion {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface PixelInspectorState {
  isEnabled: boolean;
  isActive: boolean;
  isLocked: boolean;
  mouseX: number;
  mouseY: number;
  pixelRGB: { r: number; g: number; b: number } | null;
  fragCoord: { x: number; y: number } | null;
  canvasPosition: { x: number; y: number } | null;
  /** The complete byte-backed preview captured with the displayed sample. */
  region: PixelInspectorRegion | null;
}
