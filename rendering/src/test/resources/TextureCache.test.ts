import { describe, it, expect, beforeEach, vi } from "vitest";
import { TextureCache } from "../../resources/TextureCache";
import type { TextureBackend } from "../../resources/TextureBackend";

interface FakeTex { id: number }

function mockBackend() {
  let next = 1;
  return {
    createTexture: vi.fn((): FakeTex => ({ id: next++ })),
    createTextureFromImage: vi.fn((): FakeTex => ({ id: next++ })),
    createMipmaps: vi.fn(),
    updateTexture: vi.fn(),
    updateTextureFromImage: vi.fn(),
    destroyTexture: vi.fn(),
  } satisfies TextureBackend<FakeTex>;
}

const createMockTexture = (): FakeTex => ({ id: Math.floor(Math.random() * 1_000_000) });

describe("TextureCache", () => {
  let backend: TextureBackend<FakeTex>;
  let textureCache: TextureCache<FakeTex>;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = mockBackend();
    textureCache = new TextureCache(backend);
  });

  describe("constructor", () => {
    it("should initialize default texture on creation", () => {
      expect(backend.createTexture).toHaveBeenCalledWith({
        type: "2d",
        width: 1,
        height: 1,
        format: "rgba8",
        filter: "nearest",
        wrap: "clamp",
        data: expect.any(Uint8Array),
      });
    });

    it("should create black default texture", () => {
      const call = (backend.createTexture as any).mock.calls[0][0];
      expect(call.data).toEqual(new Uint8Array([0, 0, 0, 255]));
    });
  });

  describe("getDefaultTexture", () => {
    it("should return the default texture", () => {
      const defaultTexture = textureCache.getDefaultTexture();
      expect(defaultTexture).not.toBeNull();
    });
  });

  describe("cacheTexture", () => {
    it("should cache texture by path", () => {
      const mockTexture = createMockTexture();
      textureCache.cacheTexture("image.jpg", mockTexture);

      const cache = textureCache.getImageTextureCache();
      expect(cache["image.jpg"]).toBe(mockTexture);
    });

    it("should allow caching multiple textures", () => {
      const texture1 = createMockTexture();
      const texture2 = createMockTexture();

      textureCache.cacheTexture("image1.jpg", texture1);
      textureCache.cacheTexture("image2.jpg", texture2);

      const cache = textureCache.getImageTextureCache();
      expect(cache["image1.jpg"]).toBe(texture1);
      expect(cache["image2.jpg"]).toBe(texture2);
    });
  });

  describe("removeCachedTexture", () => {
    it("should remove and return cached texture", () => {
      const mockTexture = createMockTexture();
      textureCache.cacheTexture("image.jpg", mockTexture);

      const removedTexture = textureCache.removeCachedTexture("image.jpg");

      expect(removedTexture).toBe(mockTexture);
      const cache = textureCache.getImageTextureCache();
      expect(cache["image.jpg"]).toBeUndefined();
    });

    it("should return undefined for non-existent texture", () => {
      const result = textureCache.removeCachedTexture("nonexistent.jpg");
      expect(result).toBeUndefined();
    });
  });

  describe("getImageTextureCache", () => {
    it("should return empty cache initially", () => {
      const cache = textureCache.getImageTextureCache();
      expect(cache).toEqual({});
    });

    it("should return cache with textures after caching", () => {
      const mockTexture = createMockTexture();
      textureCache.cacheTexture("image.jpg", mockTexture);

      const cache = textureCache.getImageTextureCache();
      expect(cache["image.jpg"]).toBe(mockTexture);
    });
  });

  describe("cleanup", () => {
    it("should destroy all cached textures", () => {
      const texture1 = createMockTexture();
      const texture2 = createMockTexture();

      textureCache.cacheTexture("image1.jpg", texture1);
      textureCache.cacheTexture("image2.jpg", texture2);

      textureCache.cleanup();

      expect(backend.destroyTexture).toHaveBeenCalledWith(texture1);
      expect(backend.destroyTexture).toHaveBeenCalledWith(texture2);
    });

    it("should preserve default texture during cleanup", () => {
      const defaultTexture = textureCache.getDefaultTexture();

      textureCache.cleanup();

      expect(textureCache.getDefaultTexture()).toBe(defaultTexture);
    });

    it("should not destroy the default texture when it is cached as a fallback image", () => {
      const defaultTexture = textureCache.getDefaultTexture();
      textureCache.cacheTexture("broken.jpg", defaultTexture!);

      textureCache.cleanup();

      expect(backend.destroyTexture).not.toHaveBeenCalledWith(defaultTexture);
      expect(textureCache.getImageTextureCache()).toEqual({});
    });

    it("should clear cache after cleanup", () => {
      const mockTexture = createMockTexture();
      textureCache.cacheTexture("image.jpg", mockTexture);

      textureCache.cleanup();

      const cache = textureCache.getImageTextureCache();
      expect(cache).toEqual({});
    });
  });

  describe("dispose", () => {
    it("destroys the persistent default texture exactly once", () => {
      const defaultTexture = textureCache.getDefaultTexture();

      (textureCache as TextureCache<FakeTex> & { dispose(): void }).dispose();
      (textureCache as TextureCache<FakeTex> & { dispose(): void }).dispose();

      expect(backend.destroyTexture).toHaveBeenCalledTimes(1);
      expect(backend.destroyTexture).toHaveBeenCalledWith(defaultTexture);
      expect(textureCache.getDefaultTexture()).toBeNull();
    });
  });

  describe("createTextureFromImage - grayscale option", () => {
    // Access private method through mock testing of loadTextureFromUrl
    // which internally calls createTextureFromImage

    it("should use rgba8 format when grayscale is false", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { grayscale: false });

      mockImage.onload();

      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ type: "2d", format: "rgba8" }),
      );

      (global as any).Image = originalImage;
    });

    it("should use r8 format when grayscale is true", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { grayscale: true });

      mockImage.onload();

      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ type: "2d", format: "r8" }),
      );

      (global as any).Image = originalImage;
    });

    it("should use rgba8 format when grayscale is undefined", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});

      mockImage.onload();

      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ type: "2d", format: "rgba8" }),
      );

      (global as any).Image = originalImage;
    });

    it("should use rgba8 format when no options provided", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg");

      mockImage.onload();

      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ type: "2d", format: "rgba8" }),
      );

      (global as any).Image = originalImage;
    });
  });

  describe("loadTextureFromUrl - filter options", () => {
    it("should use linear filter when filter is 'linear'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { filter: "linear" });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ filter: "linear" }),
      );

      (global as any).Image = originalImage;
    });

    it("should use nearest filter when filter is 'nearest'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { filter: "nearest" });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ filter: "nearest" }),
      );

      (global as any).Image = originalImage;
    });

    it("should use mipmap filter when filter is 'mipmap'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { filter: "mipmap" });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ filter: "mipmap" }),
      );

      (global as any).Image = originalImage;
    });

    it("should default to mipmap filter when filter is not specified", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ filter: "mipmap" }),
      );

      (global as any).Image = originalImage;
    });
  });

  describe("loadTextureFromUrl - wrap options", () => {
    it("should use clamp wrap when wrap is 'clamp'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { wrap: "clamp" });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ wrap: "clamp" }),
      );

      (global as any).Image = originalImage;
    });

    it("should use repeat wrap when wrap is 'repeat'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { wrap: "repeat" });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ wrap: "repeat" }),
      );

      (global as any).Image = originalImage;
    });

    it("should default to repeat wrap when wrap is not specified", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ wrap: "repeat" }),
      );

      (global as any).Image = originalImage;
    });
  });

  describe("loadTextureFromUrl - vflip option", () => {
    it("should use vflip true when specified", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { vflip: true });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ vflip: true }),
      );

      (global as any).Image = originalImage;
    });

    it("should use vflip false when specified", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { vflip: false });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ vflip: false }),
      );

      (global as any).Image = originalImage;
    });

    it("should default to vflip true when not specified", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        expect.objectContaining({ vflip: true }),
      );

      (global as any).Image = originalImage;
    });
  });

  describe("loadTextureFromUrl - combined options", () => {
    it("should apply all options together", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {
        filter: "nearest",
        wrap: "clamp",
        vflip: false,
        grayscale: true
      });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        {
          type: "2d",
          format: "r8",       // grayscale: true
          filter: "nearest",  // filter: nearest
          wrap: "clamp",      // wrap: clamp
          vflip: false,       // vflip: false
        },
      );

      (global as any).Image = originalImage;
    });

    it("should apply all RGBA options together", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {
        filter: "linear",
        wrap: "repeat",
        vflip: true,
        grayscale: false
      });
      mockImage.onload();
      await loadPromise;

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        mockImage,
        {
          type: "2d",
          format: "rgba8",  // grayscale: false
          filter: "linear", // filter: linear
          wrap: "repeat",   // wrap: repeat
          vflip: true,      // vflip: true
        },
      );

      (global as any).Image = originalImage;
    });
  });

  describe("loadTextureFromUrl - error handling", () => {
    it("should reject on image load error", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("invalid.jpg", {});

      // Trigger the onerror callback
      mockImage.onerror();

      await expect(loadPromise).rejects.toThrow("Failed to load image from URL: invalid.jpg");

      (global as any).Image = originalImage;
    });

    it("should set crossOrigin on image", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();
      await loadPromise;

      expect(mockImage.crossOrigin).toBe("");

      (global as any).Image = originalImage;
    });

    it("should set src on image", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });

      const loadPromise = textureCache.loadTextureFromUrl("http://example.com/image.jpg", {});
      mockImage.onload();
      await loadPromise;

      expect(mockImage.src).toBe("http://example.com/image.jpg");

      (global as any).Image = originalImage;
    });

    it("should throw error when createTextureFromImage returns null", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };

      (global as any).Image = vi.fn().mockImplementation(function() {
        return mockImage; 
      });
      (backend.createTextureFromImage as any).mockReturnValueOnce(null);

      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();

      await expect(loadPromise).rejects.toThrow("Failed to create texture from image");

      (global as any).Image = originalImage;
    });
  });
});
