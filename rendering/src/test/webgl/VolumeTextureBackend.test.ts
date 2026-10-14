import { describe, expect, it, vi } from "vitest";
import { WebGLTextureBackend } from "../../webgl/WebGLTextureBackend";
import type { PiRenderer } from "../../types/piRenderer";

function setup() {
  const names = ["MAX_3D_TEXTURE_SIZE", "TEXTURE_BINDING_3D", "UNPACK_ALIGNMENT", "UNPACK_FLIP_Y_WEBGL", "TEXTURE_3D", "RGBA8", "RGBA", "UNSIGNED_BYTE", "CLAMP_TO_EDGE", "REPEAT", "TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "TEXTURE_WRAP_R", "NEAREST", "LINEAR", "TEXTURE_MIN_FILTER", "TEXTURE_MAG_FILTER"];
  const constants = Object.fromEntries(names.map((name, i) => [name, i + 1]));
  const gl = Object.assign(constants, { NO_ERROR: 0, getParameter: vi.fn((key: number) => key === constants.MAX_3D_TEXTURE_SIZE ? 16 : key === constants.UNPACK_ALIGNMENT ? 4 : key === constants.UNPACK_FLIP_Y_WEBGL ? true : null), createTexture: vi.fn(() => ({})), bindTexture: vi.fn(), pixelStorei: vi.fn(), texImage3D: vi.fn(), texParameteri: vi.fn(), getError: vi.fn(() => 0), deleteTexture: vi.fn() });
  const renderer = { TEXTYPE: { T3D: 1 }, TEXFMT: { C4I8: 0 }, FILTER: { NONE: 0, LINEAR: 1 }, TEXWRP: { CLAMP: 0, REPEAT: 1 }, DestroyTexture: vi.fn() };
  return { gl, renderer, backend: new WebGLTextureBackend(renderer as unknown as PiRenderer, gl as unknown as WebGL2RenderingContext) };
}
const volume = { width: 1, height: 2, depth: 3, channels: 1 as const, data: new Uint8Array([10, 20, 30, 40, 50, 60]) };
describe("WebGL volume texture backend", () => {
  it("uploads non-cubic depth, preserving row and slice order, and restores unpack state", () => {
    const { backend, gl } = setup();
    expect(backend.createVolumeTexture(volume, "linear", "repeat")).toMatchObject({ mXres: 1, mYres: 2, mZres: 3, mType: 1 });
    expect(gl.texImage3D).toHaveBeenCalledWith(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 2, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, expect.any(Uint8Array));
    const bytes = gl.texImage3D.mock.calls[0][9] as Uint8Array;
    expect(Array.from(bytes).filter((_, i) => i % 4 === 0)).toEqual([10, 20, 30, 40, 50, 60]);
    for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_3D, axis, gl.REPEAT);
    }
    expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_ALIGNMENT, 4);
    expect(gl.pixelStorei).toHaveBeenLastCalledWith(gl.UNPACK_FLIP_Y_WEBGL, 1);
    expect(gl.bindTexture).toHaveBeenLastCalledWith(gl.TEXTURE_3D, null);
  });
  it("maps nearest/clamp and preserves RGBA voxels", () => {
    const { gl, backend } = setup();
    const data = new Uint8Array(24);
    backend.createVolumeTexture({ ...volume, channels: 4, data }, "nearest", "clamp");
    expect(gl.texImage3D.mock.calls[0][9]).toBe(data);
    expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  });
  it("rejects device limits before allocating and reports null allocation", () => {
    const { backend, gl } = setup();
    expect(() => backend.createVolumeTexture({ ...volume, depth: 17 }, "linear", "clamp")).toThrow("MAX_3D_TEXTURE_SIZE");
    expect(gl.createTexture).not.toHaveBeenCalled();
    gl.createTexture.mockReturnValueOnce(null as unknown as object);
    expect(backend.createVolumeTexture(volume, "linear", "clamp")).toBeNull();
  });
  it("deletes failed uploads and restores GL bindings", () => {
    const { backend, gl } = setup();
    gl.getError.mockReturnValueOnce(1285);
    expect(() => backend.createVolumeTexture(volume, "linear", "clamp")).toThrow("1285");
    expect(gl.deleteTexture).toHaveBeenCalledOnce();
    expect(gl.bindTexture).toHaveBeenLastCalledWith(gl.TEXTURE_3D, null);
  });
  it("requires a WebGL 2 context", () => {
    expect(() => new WebGLTextureBackend({} as PiRenderer).createVolumeTexture(volume, "linear", "clamp")).toThrow("WebGL 2");
  });
});
