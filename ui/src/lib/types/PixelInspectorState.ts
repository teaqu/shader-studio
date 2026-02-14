export interface PixelInspectorState {
  isEnabled: boolean;
  isActive: boolean;
  isLocked: boolean;
  mouseX: number;
  mouseY: number;
  pixelRGB: { r: number; g: number; b: number } | null;
  fragCoord: { x: number; y: number } | null;
}
