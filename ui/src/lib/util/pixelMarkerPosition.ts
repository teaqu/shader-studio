/** A minimal rectangle shape, compatible with DOMRect. */
export interface MarkerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MarkerScreenPos {
  /** X in container CSS pixels. */
  x: number;
  /** Y in container CSS pixels. */
  y: number;
  /** On-screen size of a single render pixel (CSS pixels). */
  pixelSize: number;
}

/**
 * Map a pixel position in render coordinates (0..glW, 0..glH, top-left origin)
 * to coordinates within the canvas container, accounting for aspect-ratio
 * centering (the canvas may be offset inside the container) and zoom (the
 * canvas may be displayed larger or smaller than its render resolution).
 *
 * Returns null when any dimension is degenerate.
 */
export function computeMarkerScreenPos(
  glRect: MarkerRect,
  containerRect: MarkerRect,
  glW: number,
  glH: number,
  canvasPosition: { x: number; y: number },
): MarkerScreenPos | null {
  if (glW <= 0 || glH <= 0 || glRect.width <= 0 || glRect.height <= 0) {
    return null;
  }

  const scaleX = glRect.width / glW;
  const scaleY = glRect.height / glH;
  const offsetX = glRect.left - containerRect.left;
  const offsetY = glRect.top - containerRect.top;

  return {
    x: offsetX + canvasPosition.x * scaleX,
    y: offsetY + canvasPosition.y * scaleY,
    pixelSize: scaleX,
  };
}
