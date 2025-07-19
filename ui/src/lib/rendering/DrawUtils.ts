import type { PiRenderer } from "../types/piRenderer";

/**
 * Low-level drawing utilities for WebGL rendering.
 * Contains primitive rendering operations like renderQuad, copyTexture, etc.
 */

/**
 * Renders a fullscreen quad with the given shader and uniforms.
 * This is a low-level primitive rendering operation.
 */
export function renderQuad(
  renderer: PiRenderer,
  glCanvas: HTMLCanvasElement | null,
  target: any,
  shader: any,
  uniforms: {
    res: number[];
    time: number;
    mouse: number[];
    frame: number;
  },
  textureBindings: any[],
): void {
  if (!shader) return;

  // Set viewport
  if (target) {
    renderer.SetViewport([0, 0, target.mTex0.mXres, target.mTex0.mYres]);
  } else if (glCanvas) {
    renderer.SetViewport([0, 0, glCanvas.width, glCanvas.height]);
  }

  // Set render target and shader
  renderer.SetRenderTarget(target);
  renderer.AttachShader(shader);

  // Set uniforms
  renderer.SetShaderConstant3FV("iResolution", uniforms.res);
  renderer.SetShaderConstant1F("iTime", uniforms.time);
  renderer.SetShaderConstant4FV("iMouse", uniforms.mouse);
  renderer.SetShaderConstant1I("iFrame", uniforms.frame);

  // Bind textures
  renderer.AttachTextures(
    4,
    textureBindings[0],
    textureBindings[1],
    textureBindings[2],
    textureBindings[3],
  );
  renderer.SetShaderTextureUnit("iChannel0", 0);
  renderer.SetShaderTextureUnit("iChannel1", 1);
  renderer.SetShaderTextureUnit("iChannel2", 2);
  renderer.SetShaderTextureUnit("iChannel3", 3);

  // Draw quad
  const posLoc = renderer.GetAttribLocation(shader, "position");
  renderer.DrawUnitQuad_XY(posLoc);
}

/**
 * Copies a texture to a render target with specific viewport dimensions.
 */
export function copyTexture(
  renderer: PiRenderer,
  sourceTexture: any,
  targetRenderTarget: any,
  copyShader: any,
  width: number,
  height: number
): void {
  if (!sourceTexture || !copyShader) return;

  renderer.SetRenderTarget(targetRenderTarget);
  renderer.SetViewport([0, 0, width, height]);
  renderer.AttachShader(copyShader);
  renderer.SetShaderTextureUnit("srcTex", 0);
  renderer.AttachTextures(1, sourceTexture, null, null, null);
  
  const posLoc = renderer.GetAttribLocation(copyShader, "position");
  renderer.DrawUnitQuad_XY(posLoc);
}

/**
 * Clears a render target by drawing a fullscreen quad with a copy shader (effectively clearing).
 */
export function clearRenderTarget(
  renderer: PiRenderer,
  renderTarget: any,
  copyShader: any,
  width: number,
  height: number
): void {
  if (!copyShader) return;

  renderer.SetRenderTarget(renderTarget);
  renderer.SetViewport([0, 0, width, height]);
  renderer.AttachShader(copyShader);
  
  const posLoc = renderer.GetAttribLocation(copyShader, "position");
  renderer.DrawUnitQuad_XY(posLoc);
}
