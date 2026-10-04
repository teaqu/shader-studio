export interface CanvasSize {
  width: number;
  height: number;
}

export function isUsableCanvasSize(size: CanvasSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height)
    && size.width > 0 && size.height > 0;
}

export function retainUsableCanvasSize(current: CanvasSize, next: CanvasSize): CanvasSize {
  if (!isUsableCanvasSize(next)) {
    return current;
  }
  return {
    width: Math.round(next.width),
    height: Math.round(next.height),
  };
}
