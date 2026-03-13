import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VideoTextureManager } from "../../resources/VideoTextureManager";
import type { PiRenderer, PiTexture } from "../../types/piRenderer";

// Mock renderer implementation
const createMockRenderer = (): PiRenderer => {
  const mockTextures = new Map<any, any>();

  return {
    FILTER: { LINEAR: 1, NONE: 0, MIPMAP: 2 },
    TEXFMT: { C4I8: 1 },
    TEXTYPE: { T2D: 0 },
    TEXWRP: { CLAMP: 0, REPEAT: 1 },

    CreateTextureFromImage: vi.fn((type, image, format, filter, wrap, vflip) => {
      const texture = {
        mObjectID: {},
        mXres: (image as HTMLVideoElement).videoWidth || 640,
        mYres: (image as HTMLVideoElement).videoHeight || 480,
        mFormat: format,
        mType: type,
        mFilter: filter,
        mWrap: wrap,
        mVFlip: vflip
      };
      mockTextures.set(texture.mObjectID, texture);
      return texture;
    }),

    UpdateTextureFromImage: vi.fn((texture, image) => {
      // Simulate texture update
    }),

    DestroyTexture: vi.fn((texture) => {
      mockTextures.delete(texture.mObjectID);
    }),

    // Other required methods (not used in VideoTextureManager)
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

// Mock HTMLVideoElement
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
    style: {} as any,
    parentNode: null as any,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
  };
  return video;
};

describe("VideoTextureManager", () => {
  let mockRenderer: PiRenderer;
  let videoManager: VideoTextureManager;
  let originalCreateElement: typeof document.createElement;
  let mockVideo: ReturnType<typeof createMockVideoElement>;

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    videoManager = new VideoTextureManager(mockRenderer);
    mockVideo = createMockVideoElement();

    // Mock document.createElement for video elements
    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'video') {
        return mockVideo as unknown as HTMLVideoElement;
      }
      return originalCreateElement(tagName);
    });

    // Mock document.body.appendChild
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);

    // Mock requestAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return 1;
    });

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    videoManager.cleanup();
  });

  describe("loadVideoTexture", () => {
    it("should create video element with correct attributes", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      // Simulate video canplay event
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;

      expect(mockVideo.crossOrigin).toBe("");
      expect(mockVideo.loop).toBe(true);
      expect(mockVideo.muted).toBe(true);
      expect(mockVideo.playsInline).toBe(true);
      expect(mockVideo.preload).toBe("auto");
      expect(mockVideo.autoplay).toBe(true);
    });

    it("should return cached texture for same path", async () => {
      const loadPromise1 = videoManager.loadVideoTexture("test-video.mp4");

      // Simulate video canplay event
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      const texture1 = await loadPromise1;
      const texture2 = await videoManager.loadVideoTexture("test-video.mp4");

      expect(texture1).toBe(texture2);
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledTimes(1);
    });

    it("should reject when video fails to load", async () => {
      mockVideo.error = { message: "Network error" } as any;

      const loadPromise = videoManager.loadVideoTexture("invalid-video.mp4");

      // Simulate video error event
      const errorHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      
      if (errorHandler) {
        errorHandler();
      }

      await expect(loadPromise).rejects.toThrow("Failed to load video from URL: invalid-video.mp4");
    });

    it("should apply filter options correctly", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4", {
        filter: "linear"
      });

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;

      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        mockRenderer.FILTER.LINEAR,
        expect.anything(),
        expect.anything()
      );
    });

    it("should apply wrap options correctly", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4", {
        wrap: "clamp"
      });

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;

      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        mockRenderer.TEXWRP.CLAMP,
        expect.anything()
      );
    });

    it("should apply vflip option correctly", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4", {
        vflip: false
      });

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;

      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        false
      );
    });

    it("should default vflip to true", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;

      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        true
      );
    });
  });

  describe("getVideoTexture", () => {
    it("should return undefined for non-existent path", () => {
      const texture = videoManager.getVideoTexture("non-existent.mp4");
      expect(texture).toBeUndefined();
    });

    it("should return texture for loaded video", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      const loadedTexture = await loadPromise;
      const retrievedTexture = videoManager.getVideoTexture("test-video.mp4");

      expect(retrievedTexture).toBe(loadedTexture);
    });
  });

  describe("getVideoElement", () => {
    it("should return undefined for non-existent path", () => {
      const video = videoManager.getVideoElement("non-existent.mp4");
      expect(video).toBeUndefined();
    });

    it("should return video element for loaded video", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;
      const retrievedVideo = videoManager.getVideoElement("test-video.mp4");

      expect(retrievedVideo).toBe(mockVideo);
    });

    it("should handle removal of non-existent video gracefully", () => {
      expect(() => {
        videoManager.removeVideoTexture("non-existent.mp4");
      }).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should remove all video textures", async () => {
      // Load first video
      const loadPromise1 = videoManager.loadVideoTexture("video1.mp4");
      const canplayHandler1 = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      if (canplayHandler1) {
        canplayHandler1();
      }
      await loadPromise1;

      // Reset mock for second video
      const mockVideo2 = createMockVideoElement();
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'video') {
          return mockVideo2 as unknown as HTMLVideoElement;
        }
        return originalCreateElement(tagName);
      });

      // Load second video
      const loadPromise2 = videoManager.loadVideoTexture("video2.mp4");
      const canplayHandler2 = (mockVideo2.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      if (canplayHandler2) {
        canplayHandler2();
      }
      await loadPromise2;

      videoManager.cleanup();

      expect(mockVideo.pause).toHaveBeenCalled();
      expect(mockVideo2.pause).toHaveBeenCalled();
      expect(mockRenderer.DestroyTexture).toHaveBeenCalledTimes(2);
    });
  });

  describe("pause and resume functionality", () => {
    it("should pause all playing videos", () => {
      const mockRenderer = createMockRenderer();
      const videoManager = new VideoTextureManager(mockRenderer);
      
      // Set up videos with different pause states
      const playingVideo = createMockVideoElement({ paused: false });
      const pausedVideo = createMockVideoElement({ paused: true });
      
      (videoManager as any).videoElements['playing.mp4'] = playingVideo;
      (videoManager as any).videoElements['paused.mp4'] = pausedVideo;
      
      videoManager.pauseAll();
      
      expect(playingVideo.pause).toHaveBeenCalled();
      expect(pausedVideo.pause).not.toHaveBeenCalled();
    });

    it("should resume all paused videos", async () => {
      const mockRenderer = createMockRenderer();
      const videoManager = new VideoTextureManager(mockRenderer);
      
      // Set up paused videos
      const pausedVideo1 = createMockVideoElement({ paused: true });
      const pausedVideo2 = createMockVideoElement({ paused: true });
      const playingVideo = createMockVideoElement({ paused: false });
      
      (videoManager as any).videoElements['paused1.mp4'] = pausedVideo1;
      (videoManager as any).videoElements['paused2.mp4'] = pausedVideo2;
      (videoManager as any).videoElements['playing.mp4'] = playingVideo;
      
      videoManager.resumeAll();
      
      await vi.waitFor(() => {
        expect(pausedVideo1.play).toHaveBeenCalled();
        expect(pausedVideo2.play).toHaveBeenCalled();
        expect(playingVideo.play).not.toHaveBeenCalled();
      });
    });

    it("should handle resume failures gracefully", async () => {
      const mockRenderer = createMockRenderer();
      const videoManager = new VideoTextureManager(mockRenderer);
      
      // Set up a video that fails to play
      const failingVideo = createMockVideoElement({ paused: true });
      failingVideo.play.mockRejectedValue(new Error('Play failed'));
      
      (videoManager as any).videoElements['failing.mp4'] = failingVideo;
      
      // Should not throw
      expect(() => videoManager.resumeAll()).not.toThrow();
      
      await vi.waitFor(() => {
        expect(failingVideo.play).toHaveBeenCalled();
      });
    });
  });

  describe("filter options", () => {
    it("should use LINEAR filter by default", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;

      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        mockRenderer.FILTER.LINEAR,
        expect.anything(),
        expect.anything()
      );
    });

    it("should use NONE filter for nearest", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4", {
        filter: "nearest"
      });

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;

      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        mockRenderer.FILTER.NONE,
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe("syncAllToTime", () => {
    it("should sync video currentTime to shader time modulo duration", () => {
      const video1 = createMockVideoElement({ duration: 10 });
      video1.currentTime = 0;
      const video2 = createMockVideoElement({ duration: 20 });
      video2.currentTime = 0;

      (videoManager as any).videoElements['v1.mp4'] = video1;
      (videoManager as any).videoElements['v2.mp4'] = video2;

      videoManager.syncAllToTime(15);

      // 15 % 10 = 5
      expect(video1.currentTime).toBe(5);
      // 15 % 20 = 15
      expect(video2.currentTime).toBe(15);
    });

    it("should not seek when drift is within threshold", () => {
      const video = createMockVideoElement({ duration: 10 });
      video.currentTime = 5.02;

      (videoManager as any).videoElements['v.mp4'] = video;

      // shaderTime=5 -> target=5, drift=|5.02-5|=0.02 < 0.05
      videoManager.syncAllToTime(5);

      expect(video.currentTime).toBe(5.02); // unchanged
    });

    it("should seek when drift exceeds threshold", () => {
      const video = createMockVideoElement({ duration: 10 });
      video.currentTime = 5.1;

      (videoManager as any).videoElements['v.mp4'] = video;

      // shaderTime=5 -> target=5, drift=|5.1-5|=0.1 > 0.05
      videoManager.syncAllToTime(5);

      expect(video.currentTime).toBe(5);
    });

    it("should skip videos with no duration", () => {
      const video = createMockVideoElement({ duration: 0 });
      video.currentTime = 0;

      (videoManager as any).videoElements['v.mp4'] = video;

      videoManager.syncAllToTime(5);

      expect(video.currentTime).toBe(0); // unchanged
    });

    it("should skip videos with non-finite duration", () => {
      const video = createMockVideoElement({ duration: Infinity });
      video.currentTime = 0;

      (videoManager as any).videoElements['v.mp4'] = video;

      videoManager.syncAllToTime(5);

      expect(video.currentTime).toBe(0); // unchanged
    });

    it("should wrap shader time around video duration", () => {
      const video = createMockVideoElement({ duration: 8 });
      video.currentTime = 0;

      (videoManager as any).videoElements['v.mp4'] = video;

      // 25 % 8 = 1
      videoManager.syncAllToTime(25);

      expect(video.currentTime).toBe(1);
    });
  });

  describe("mute and volume", () => {
    it("should mute all videos", () => {
      const v1 = createMockVideoElement();
      const v2 = createMockVideoElement();
      (videoManager as any).videoElements['v1.mp4'] = v1;
      (videoManager as any).videoElements['v2.mp4'] = v2;

      videoManager.muteAllVideos();

      expect(v1.muted).toBe(true);
      expect(v1.volume).toBe(0);
      expect(v2.muted).toBe(true);
      expect(v2.volume).toBe(0);
    });

    it("should unmute all videos with given volume", () => {
      const v1 = createMockVideoElement();
      v1.muted = true;
      v1.volume = 0;
      const v2 = createMockVideoElement();
      v2.muted = true;
      v2.volume = 0;
      (videoManager as any).videoElements['v1.mp4'] = v1;
      (videoManager as any).videoElements['v2.mp4'] = v2;

      videoManager.unmuteAllVideos(0.7);

      expect(v1.muted).toBe(false);
      expect(v1.volume).toBe(0.7);
      expect(v2.muted).toBe(false);
      expect(v2.volume).toBe(0.7);
    });
  });

  describe("per-video controls", () => {
    it("should pause a specific video and track user pause", () => {
      const video = createMockVideoElement({ paused: false });
      (videoManager as any).videoElements['v.mp4'] = video;

      videoManager.pauseVideo('v.mp4');

      expect(video.pause).toHaveBeenCalled();
      expect((videoManager as any).userPaused.has('v.mp4')).toBe(true);
    });

    it("should resume a specific video and clear user pause", () => {
      const video = createMockVideoElement({ paused: true });
      (videoManager as any).videoElements['v.mp4'] = video;
      (videoManager as any).userPaused.add('v.mp4');

      videoManager.resumeVideo('v.mp4');

      expect(video.play).toHaveBeenCalled();
      expect((videoManager as any).userPaused.has('v.mp4')).toBe(false);
    });

    it("should not resume user-paused videos on resumeAll", () => {
      const userPausedVideo = createMockVideoElement({ paused: true });
      const normalPausedVideo = createMockVideoElement({ paused: true });
      (videoManager as any).videoElements['user.mp4'] = userPausedVideo;
      (videoManager as any).videoElements['normal.mp4'] = normalPausedVideo;
      (videoManager as any).userPaused.add('user.mp4');

      videoManager.resumeAll();

      expect(userPausedVideo.play).not.toHaveBeenCalled();
      expect(normalPausedVideo.play).toHaveBeenCalled();
    });

    it("should reset video currentTime to 0", () => {
      const video = createMockVideoElement();
      video.currentTime = 5;
      (videoManager as any).videoElements['v.mp4'] = video;

      videoManager.resetVideo('v.mp4');

      expect(video.currentTime).toBe(0);
    });
  });

  describe("duplicate event handler guard", () => {
    it("should only create one texture even if both canplay and loadeddata fire", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      // Get both handlers
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      const loadeddataHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'loadeddata'
      )?.[1];

      // Fire canplay first
      canplayHandler();

      // Fire loadeddata second — should be a no-op
      loadeddataHandler();

      await loadPromise;

      // Texture should only be created once, not twice
      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledTimes(1);
      // Only one rAF loop should start
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it("should remove event listeners after first successful canplay", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];

      canplayHandler();
      await loadPromise;

      // Should have called removeEventListener for both canplay and loadeddata
      const removeCalls = (mockVideo.removeEventListener as any).mock.calls;
      const removedEvents = removeCalls.map((call: any[]) => call[0]);
      expect(removedEvents).toContain('canplay');
      expect(removedEvents).toContain('loadeddata');
    });
  });

  describe("wrap options", () => {
    it("should use CLAMP wrap by default", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      
      if (canplayHandler) {
        canplayHandler();
      }

      await loadPromise;

      expect(mockRenderer.CreateTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        mockRenderer.TEXWRP.CLAMP,
        expect.anything()
      );
    });
  });
});
