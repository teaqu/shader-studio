export interface WebGLRenderLimits {
  maxWidth: number;
  maxHeight: number;
}

export interface RenderSize {
  width: number;
  height: number;
}

export function getWebGLRenderLimits(gl: WebGL2RenderingContext): WebGLRenderLimits {
  const maxTextureSize = readPositiveParameter(gl, gl.MAX_TEXTURE_SIZE);
  const maxRenderbufferSize = readPositiveParameter(gl, gl.MAX_RENDERBUFFER_SIZE);
  const maxViewport = readViewportDimensions(gl.getParameter(gl.MAX_VIEWPORT_DIMS));
  const unbounded = Number.MAX_SAFE_INTEGER;

  return {
    maxWidth: Math.min(
      maxTextureSize ?? unbounded,
      maxRenderbufferSize ?? unbounded,
      maxViewport?.width ?? unbounded,
    ),
    maxHeight: Math.min(
      maxTextureSize ?? unbounded,
      maxRenderbufferSize ?? unbounded,
      maxViewport?.height ?? unbounded,
    ),
  };
}

export function clampSizeToWebGLRenderLimits(
  width: number,
  height: number,
  limits: WebGLRenderLimits | null | undefined,
): RenderSize {
  const roundedWidth = clampPositiveDimension(width);
  const roundedHeight = clampPositiveDimension(height);

  if (!limits) {
    return { width: roundedWidth, height: roundedHeight };
  }

  return {
    width: Math.min(roundedWidth, limits.maxWidth),
    height: Math.min(roundedHeight, limits.maxHeight),
  };
}

function readPositiveParameter(gl: WebGL2RenderingContext, param: GLenum): number | undefined {
  const value = gl.getParameter(param) as unknown;
  return toPositiveInteger(value);
}

function readViewportDimensions(value: unknown): RenderSize | undefined {
  if (!isArrayLike(value) || value.length < 2) {
    return undefined;
  }

  const width = toPositiveInteger(value[0]);
  const height = toPositiveInteger(value[1]);
  if (width === undefined || height === undefined) {
    return undefined;
  }

  return { width, height };
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  if (typeof value !== "object" || value === null || !("length" in value)) {
    return false;
  }

  const length = (value as { length: unknown }).length;
  return typeof length === "number";
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

function clampPositiveDimension(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return 1;
  }
  return Math.max(1, rounded);
}
