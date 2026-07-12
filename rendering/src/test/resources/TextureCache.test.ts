import { describe, it, expect, beforeEach, vi } from "vitest";
import { TextureCache } from "../../resources/TextureCache";
import type { PiRenderer, PiTexture } from "../../types/piRenderer";

function mockPiRenderer() {
  const makeTex = (): PiTexture => ({ mObjectID: {} as WebGLTexture, mXres: 1, mYres: 1, mFormat: 0, mType: 0, mFilter: 0, mWrap: 0, mVFlip: false });
  return {
    TEXTYPE: { T2D: 0, T3D: 1, CUBEMAP: 2 },
    TEXFMT: { C4I8: 10, C1I8: 11 },
    FILTER: { NONE: 20, LINEAR: 21, MIPMAP: 22 },
    TEXWRP: { CLAMP: 30, REPEAT: 31 },
    CreateTexture: vi.fn(makeTex),
    CreateTextureFromImage: vi.fn(makeTex),
    UpdateTexture: vi.fn(),
    UpdateTextureFromImage: vi.fn(),
    CreateMipmaps: vi.fn(),
    DestroyTexture: vi.fn(),
  } as unknown as PiRenderer;
}

describe("TextureCache (characterization)", () => {
  let renderer: PiRenderer;
  let cache: TextureCache;

  beforeEach(() => {
    renderer = mockPiRenderer();
    cache = new TextureCache(renderer);
  });

  it("creates a 1x1 clamped nearest default texture on construction", () => {
    expect(renderer.CreateTexture).toHaveBeenCalledWith(
      renderer.TEXTYPE.T2D, 1, 1, renderer.TEXFMT.C4I8,
      renderer.FILTER.NONE, renderer.TEXWRP.CLAMP,
      new Uint8Array([0, 0, 0, 255]),
    );
    expect(cache.getDefaultTexture()).not.toBeNull();
  });

  it("cacheTexture/removeCachedTexture round-trips and clears the entry", () => {
    const tex = { mObjectID: {} } as PiTexture;
    cache.cacheTexture("/a.png", tex);
    expect(cache.getImageTextureCache()["/a.png"]).toBe(tex);
    expect(cache.removeCachedTexture("/a.png")).toBe(tex);
    expect(cache.getImageTextureCache()["/a.png"]).toBeUndefined();
  });

  it("removeCachedTexture returns undefined for unknown path", () => {
    expect(cache.removeCachedTexture("/nope.png")).toBeUndefined();
  });

  it("cleanup destroys cached textures but not the default texture", () => {
    const tex = { mObjectID: {} } as PiTexture;
    cache.cacheTexture("/a.png", tex);
    cache.cleanup();
    expect(renderer.DestroyTexture).toHaveBeenCalledWith(tex);
    expect(renderer.DestroyTexture).toHaveBeenCalledTimes(1);
    expect(cache.getImageTextureCache()).toEqual({});
    expect(cache.getDefaultTexture()).not.toBeNull();
  });

  describe("loadTextureFromUrl", () => {
    // jsdom Image never fires load; drive the handlers directly.
    let imgInstance: { onload: (() => void) | null; onerror: (() => void) | null; src: string; crossOrigin: string };
    beforeEach(() => {
      imgInstance = { onload: null, onerror: null, src: "", crossOrigin: "" };
      vi.stubGlobal("Image", vi.fn(function (this: unknown) { return imgInstance; }));
    });

    it("creates a texture with default options: C4I8, MIPMAP, REPEAT, vflip=true", async () => {
      const p = cache.loadTextureFromUrl("http://x/img.png");
      imgInstance.onload!();
      await p;
      expect(renderer.CreateTextureFromImage).toHaveBeenCalledWith(
        renderer.TEXTYPE.T2D, imgInstance, renderer.TEXFMT.C4I8,
        renderer.FILTER.MIPMAP, renderer.TEXWRP.REPEAT, true,
      );
    });

    it("maps linear/nearest filters, clamp wrap, vflip=false, grayscale to C1I8", async () => {
      const p = cache.loadTextureFromUrl("http://x/img.png", { filter: "linear", wrap: "clamp", vflip: false, grayscale: true });
      imgInstance.onload!();
      await p;
      expect(renderer.CreateTextureFromImage).toHaveBeenCalledWith(
        renderer.TEXTYPE.T2D, imgInstance, renderer.TEXFMT.C1I8,
        renderer.FILTER.LINEAR, renderer.TEXWRP.CLAMP, false,
      );
      const p2 = cache.loadTextureFromUrl("http://x/2.png", { filter: "nearest" });
      imgInstance.onload!();
      await p2;
      expect(renderer.CreateTextureFromImage).toHaveBeenLastCalledWith(
        renderer.TEXTYPE.T2D, imgInstance, renderer.TEXFMT.C4I8,
        renderer.FILTER.NONE, renderer.TEXWRP.REPEAT, true,
      );
    });

    it("rejects when the image fails to load", async () => {
      const p = cache.loadTextureFromUrl("http://x/broken.png");
      imgInstance.onerror!();
      await expect(p).rejects.toThrow(/Failed to load image/);
    });

    it("rejects when texture creation returns null", async () => {
      (renderer.CreateTextureFromImage as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const p = cache.loadTextureFromUrl("http://x/img.png");
      imgInstance.onload!();
      await expect(p).rejects.toThrow(/Failed to create texture/);
    });
  });
});
