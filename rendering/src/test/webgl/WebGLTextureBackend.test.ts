import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebGLTextureBackend } from "../../webgl/WebGLTextureBackend";
import type { PiRenderer, PiTexture } from "../../types/piRenderer";

function mockPiRenderer() {
  const makeTex = (): PiTexture => ({ mObjectID: {} as WebGLTexture, mXres: 4, mYres: 4, mFormat: 0, mType: 0, mFilter: 0, mWrap: 0, mVFlip: false });
  return {
    TEXTYPE: { T2D: 0, T3D: 1, CUBEMAP: 2 },
    TEXFMT: { C4I8: 10, C1I8: 11 },
    FILTER: { NONE: 20, LINEAR: 21, MIPMAP: 22 },
    TEXWRP: { CLAMP: 30, REPEAT: 31 },
    CreateTexture: vi.fn(makeTex),
    CreateTextureFromImage: vi.fn(makeTex),
    CreateMipmaps: vi.fn(),
    UpdateTexture: vi.fn(),
    UpdateTextureFromImage: vi.fn(),
    DestroyTexture: vi.fn(),
  } as unknown as PiRenderer;
}

describe("WebGLTextureBackend", () => {
  let renderer: PiRenderer;
  let backend: WebGLTextureBackend;

  beforeEach(() => {
    renderer = mockPiRenderer();
    backend = new WebGLTextureBackend(renderer);
  });

  it.each([
    ["2d", "rgba8", "linear", "repeat", 0, 10, 21, 31],
    ["2d", "r8", "nearest", "clamp", 0, 11, 20, 30],
    ["cubemap", "rgba8", "mipmap", "repeat", 2, 10, 22, 31],
  ] as const)("createTexture maps %s/%s/%s/%s to pi enums", (type, format, filter, wrap, piType, piFmt, piFilter, piWrap) => {
    const data = new Uint8Array([1, 2, 3, 4]);
    backend.createTexture({ type, width: 2, height: 2, format, filter, wrap, data });
    expect(renderer.CreateTexture).toHaveBeenCalledWith(piType, 2, 2, piFmt, piFilter, piWrap, data);
  });

  it("createTexture passes null when data omitted", () => {
    backend.createTexture({ type: "2d", width: 1, height: 1, format: "rgba8", filter: "linear", wrap: "clamp" });
    expect(renderer.CreateTexture).toHaveBeenCalledWith(0, 1, 1, 10, 21, 30, null);
  });

  it("createTextureFromImage maps options and forwards vflip", () => {
    const image = {} as HTMLImageElement;
    backend.createTextureFromImage(image, { type: "2d", format: "r8", filter: "mipmap", wrap: "clamp", vflip: false });
    expect(renderer.CreateTextureFromImage).toHaveBeenCalledWith(0, image, 11, 22, 30, false);
  });

  it("delegates createMipmaps, updateTexture, updateTextureFromImage, destroyTexture", () => {
    const tex = { mObjectID: {} } as PiTexture;
    const data = new Uint8Array(4);
    const video = {} as HTMLVideoElement;
    backend.createMipmaps(tex);
    backend.updateTexture(tex, 1, 2, 3, 4, data);
    backend.updateTextureFromImage(tex, video);
    backend.destroyTexture(tex);
    backend.destroyTexture(null);
    expect(renderer.CreateMipmaps).toHaveBeenCalledWith(tex);
    expect(renderer.UpdateTexture).toHaveBeenCalledWith(tex, 1, 2, 3, 4, data);
    expect(renderer.UpdateTextureFromImage).toHaveBeenCalledWith(tex, video);
    expect(renderer.DestroyTexture).toHaveBeenNthCalledWith(1, tex);
    expect(renderer.DestroyTexture).toHaveBeenNthCalledWith(2, null);
  });
});
