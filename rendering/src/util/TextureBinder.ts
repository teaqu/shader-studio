import type { PiTexture } from "../types/piRenderer";

const TEXTURE_TYPE_2D = 0;    // piRenderer.TEXTYPE.T2D
const TEXTURE_TYPE_3D = 1;    // piRenderer.TEXTYPE.T3D
const TEXTURE_TYPE_CUBEMAP = 2; // piRenderer.TEXTYPE.CUBEMAP

/**
 * Binds an array of textures to sequential GL texture units starting at unit 0.
 * This replaces piRenderer.AttachTextures which is limited to 4 slots.
 */
export function bindTextures(
  gl: WebGL2RenderingContext,
  textures: (PiTexture | null)[],
): void {
  for (let i = 0; i < textures.length; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    const tex = textures[i];
    if (tex) {
      if (tex.mType === TEXTURE_TYPE_2D) {
        gl.bindTexture(gl.TEXTURE_2D, tex.mObjectID);
      } else if (tex.mType === TEXTURE_TYPE_3D) {
        gl.bindTexture(gl.TEXTURE_3D, tex.mObjectID);
      } else if (tex.mType === TEXTURE_TYPE_CUBEMAP) {
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex.mObjectID);
      }
    }
  }
}
