export function piCreateGlContext(
  cv: HTMLCanvasElement,
  useAlpha: boolean,
  useDepth: boolean,
  usePreserveBuffer: boolean,
  useSupersampling: boolean,
  useXrCompatible?: boolean,
): WebGL2RenderingContext | WebGLRenderingContext | null;
