import type { PixelInspectorState } from '../types/PixelInspectorState';

const DEFAULT: PixelInspectorState = {
  isEnabled: false,
  isActive: false,
  isLocked: false,
  mouseX: 0,
  mouseY: 0,
  pixelRGB: null,
  fragCoord: null,
  canvasPosition: null,
  region: null,
};

// Regions are immutable readback snapshots. Keeping the enclosing state raw
// preserves a snapshot's object identity for the canvas raster cache.
let _state = $state.raw<PixelInspectorState>({ ...DEFAULT });
let _lockAtHandler: ((x: number, y: number) => void) | null = null;

export function getInspectorState(): PixelInspectorState {
  return _state;
}

export function setInspectorState(s: PixelInspectorState): void {
  _state = s;
}

export function registerLockAtHandler(fn: (x: number, y: number) => void): void {
  _lockAtHandler = fn;
}

export function requestLockAt(x: number, y: number): void {
  _lockAtHandler?.(x, y);
}
