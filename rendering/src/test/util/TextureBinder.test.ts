import { describe, it, expect, vi, beforeEach } from "vitest";
import { bindTextures } from "../../util/TextureBinder";
import type { PiTexture } from "../../types/piRenderer";

const TEXTURE_TYPE_2D = 0;
const TEXTURE_TYPE_3D = 1;
const TEXTURE_TYPE_CUBEMAP = 2;

const createMockGl = () => ({
  TEXTURE0: 33984,
  TEXTURE_2D: 3553,
  TEXTURE_3D: 32879,
  TEXTURE_CUBE_MAP: 34067,
  activeTexture: vi.fn(),
  bindTexture: vi.fn(),
}) as unknown as WebGL2RenderingContext;

const createMockTexture = (type: number = TEXTURE_TYPE_2D): PiTexture => ({
  mObjectID: { id: Math.random() },
  mXres: 256,
  mYres: 256,
  mType: type,
}) as unknown as PiTexture;

describe("bindTextures", () => {
  let gl: ReturnType<typeof createMockGl>;

  beforeEach(() => {
    gl = createMockGl();
  });

  it("should do nothing for empty array", () => {
    bindTextures(gl as any, []);
    expect(gl.activeTexture).not.toHaveBeenCalled();
    expect(gl.bindTexture).not.toHaveBeenCalled();
  });

  it("should bind a single T2D texture at unit 0", () => {
    const tex = createMockTexture(TEXTURE_TYPE_2D);
    bindTextures(gl as any, [tex]);

    expect(gl.activeTexture).toHaveBeenCalledWith(gl.TEXTURE0);
    expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_2D, tex.mObjectID);
  });

  it("should bind a T3D texture", () => {
    const tex = createMockTexture(TEXTURE_TYPE_3D);
    bindTextures(gl as any, [tex]);

    expect(gl.activeTexture).toHaveBeenCalledWith(gl.TEXTURE0);
    expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_3D, tex.mObjectID);
  });

  it("should bind a CUBEMAP texture", () => {
    const tex = createMockTexture(TEXTURE_TYPE_CUBEMAP);
    bindTextures(gl as any, [tex]);

    expect(gl.activeTexture).toHaveBeenCalledWith(gl.TEXTURE0);
    expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_CUBE_MAP, tex.mObjectID);
  });

  it("should activate texture unit but not bind for null textures", () => {
    bindTextures(gl as any, [null]);

    expect(gl.activeTexture).toHaveBeenCalledWith(gl.TEXTURE0);
    expect(gl.bindTexture).not.toHaveBeenCalled();
  });

  it("should bind multiple textures to sequential units", () => {
    const tex0 = createMockTexture(TEXTURE_TYPE_2D);
    const tex1 = createMockTexture(TEXTURE_TYPE_2D);
    const tex2 = createMockTexture(TEXTURE_TYPE_2D);

    bindTextures(gl as any, [tex0, tex1, tex2]);

    expect(gl.activeTexture).toHaveBeenCalledTimes(3);
    expect(gl.activeTexture).toHaveBeenNthCalledWith(1, gl.TEXTURE0);
    expect(gl.activeTexture).toHaveBeenNthCalledWith(2, gl.TEXTURE0 + 1);
    expect(gl.activeTexture).toHaveBeenNthCalledWith(3, gl.TEXTURE0 + 2);

    expect(gl.bindTexture).toHaveBeenCalledTimes(3);
    expect(gl.bindTexture).toHaveBeenNthCalledWith(1, gl.TEXTURE_2D, tex0.mObjectID);
    expect(gl.bindTexture).toHaveBeenNthCalledWith(2, gl.TEXTURE_2D, tex1.mObjectID);
    expect(gl.bindTexture).toHaveBeenNthCalledWith(3, gl.TEXTURE_2D, tex2.mObjectID);
  });

  it("should handle mixed null and non-null textures", () => {
    const tex0 = createMockTexture(TEXTURE_TYPE_2D);
    const tex2 = createMockTexture(TEXTURE_TYPE_2D);

    bindTextures(gl as any, [tex0, null, tex2]);

    expect(gl.activeTexture).toHaveBeenCalledTimes(3);
    expect(gl.bindTexture).toHaveBeenCalledTimes(2);
    expect(gl.bindTexture).toHaveBeenNthCalledWith(1, gl.TEXTURE_2D, tex0.mObjectID);
    expect(gl.bindTexture).toHaveBeenNthCalledWith(2, gl.TEXTURE_2D, tex2.mObjectID);
  });

  it("should handle mixed texture types", () => {
    const t2d = createMockTexture(TEXTURE_TYPE_2D);
    const t3d = createMockTexture(TEXTURE_TYPE_3D);
    const cube = createMockTexture(TEXTURE_TYPE_CUBEMAP);

    bindTextures(gl as any, [t2d, t3d, cube]);

    expect(gl.bindTexture).toHaveBeenNthCalledWith(1, gl.TEXTURE_2D, t2d.mObjectID);
    expect(gl.bindTexture).toHaveBeenNthCalledWith(2, gl.TEXTURE_3D, t3d.mObjectID);
    expect(gl.bindTexture).toHaveBeenNthCalledWith(3, gl.TEXTURE_CUBE_MAP, cube.mObjectID);
  });

  it("should handle 16 texture units", () => {
    const textures = Array.from({ length: 16 }, () => createMockTexture(TEXTURE_TYPE_2D));
    bindTextures(gl as any, textures);

    expect(gl.activeTexture).toHaveBeenCalledTimes(16);
    expect(gl.bindTexture).toHaveBeenCalledTimes(16);
    expect(gl.activeTexture).toHaveBeenLastCalledWith(gl.TEXTURE0 + 15);
  });
});
