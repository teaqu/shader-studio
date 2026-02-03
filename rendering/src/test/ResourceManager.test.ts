import { describe, it, expect, beforeEach, vi } from "vitest";
import { ResourceManager } from "../ResourceManager";
import type { PiRenderer, PiTexture } from "../types/piRenderer";

// Mock video element helper
const createMockVideoElement = (options: {
  videoWidth?: number;
  videoHeight?: number;
  readyState?: number;
  paused?: boolean;
  duration?: number;
} = {}) => {
  const video = {
    videoWidth: options.videoWidth ?? 640,
    videoHeight: options.videoHeight ?? 480,
    readyState: options.readyState ?? 4,
    paused: options.paused ?? false,
    duration: options.duration ?? 10,
    currentTime: 0,
    crossOrigin: "",
    loop: false,
    muted: false,
    playsInline: false,
    preload: "",
    autoplay: false,
    volume: 1,
    src: "",
    HAVE_CURRENT_DATA: 2,
    error: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
  };
  return video;
};

// Mock the dependencies
vi.mock("../resources/TextureCache", () => ({
  TextureCache: vi.fn().mockImplementation(() => ({
    getImageTextureCache: vi.fn().mockReturnValue({}),
    getDefaultTexture: vi.fn().mockReturnValue(null),
    removeCachedTexture: vi.fn().mockReturnValue(null),
    cacheTexture: vi.fn(),
    loadTextureFromUrl: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

vi.mock("../resources/VideoTextureManager", () => ({
  VideoTextureManager: vi.fn().mockImplementation(() => ({
    loadVideoTexture: vi.fn(),
    getVideoTexture: vi.fn(),
    pauseAll: vi.fn(),
    resumeAll: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

vi.mock("../resources/ShaderKeyboardInput", () => ({
  ShaderKeyboardInput: vi.fn().mockImplementation(() => ({
    getKeyboardTexture: vi.fn().mockReturnValue(null),
    updateKeyboardTexture: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

const createMockRenderer = (): PiRenderer => {
  return {
    FILTER: { LINEAR: 1, NONE: 0, MIPMAP: 2 },
    TEXFMT: { C4I8: 1 },
    TEXTYPE: { T2D: 0 },
    TEXWRP: { CLAMP: 0, REPEAT: 1 },
    CreateTextureFromImage: vi.fn(),
    UpdateTextureFromImage: vi.fn(),
    DestroyTexture: vi.fn(),
    CreateTexture: vi.fn(),
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

const createMockTexture = (): PiTexture => ({
  mObjectID: {},
  mXres: 640,
  mYres: 480,
  mFormat: 1,
  mType: 0,
  mFilter: 1,
  mWrap: 1,
  mVFlip: true,
});

describe("ResourceManager", () => {
  let mockRenderer: PiRenderer;
  let resourceManager: ResourceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderer = createMockRenderer();
    resourceManager = new ResourceManager(mockRenderer);
  });

  describe("loadImageTexture", () => {
    it("should load image texture successfully", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      const result = await resourceManager.loadImageTexture("image.jpg");

      expect(result).toBe(mockTexture);
      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", {});
      expect(textureCache.cacheTexture).toHaveBeenCalledWith("image.jpg", mockTexture);
    });

    it("should return cached texture if available", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.removeCachedTexture.mockReturnValue(mockTexture);

      const result = await resourceManager.loadImageTexture("image.jpg");

      expect(result).toBe(mockTexture);
      expect(textureCache.loadTextureFromUrl).not.toHaveBeenCalled();
      expect(textureCache.cacheTexture).toHaveBeenCalledWith("image.jpg", mockTexture);
    });

    it("should pass filter options to texture cache", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      await resourceManager.loadImageTexture("image.jpg", { filter: "linear" });

      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", { filter: "linear" });
    });

    it("should pass wrap options to texture cache", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      await resourceManager.loadImageTexture("image.jpg", { wrap: "clamp" });

      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", { wrap: "clamp" });
    });

    it("should pass vflip options to texture cache", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      await resourceManager.loadImageTexture("image.jpg", { vflip: false });

      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", { vflip: false });
    });

    it("should pass all options to texture cache", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      await resourceManager.loadImageTexture("image.jpg", {
        filter: "nearest",
        wrap: "repeat",
        vflip: true,
      });

      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", {
        filter: "nearest",
        wrap: "repeat",
        vflip: true,
      });
    });

    it("should pass grayscale option to texture cache", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      await resourceManager.loadImageTexture("image.jpg", { grayscale: true });

      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", { grayscale: true });
    });

    it("should pass grayscale: false option to texture cache", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      await resourceManager.loadImageTexture("image.jpg", { grayscale: false });

      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", { grayscale: false });
    });

    it("should pass all options including grayscale to texture cache", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      await resourceManager.loadImageTexture("image.jpg", {
        filter: "nearest",
        wrap: "repeat",
        vflip: true,
        grayscale: true,
      });

      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", {
        filter: "nearest",
        wrap: "repeat",
        vflip: true,
        grayscale: true,
      });
    });

    it("should not include grayscale when not specified", async () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.loadTextureFromUrl.mockResolvedValue(mockTexture);

      await resourceManager.loadImageTexture("image.jpg", { filter: "linear" });

      expect(textureCache.loadTextureFromUrl).toHaveBeenCalledWith("image.jpg", { filter: "linear" });
      // Verify grayscale is not in the call
      const callArgs = textureCache.loadTextureFromUrl.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty("grayscale");
    });

    it("should return default texture on error when available", async () => {
      const mockDefaultTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      
      textureCache.loadTextureFromUrl.mockRejectedValue(new Error("Image load failed"));
      textureCache.getDefaultTexture.mockReturnValue(mockDefaultTexture);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await resourceManager.loadImageTexture("invalid.jpg");

      expect(result).toBe(mockDefaultTexture);
      expect(consoleSpy).toHaveBeenCalled();
      expect(textureCache.cacheTexture).toHaveBeenCalledWith("invalid.jpg", mockDefaultTexture);

      consoleSpy.mockRestore();
    });

    it("should return null on error when no default texture available", async () => {
      const textureCache = (resourceManager as any).textureCache;
      
      textureCache.loadTextureFromUrl.mockRejectedValue(new Error("Image load failed"));
      textureCache.getDefaultTexture.mockReturnValue(null);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await resourceManager.loadImageTexture("invalid.jpg");

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("loadVideoTexture", () => {
    it("should load video texture successfully", async () => {
      const mockTexture = createMockTexture();
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.loadVideoTexture.mockResolvedValue(mockTexture);

      const result = await resourceManager.loadVideoTexture("video.mp4");

      expect(result.texture).toBe(mockTexture);
      expect(result.warning).toBeUndefined();
      expect(videoManager.loadVideoTexture).toHaveBeenCalledWith("video.mp4", {});
    });

    it("should pass filter options to video texture manager", async () => {
      const mockTexture = createMockTexture();
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.loadVideoTexture.mockResolvedValue(mockTexture);

      await resourceManager.loadVideoTexture("video.mp4", { filter: "linear" });

      expect(videoManager.loadVideoTexture).toHaveBeenCalledWith("video.mp4", { filter: "linear" });
    });

    it("should pass wrap options to video texture manager", async () => {
      const mockTexture = createMockTexture();
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.loadVideoTexture.mockResolvedValue(mockTexture);

      await resourceManager.loadVideoTexture("video.mp4", { wrap: "clamp" });

      expect(videoManager.loadVideoTexture).toHaveBeenCalledWith("video.mp4", { wrap: "clamp" });
    });

    it("should pass vflip options to video texture manager", async () => {
      const mockTexture = createMockTexture();
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.loadVideoTexture.mockResolvedValue(mockTexture);

      await resourceManager.loadVideoTexture("video.mp4", { vflip: false });

      expect(videoManager.loadVideoTexture).toHaveBeenCalledWith("video.mp4", { vflip: false });
    });

    it("should pass all options to video texture manager", async () => {
      const mockTexture = createMockTexture();
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.loadVideoTexture.mockResolvedValue(mockTexture);

      await resourceManager.loadVideoTexture("video.mp4", {
        filter: "nearest",
        wrap: "repeat",
        vflip: true,
      });

      expect(videoManager.loadVideoTexture).toHaveBeenCalledWith("video.mp4", {
        filter: "nearest",
        wrap: "repeat",
        vflip: true,
      });
    });

    it("should return default texture and warning on error when available", async () => {
      const mockDefaultTexture = createMockTexture();
      const videoManager = (resourceManager as any).videoTextureManager;
      const textureCache = (resourceManager as any).textureCache;
      
      videoManager.loadVideoTexture.mockRejectedValue(new Error("Video load failed"));
      textureCache.getDefaultTexture.mockReturnValue(mockDefaultTexture);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await resourceManager.loadVideoTexture("invalid.mp4");

      expect(result.texture).toBe(mockDefaultTexture);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("Video is not loading");
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("should return null texture and warning on error when no default texture available", async () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      const textureCache = (resourceManager as any).textureCache;
      
      videoManager.loadVideoTexture.mockRejectedValue(new Error("Video load failed"));
      textureCache.getDefaultTexture.mockReturnValue(null);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await resourceManager.loadVideoTexture("invalid.mp4");

      expect(result.texture).toBeNull();
      expect(result.warning).toBeDefined();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should include path in warning message on failure", async () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.loadVideoTexture.mockRejectedValue(new Error("Network error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await resourceManager.loadVideoTexture("video.mp4");

      expect(result.warning).toContain("video.mp4");

      consoleSpy.mockRestore();
    });
  });

  describe("getVideoTexture", () => {
    it("should return video texture when available", () => {
      const mockTexture = createMockTexture();
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.getVideoTexture.mockReturnValue(mockTexture);

      const result = resourceManager.getVideoTexture("video.mp4");

      expect(result).toBe(mockTexture);
      expect(videoManager.getVideoTexture).toHaveBeenCalledWith("video.mp4");
    });

    it("should return null when video texture not found", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.getVideoTexture.mockReturnValue(undefined);

      const result = resourceManager.getVideoTexture("nonexistent.mp4");

      expect(result).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("should cleanup video texture manager", () => {
      const videoManager = (resourceManager as any).videoTextureManager;

      resourceManager.cleanup();

      expect(videoManager.cleanup).toHaveBeenCalled();
    });

    it("should cleanup all resource managers", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      const textureCache = (resourceManager as any).textureCache;
      const keyboardInput = (resourceManager as any).keyboardInput;

      resourceManager.cleanup();

      expect(videoManager.cleanup).toHaveBeenCalled();
      expect(textureCache.cleanup).toHaveBeenCalled();
      expect(keyboardInput.cleanup).toHaveBeenCalled();
    });
  });

  describe("getImageTextureCache", () => {
    it("should return image texture cache", () => {
      const mockCache = { "image.jpg": createMockTexture() };
      const textureCache = (resourceManager as any).textureCache;
      textureCache.getImageTextureCache.mockReturnValue(mockCache);

      const result = resourceManager.getImageTextureCache();

      expect(result).toBe(mockCache);
      expect(textureCache.getImageTextureCache).toHaveBeenCalled();
    });
  });

  describe("getKeyboardTexture", () => {
    it("should return keyboard texture when available", () => {
      const mockTexture = createMockTexture();
      const keyboardInput = (resourceManager as any).keyboardInput;
      keyboardInput.getKeyboardTexture.mockReturnValue(mockTexture);

      const result = resourceManager.getKeyboardTexture();

      expect(result).toBe(mockTexture);
      expect(keyboardInput.getKeyboardTexture).toHaveBeenCalled();
    });

    it("should return null when keyboard texture not available", () => {
      const keyboardInput = (resourceManager as any).keyboardInput;
      keyboardInput.getKeyboardTexture.mockReturnValue(null);

      const result = resourceManager.getKeyboardTexture();

      expect(result).toBeNull();
    });
  });

  describe("getDefaultTexture", () => {
    it("should return default texture when available", () => {
      const mockTexture = createMockTexture();
      const textureCache = (resourceManager as any).textureCache;
      textureCache.getDefaultTexture.mockReturnValue(mockTexture);

      const result = resourceManager.getDefaultTexture();

      expect(result).toBe(mockTexture);
      expect(textureCache.getDefaultTexture).toHaveBeenCalled();
    });

    it("should return null when default texture not available", () => {
      const textureCache = (resourceManager as any).textureCache;
      textureCache.getDefaultTexture.mockReturnValue(null);

      const result = resourceManager.getDefaultTexture();

      expect(result).toBeNull();
    });
  });

  describe("updateKeyboardTexture", () => {
    it("should update keyboard texture with key states", () => {
      const keyHeld = new Uint8Array(256);
      const keyPressed = new Uint8Array(256);
      const keyToggled = new Uint8Array(256);
      const keyboardInput = (resourceManager as any).keyboardInput;

      resourceManager.updateKeyboardTexture(keyHeld, keyPressed, keyToggled);

      expect(keyboardInput.updateKeyboardTexture).toHaveBeenCalledWith(
        keyHeld,
        keyPressed,
        keyToggled
      );
    });
  });

  describe("video pause and resume", () => {
    it("should pause all videos through resource manager", () => {
      const mockRenderer = createMockRenderer();
      const resourceManager = new ResourceManager(mockRenderer);
      
      // Access private videoTextureManager through type assertion and initialize videoElements
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.videoElements = {};
      
      resourceManager.pauseAllVideos();
      
      expect(videoManager.pauseAll).toHaveBeenCalled();
    });

    it("should resume all videos through resource manager", () => {
      const mockRenderer = createMockRenderer();
      const resourceManager = new ResourceManager(mockRenderer);
      
      // Access private videoTextureManager through type assertion and initialize videoElements
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.videoElements = {};
      
      resourceManager.resumeAllVideos();
      
      expect(videoManager.resumeAll).toHaveBeenCalled();
    });
  });
});
