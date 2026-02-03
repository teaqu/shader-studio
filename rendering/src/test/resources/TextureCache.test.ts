import { describe, it, expect, beforeEach, vi } from "vitest";
import { TextureCache } from "../../resources/TextureCache";
import type { PiRenderer, PiTexture } from "../../types/piRenderer";

const createMockTexture = (format?: number): PiTexture => ({
  mObjectID: {},
  mXres: 640,
  mYres: 480,
  mFormat: format ?? 1,
  mType: 0,
  mFilter: 1,
  mWrap: 1,
  mVFlip: true,
});

const createMockRenderer = (): PiRenderer => {
  const C4I8 = 1;
  const C1I8 = 5;
  
  return {
    FILTER: { LINEAR: 1, NONE: 0, MIPMAP: 2 },
    TEXFMT: { C4I8, C1I8 },
    TEXTYPE: { T2D: 0 },
    TEXWRP: { CLAMP: 0, REPEAT: 1 },
    CreateTextureFromImage: vi.fn().mockImplementation((_type, _image, format) => {
      return createMockTexture(format);
    }),
    UpdateTextureFromImage: vi.fn(),
    DestroyTexture: vi.fn(),
    CreateTexture: vi.fn().mockReturnValue(createMockTexture()),
    CreateRenderTarget: vi.fn(),
    CreateShader: vi.fn(),
    DestroyRenderTarget: vi.fn(),
    DestroyShader: vi.fn(),
    SetRenderTarget: vi.fn(),
    SetViewport: vi.fn(),
    AttachShader: vi.fn(),
    SetShaderTextureUnit: vi.fn(),
    AttachTextures: vi.fn(),
    GetAttribLocation: vi.fn(() => 0),
    DrawUnitQuad_XY: vi.fn(),
    Flush: vi.fn(),
  } as unknown as PiRenderer;
};

describe("TextureCache", () => {
  let mockRenderer: PiRenderer;
  let textureCache: TextureCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderer = createMockRenderer();
    textureCache = new TextureCache(mockRenderer);
  });

  describe("constructor", () => {
    it("should initialize default texture on creation", () => {
      expect(mockRenderer.CreateTexture).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T2D,
        1,
        1,
        mockRenderer.TEXFMT.C4I8,
        mockRenderer.FILTER.NONE,
        mockRenderer.TEXWRP.CLAMP,
        expect.any(Uint8Array)
      );
    });

    it("should create black default texture", () => {
      const textureData = (mockRenderer.CreateTexture as any).mock.calls[0][6];
      expect(textureData).toEqual(new Uint8Array([0, 0, 0, 255]));
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
      
      const cachedTexture = textureCache.getCachedTexture("image.jpg");
      expect(cachedTexture).toBe(mockTexture);
    });

    it("should allow caching multiple textures", () => {
      const texture1 = createMockTexture();
      const texture2 = createMockTexture();
      
      textureCache.cacheTexture("image1.jpg", texture1);
      textureCache.cacheTexture("image2.jpg", texture2);
      
      expect(textureCache.getCachedTexture("image1.jpg")).toBe(texture1);
      expect(textureCache.getCachedTexture("image2.jpg")).toBe(texture2);
    });
  });

  describe("getCachedTexture", () => {
    it("should return undefined for non-existent texture", () => {
      const result = textureCache.getCachedTexture("nonexistent.jpg");
      expect(result).toBeUndefined();
    });
  });

  describe("removeCachedTexture", () => {
    it("should remove and return cached texture", () => {
      const mockTexture = createMockTexture();
      textureCache.cacheTexture("image.jpg", mockTexture);
      
      const removedTexture = textureCache.removeCachedTexture("image.jpg");
      
      expect(removedTexture).toBe(mockTexture);
      expect(textureCache.getCachedTexture("image.jpg")).toBeUndefined();
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
      
      expect(mockRenderer.DestroyTexture).toHaveBeenCalledWith(texture1);
      expect(mockRenderer.DestroyTexture).toHaveBeenCalledWith(texture2);
    });

    it("should destroy default texture", () => {
      const defaultTexture = textureCache.getDefaultTexture();
      
      textureCache.cleanup();
      
      expect(mockRenderer.DestroyTexture).toHaveBeenCalledWith(defaultTexture);
    });

    it("should clear cache after cleanup", () => {
      const mockTexture = createMockTexture();
      textureCache.cacheTexture("image.jpg", mockTexture);
      
      textureCache.cleanup();
      
      const cache = textureCache.getImageTextureCache();
      expect(cache).toEqual({});
    });

    it("should set default texture to null after cleanup", () => {
      textureCache.cleanup();
      
      expect(textureCache.getDefaultTexture()).toBeNull();
    });
  });

  describe("createTextureFromImage - grayscale option", () => {
    // Access private method through mock testing of loadTextureFromUrl
    // which internally calls createTextureFromImage
    
    it("should use C4I8 format when grayscale is false", async () => {
      // Create a mock image that will trigger onload
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { grayscale: false });
      
      // Trigger the onload callback
      mockImage.onload();
      
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T2D,
        mockImage,
        mockRenderer.TEXFMT.C4I8,
        expect.any(Number),
        expect.any(Number),
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });

    it("should use C1I8 format when grayscale is true", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { grayscale: true });
      
      mockImage.onload();
      
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T2D,
        mockImage,
        mockRenderer.TEXFMT.C1I8,
        expect.any(Number),
        expect.any(Number),
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });

    it("should use C4I8 format when grayscale is undefined", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      
      mockImage.onload();
      
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T2D,
        mockImage,
        mockRenderer.TEXFMT.C4I8,
        expect.any(Number),
        expect.any(Number),
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });

    it("should use C4I8 format when no options provided", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg");
      
      mockImage.onload();
      
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T2D,
        mockImage,
        mockRenderer.TEXFMT.C4I8,
        expect.any(Number),
        expect.any(Number),
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });
  });

  describe("loadTextureFromUrl - filter options", () => {
    it("should use LINEAR filter when filter is 'linear'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { filter: "linear" });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        mockRenderer.FILTER.LINEAR,
        expect.any(Number),
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });

    it("should use NONE filter when filter is 'nearest'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { filter: "nearest" });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        mockRenderer.FILTER.NONE,
        expect.any(Number),
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });

    it("should use MIPMAP filter when filter is 'mipmap'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { filter: "mipmap" });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        mockRenderer.FILTER.MIPMAP,
        expect.any(Number),
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });

    it("should default to MIPMAP filter when filter is not specified", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        mockRenderer.FILTER.MIPMAP,
        expect.any(Number),
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });
  });

  describe("loadTextureFromUrl - wrap options", () => {
    it("should use CLAMP wrap when wrap is 'clamp'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { wrap: "clamp" });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        expect.any(Number),
        mockRenderer.TEXWRP.CLAMP,
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });

    it("should use REPEAT wrap when wrap is 'repeat'", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { wrap: "repeat" });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        expect.any(Number),
        mockRenderer.TEXWRP.REPEAT,
        expect.any(Boolean)
      );
      
      (global as any).Image = originalImage;
    });

    it("should default to REPEAT wrap when wrap is not specified", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        expect.any(Number),
        mockRenderer.TEXWRP.REPEAT,
        expect.any(Boolean)
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
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { vflip: true });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        true
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
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", { vflip: false });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        false
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
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.any(Number),
        mockImage,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        true
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
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {
        filter: "nearest",
        wrap: "clamp",
        vflip: false,
        grayscale: true
      });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T2D,
        mockImage,
        mockRenderer.TEXFMT.C1I8,      // grayscale: true
        mockRenderer.FILTER.NONE,       // filter: nearest
        mockRenderer.TEXWRP.CLAMP,      // wrap: clamp
        false                            // vflip: false
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
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {
        filter: "linear",
        wrap: "repeat",
        vflip: true,
        grayscale: false
      });
      mockImage.onload();
      await loadPromise;
      
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T2D,
        mockImage,
        mockRenderer.TEXFMT.C4I8,      // grayscale: false
        mockRenderer.FILTER.LINEAR,     // filter: linear
        mockRenderer.TEXWRP.REPEAT,     // wrap: repeat
        true                            // vflip: true
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
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
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
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
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
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      
      const loadPromise = textureCache.loadTextureFromUrl("http://example.com/image.jpg", {});
      mockImage.onload();
      await loadPromise;
      
      expect(mockImage.src).toBe("http://example.com/image.jpg");
      
      (global as any).Image = originalImage;
    });

    it("should throw error when CreateTextureFromImage returns null", async () => {
      const originalImage = global.Image;
      const mockImage = {
        crossOrigin: "",
        onload: null as any,
        onerror: null as any,
        src: "",
      };
      
      (global as any).Image = vi.fn().mockImplementation(() => mockImage);
      (mockRenderer.CreateTextureFromImage as any).mockReturnValueOnce(null);
      
      const loadPromise = textureCache.loadTextureFromUrl("image.jpg", {});
      mockImage.onload();
      
      await expect(loadPromise).rejects.toThrow("Failed to create texture from image");
      
      (global as any).Image = originalImage;
    });
  });
});
