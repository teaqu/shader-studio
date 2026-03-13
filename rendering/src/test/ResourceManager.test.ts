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
  TextureCache: vi.fn().mockImplementation(function() {
    return {
      getImageTextureCache: vi.fn().mockReturnValue({}),
      getDefaultTexture: vi.fn().mockReturnValue(null),
      removeCachedTexture: vi.fn().mockReturnValue(null),
      cacheTexture: vi.fn(),
      loadTextureFromUrl: vi.fn(),
      cleanup: vi.fn(),
    };
  }),
}));

vi.mock("../resources/VideoTextureManager", () => ({
  VideoTextureManager: vi.fn().mockImplementation(function() {
    return {
      loadVideoTexture: vi.fn(),
      getVideoTexture: vi.fn(),
      getVideoElement: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      syncAllToTime: vi.fn(),
      resumeVideo: vi.fn(),
      pauseVideo: vi.fn(),
      muteVideo: vi.fn(),
      unmuteVideo: vi.fn(),
      resetVideo: vi.fn(),
      setVideoVolume: vi.fn(),
      setAllVideoVolumes: vi.fn(),
      muteAllVideos: vi.fn(),
      unmuteAllVideos: vi.fn(),
      isVideoPaused: vi.fn(),
      isVideoMuted: vi.fn(),
      cleanup: vi.fn(),
    };
  }),
}));

vi.mock("../resources/CubemapTextureManager", () => ({
  CubemapTextureManager: vi.fn().mockImplementation(function() {
    return {
      getCubemapTexture: vi.fn().mockReturnValue(null),
      loadCubemapFromCrossImage: vi.fn(),
      cleanup: vi.fn(),
    };
  }),
}));

vi.mock("../resources/AudioTextureManager", () => ({
  AudioTextureManager: vi.fn().mockImplementation(function() {
    return {
      loadAudioSource: vi.fn(),
      resumeAudioContext: vi.fn(),
      updateLoopRegion: vi.fn(),
      getAudioTexture: vi.fn(),
      getAudioFFTData: vi.fn(),
      updateTextures: vi.fn(),
      getSampleRate: vi.fn(),
      resumeAudio: vi.fn(),
      pauseAudio: vi.fn(),
      muteAudio: vi.fn(),
      unmuteAudio: vi.fn(),
      resetAudio: vi.fn(),
      seekAudio: vi.fn(),
      getAudioDuration: vi.fn(),
      isAudioPaused: vi.fn(),
      isAudioMuted: vi.fn(),
      getAudioCurrentTime: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      syncAllToTime: vi.fn(),
      setAudioVolume: vi.fn(),
      setAllAudioVolumes: vi.fn(),
      muteAllAudio: vi.fn(),
      unmuteAllAudio: vi.fn(),
      cleanup: vi.fn(),
    };
  }),
}));

vi.mock("../resources/ShaderKeyboardInput", () => ({
  ShaderKeyboardInput: vi.fn().mockImplementation(function() {
    return {
      getKeyboardTexture: vi.fn().mockReturnValue(null),
      updateKeyboardTexture: vi.fn(),
      cleanup: vi.fn(),
    };
  }),
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
      const cubemapManager = (resourceManager as any).cubemapTextureManager;

      resourceManager.cleanup();

      expect(videoManager.cleanup).toHaveBeenCalled();
      expect(textureCache.cleanup).toHaveBeenCalled();
      expect(keyboardInput.cleanup).toHaveBeenCalled();
      expect(cubemapManager.cleanup).toHaveBeenCalled();
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

  describe("getCubemapTexture", () => {
    it("should return cubemap texture when available", () => {
      const mockTexture = createMockTexture();
      const cubemapManager = (resourceManager as any).cubemapTextureManager;
      cubemapManager.getCubemapTexture.mockReturnValue(mockTexture);

      const result = resourceManager.getCubemapTexture("cubemap.png");

      expect(result).toBe(mockTexture);
      expect(cubemapManager.getCubemapTexture).toHaveBeenCalledWith("cubemap.png");
    });

    it("should return null when cubemap texture not found", () => {
      const cubemapManager = (resourceManager as any).cubemapTextureManager;
      cubemapManager.getCubemapTexture.mockReturnValue(null);

      const result = resourceManager.getCubemapTexture("nonexistent.png");

      expect(result).toBeNull();
      expect(cubemapManager.getCubemapTexture).toHaveBeenCalledWith("nonexistent.png");
    });
  });

  describe("loadCubemapTexture", () => {
    it("should load cubemap texture successfully", async () => {
      const mockTexture = createMockTexture();
      const cubemapManager = (resourceManager as any).cubemapTextureManager;
      cubemapManager.loadCubemapFromCrossImage.mockResolvedValue(mockTexture);

      const result = await resourceManager.loadCubemapTexture("cubemap.png");

      expect(result).toBe(mockTexture);
      expect(cubemapManager.loadCubemapFromCrossImage).toHaveBeenCalledWith("cubemap.png", {});
    });

    it("should pass options to cubemapTextureManager", async () => {
      const mockTexture = createMockTexture();
      const cubemapManager = (resourceManager as any).cubemapTextureManager;
      cubemapManager.loadCubemapFromCrossImage.mockResolvedValue(mockTexture);

      await resourceManager.loadCubemapTexture("cubemap.png", {
        filter: "linear",
        wrap: "clamp",
        vflip: true,
      });

      expect(cubemapManager.loadCubemapFromCrossImage).toHaveBeenCalledWith("cubemap.png", {
        filter: "linear",
        wrap: "clamp",
        vflip: true,
      });
    });

    it("should return null on error", async () => {
      const cubemapManager = (resourceManager as any).cubemapTextureManager;
      cubemapManager.loadCubemapFromCrossImage.mockRejectedValue(new Error("Load failed"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await resourceManager.loadCubemapTexture("invalid.png");

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("video pause and resume", () => {
    it("should pause all videos through resource manager", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.pauseAllVideos();
      expect(videoManager.pauseAll).toHaveBeenCalled();
    });

    it("should resume all videos through resource manager", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.resumeAllVideos();
      expect(videoManager.resumeAll).toHaveBeenCalled();
    });
  });

  describe("getVideoElement", () => {
    it("should delegate to VideoTextureManager", () => {
      const mockVideo = { currentTime: 0 } as HTMLVideoElement;
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.getVideoElement.mockReturnValue(mockVideo);

      expect(resourceManager.getVideoElement("vid.mp4")).toBe(mockVideo);
      expect(videoManager.getVideoElement).toHaveBeenCalledWith("vid.mp4");
    });

    it("should return undefined when no video element", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.getVideoElement.mockReturnValue(undefined);

      expect(resourceManager.getVideoElement("vid.mp4")).toBeUndefined();
    });
  });

  describe("syncAllVideosToTime", () => {
    it("should delegate to VideoTextureManager", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.syncAllVideosToTime(5.0);
      expect(videoManager.syncAllToTime).toHaveBeenCalledWith(5.0);
    });
  });

  describe("controlVideo", () => {
    it("should call resumeVideo for play action", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.controlVideo("vid.mp4", "play");
      expect(videoManager.resumeVideo).toHaveBeenCalledWith("vid.mp4");
    });

    it("should call pauseVideo for pause action", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.controlVideo("vid.mp4", "pause");
      expect(videoManager.pauseVideo).toHaveBeenCalledWith("vid.mp4");
    });

    it("should call muteVideo for mute action", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.controlVideo("vid.mp4", "mute");
      expect(videoManager.muteVideo).toHaveBeenCalledWith("vid.mp4");
    });

    it("should call unmuteVideo for unmute action", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.controlVideo("vid.mp4", "unmute");
      expect(videoManager.unmuteVideo).toHaveBeenCalledWith("vid.mp4");
    });

    it("should call resetVideo for reset action", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.controlVideo("vid.mp4", "reset");
      expect(videoManager.resetVideo).toHaveBeenCalledWith("vid.mp4");
    });
  });

  describe("setVideoVolume", () => {
    it("should delegate to VideoTextureManager", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.setVideoVolume("vid.mp4", 0.5);
      expect(videoManager.setVideoVolume).toHaveBeenCalledWith("vid.mp4", 0.5);
    });
  });

  describe("setAllVideoVolumes", () => {
    it("should delegate to VideoTextureManager", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.setAllVideoVolumes(0.8);
      expect(videoManager.setAllVideoVolumes).toHaveBeenCalledWith(0.8);
    });
  });

  describe("muteAllVideos", () => {
    it("should delegate to VideoTextureManager", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.muteAllVideos();
      expect(videoManager.muteAllVideos).toHaveBeenCalled();
    });
  });

  describe("unmuteAllVideos", () => {
    it("should delegate to VideoTextureManager", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      resourceManager.unmuteAllVideos(0.7);
      expect(videoManager.unmuteAllVideos).toHaveBeenCalledWith(0.7);
    });
  });

  describe("getVideoState", () => {
    it("should return null when no video element exists", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.getVideoElement.mockReturnValue(undefined);

      expect(resourceManager.getVideoState("vid.mp4")).toBeNull();
    });

    it("should return video state when video element exists", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.getVideoElement.mockReturnValue({
        currentTime: 2.5,
        duration: 10,
      } as HTMLVideoElement);
      videoManager.isVideoPaused.mockReturnValue(false);
      videoManager.isVideoMuted.mockReturnValue(true);

      const state = resourceManager.getVideoState("vid.mp4");

      expect(state).toEqual({
        paused: false,
        muted: true,
        currentTime: 2.5,
        duration: 10,
      });
    });

    it("should default duration to 0 when falsy", () => {
      const videoManager = (resourceManager as any).videoTextureManager;
      videoManager.getVideoElement.mockReturnValue({
        currentTime: 0,
        duration: NaN,
      } as HTMLVideoElement);
      videoManager.isVideoPaused.mockReturnValue(true);
      videoManager.isVideoMuted.mockReturnValue(false);

      expect(resourceManager.getVideoState("vid.mp4")!.duration).toBe(0);
    });
  });

  // --- Audio methods ---

  describe("loadAudioSource", () => {
    it("should delegate to AudioTextureManager", async () => {
      const mockTexture = createMockTexture();
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.loadAudioSource.mockResolvedValue(mockTexture);

      const opts = { muted: true, volume: 0.5, startTime: 1, endTime: 5 };
      const result = await resourceManager.loadAudioSource("audio.mp3", opts);

      expect(result).toBe(mockTexture);
      expect(audioManager.loadAudioSource).toHaveBeenCalledWith("audio.mp3", opts);
    });
  });

  describe("resumeAudioContext", () => {
    it("should delegate to AudioTextureManager", async () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.resumeAudioContext.mockResolvedValue(undefined);

      await resourceManager.resumeAudioContext();

      expect(audioManager.resumeAudioContext).toHaveBeenCalled();
    });
  });

  describe("updateAudioLoopRegion", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.updateAudioLoopRegion("audio.mp3", 1.0, 5.0);
      expect(audioManager.updateLoopRegion).toHaveBeenCalledWith("audio.mp3", 1.0, 5.0);
    });

    it("should pass undefined for optional params", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.updateAudioLoopRegion("audio.mp3");
      expect(audioManager.updateLoopRegion).toHaveBeenCalledWith("audio.mp3", undefined, undefined);
    });
  });

  describe("getAudioTexture", () => {
    it("should return audio texture when available", () => {
      const mockTexture = createMockTexture();
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.getAudioTexture.mockReturnValue(mockTexture);

      expect(resourceManager.getAudioTexture("audio.mp3")).toBe(mockTexture);
      expect(audioManager.getAudioTexture).toHaveBeenCalledWith("audio.mp3");
    });

    it("should return null when no audio texture", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.getAudioTexture.mockReturnValue(null);

      expect(resourceManager.getAudioTexture("audio.mp3")).toBeNull();
    });
  });

  describe("getAudioFFTData", () => {
    it("should return FFT data when available", () => {
      const fftData = new Uint8Array(512);
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.getAudioFFTData.mockReturnValue(fftData);

      expect(resourceManager.getAudioFFTData("audio.mp3")).toBe(fftData);
      expect(audioManager.getAudioFFTData).toHaveBeenCalledWith("audio.mp3");
    });

    it("should return null when no FFT data", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.getAudioFFTData.mockReturnValue(null);

      expect(resourceManager.getAudioFFTData("audio.mp3")).toBeNull();
    });
  });

  describe("updateAudioTextures", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.updateAudioTextures();
      expect(audioManager.updateTextures).toHaveBeenCalled();
    });
  });

  describe("getAudioSampleRate", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.getSampleRate.mockReturnValue(44100);

      expect(resourceManager.getAudioSampleRate()).toBe(44100);
      expect(audioManager.getSampleRate).toHaveBeenCalled();
    });
  });

  describe("controlAudio", () => {
    it("should call resumeAudio for play action", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.controlAudio("audio.mp3", "play");
      expect(audioManager.resumeAudio).toHaveBeenCalledWith("audio.mp3");
    });

    it("should call pauseAudio for pause action", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.controlAudio("audio.mp3", "pause");
      expect(audioManager.pauseAudio).toHaveBeenCalledWith("audio.mp3");
    });

    it("should call muteAudio for mute action", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.controlAudio("audio.mp3", "mute");
      expect(audioManager.muteAudio).toHaveBeenCalledWith("audio.mp3");
    });

    it("should call unmuteAudio for unmute action", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.controlAudio("audio.mp3", "unmute");
      expect(audioManager.unmuteAudio).toHaveBeenCalledWith("audio.mp3");
    });

    it("should call resetAudio for reset action", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.controlAudio("audio.mp3", "reset");
      expect(audioManager.resetAudio).toHaveBeenCalledWith("audio.mp3");
    });
  });

  describe("seekAudio", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.seekAudio("audio.mp3", 3.5);
      expect(audioManager.seekAudio).toHaveBeenCalledWith("audio.mp3", 3.5);
    });
  });

  describe("getAudioState", () => {
    it("should return null when no audio is loaded (duration 0 and no texture)", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.getAudioDuration.mockReturnValue(0);
      audioManager.getAudioTexture.mockReturnValue(null);

      expect(resourceManager.getAudioState("audio.mp3")).toBeNull();
    });

    it("should return audio state when audio has duration", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.getAudioDuration.mockReturnValue(120);
      audioManager.isAudioPaused.mockReturnValue(false);
      audioManager.isAudioMuted.mockReturnValue(true);
      audioManager.getAudioCurrentTime.mockReturnValue(5.0);

      const state = resourceManager.getAudioState("audio.mp3");

      expect(state).toEqual({
        paused: false,
        muted: true,
        currentTime: 5.0,
        duration: 120,
      });
    });

    it("should return audio state when duration is 0 but texture exists", () => {
      const mockTexture = createMockTexture();
      const audioManager = (resourceManager as any).audioTextureManager;
      audioManager.getAudioDuration.mockReturnValue(0);
      audioManager.getAudioTexture.mockReturnValue(mockTexture);
      audioManager.isAudioPaused.mockReturnValue(true);
      audioManager.isAudioMuted.mockReturnValue(false);
      audioManager.getAudioCurrentTime.mockReturnValue(0);

      const state = resourceManager.getAudioState("audio.mp3");

      expect(state).toEqual({
        paused: true,
        muted: false,
        currentTime: 0,
        duration: 0,
      });
    });
  });

  describe("pauseAllAudio", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.pauseAllAudio();
      expect(audioManager.pauseAll).toHaveBeenCalled();
    });
  });

  describe("resumeAllAudio", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.resumeAllAudio();
      expect(audioManager.resumeAll).toHaveBeenCalled();
    });
  });

  describe("syncAllAudioToTime", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.syncAllAudioToTime(10.0);
      expect(audioManager.syncAllToTime).toHaveBeenCalledWith(10.0);
    });
  });

  describe("setAudioVolume", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.setAudioVolume("audio.mp3", 0.6);
      expect(audioManager.setAudioVolume).toHaveBeenCalledWith("audio.mp3", 0.6);
    });
  });

  describe("setAllAudioVolumes", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.setAllAudioVolumes(0.9);
      expect(audioManager.setAllAudioVolumes).toHaveBeenCalledWith(0.9);
    });
  });

  describe("muteAllAudio", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.muteAllAudio();
      expect(audioManager.muteAllAudio).toHaveBeenCalled();
    });
  });

  describe("unmuteAllAudio", () => {
    it("should delegate to AudioTextureManager", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.unmuteAllAudio(0.5);
      expect(audioManager.unmuteAllAudio).toHaveBeenCalledWith(0.5);
    });
  });

  describe("cleanup includes audio manager", () => {
    it("should cleanup AudioTextureManager along with other managers", () => {
      const audioManager = (resourceManager as any).audioTextureManager;
      resourceManager.cleanup();
      expect(audioManager.cleanup).toHaveBeenCalled();
    });
  });
});
