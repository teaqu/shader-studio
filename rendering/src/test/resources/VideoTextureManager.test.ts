import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VideoTextureManager } from "../../resources/VideoTextureManager";
import type { TextureBackend } from "../../resources/TextureBackend";

interface FakeTex {
  id: object;
  width: number;
  height: number;
  format: string;
  filter: string;
  wrap: string;
  vflip: boolean;
}

// Mock backend implementation
function mockBackend() {
  const mockTextures = new Map<any, any>();

  return {
    createTexture: vi.fn(),

    createTextureFromImage: vi.fn((image, opts) => {
      const texture: FakeTex = {
        id: {},
        width: (image as HTMLVideoElement).videoWidth || 640,
        height: (image as HTMLVideoElement).videoHeight || 480,
        format: opts.format,
        filter: opts.filter,
        wrap: opts.wrap,
        vflip: opts.vflip,
      };
      mockTextures.set(texture.id, texture);
      return texture;
    }),

    createMipmaps: vi.fn(),

    updateTexture: vi.fn(),

    updateTextureFromImage: vi.fn((texture, image) => {
      // Simulate texture update
    }),

    destroyTexture: vi.fn((texture) => {
      mockTextures.delete(texture?.id);
    }),
  } satisfies TextureBackend<FakeTex>;
}

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

// Mock HTMLVideoElement that emulates Chromium's autoplay policy:
// play() rejects with NotAllowedError while unmuted, resolves once muted.
const createAutoplayBlockedVideoElement = (options: {
  paused?: boolean;
} = {}) => {
  const video = createMockVideoElement({ paused: options.paused ?? true });
  video.play.mockImplementation(() => {
    if (video.muted) {
      video.paused = false;
      return Promise.resolve(undefined);
    }
    return Promise.reject(
      new DOMException("play() can only be initiated by a user gesture.", "NotAllowedError"),
    );
  });
  video.pause.mockImplementation(() => {
    video.paused = true;
  });
  return video;
};

describe("VideoTextureManager", () => {
  let backend: TextureBackend<FakeTex>;
  let videoManager: VideoTextureManager<FakeTex>;
  let originalCreateElement: typeof document.createElement;
  let mockVideo: ReturnType<typeof createMockVideoElement>;

  beforeEach(() => {
    backend = mockBackend();
    videoManager = new VideoTextureManager(backend);
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
      expect(mockVideo.muted).toBe(false);
      expect(mockVideo.playsInline).toBe(true);
      expect(mockVideo.preload).toBe("auto");
      expect(mockVideo.autoplay).toBe(false);
      expect(mockVideo.play).not.toHaveBeenCalled();
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
      expect(backend.createTextureFromImage).toHaveBeenCalledTimes(1);
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

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filter: "linear" }),
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

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ wrap: "clamp" }),
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

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ vflip: false }),
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

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ vflip: true }),
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
      expect(backend.destroyTexture).toHaveBeenCalledTimes(2);
    });

    it("promptly rejects and fully removes an unresolved pending load", async () => {
      const parentNode = { removeChild: vi.fn() };
      mockVideo.parentNode = parentNode;
      const loadPromise = videoManager.loadVideoTexture("pending.mp4");
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === "canplay",
      )?.[1];
      const loadeddataHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === "loadeddata",
      )?.[1];
      const errorHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === "error",
      )?.[1];
      let rejection: unknown;
      void loadPromise.catch((error) => {
        rejection = error;
      });

      videoManager.cleanup();
      await vi.waitFor(() => expect(rejection).toEqual(expect.objectContaining({
        message: expect.stringMatching(/cancelled.*pending\.mp4/i),
      })));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith("canplay", canplayHandler);
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith("loadeddata", loadeddataHandler);
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith("error", errorHandler);
      expect(mockVideo.pause).toHaveBeenCalledTimes(1);
      expect(mockVideo.src).toBe("");
      expect(parentNode.removeChild).toHaveBeenCalledWith(mockVideo);
      expect(videoManager.getVideoElement("pending.mp4")).toBeUndefined();
      expect(videoManager.getVideoTexture("pending.mp4")).toBeUndefined();

      videoManager.cleanup();
      expect(mockVideo.pause).toHaveBeenCalledTimes(1);
      expect(parentNode.removeChild).toHaveBeenCalledTimes(1);
    });

    it("settles and detaches a pending load when listener and video cleanup throw", async () => {
      const parentNode = { removeChild: vi.fn(() => {
        throw new Error("pending remove failed");
      }) };
      mockVideo.parentNode = parentNode;
      mockVideo.removeEventListener.mockImplementationOnce(() => {
        throw new Error("listener removal failed");
      });
      mockVideo.pause.mockImplementationOnce(() => {
        throw new Error("pending pause failed");
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const loadPromise = videoManager.loadVideoTexture("pending-cleanup-errors.mp4");

      expect(() => videoManager.cleanup()).not.toThrow();
      await expect(loadPromise).rejects.toThrow(/cancelled.*pending-cleanup-errors\.mp4/i);

      expect(videoManager.getVideoElement("pending-cleanup-errors.mp4")).toBeUndefined();
      expect(videoManager.getVideoTexture("pending-cleanup-errors.mp4")).toBeUndefined();
      expect(mockVideo.src).toBe("");
      expect(parentNode.removeChild).toHaveBeenCalledWith(mockVideo);
      expect(errorSpy).toHaveBeenCalled();
      expect(() => videoManager.cleanup()).not.toThrow();
    });

    it("ignores late media events after pending-load cleanup", async () => {
      const parentNode = { removeChild: vi.fn() };
      mockVideo.parentNode = parentNode;
      const loadPromise = videoManager.loadVideoTexture("late-event.mp4");
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === "canplay",
      )?.[1];
      void loadPromise.catch(() => {});

      videoManager.cleanup();
      canplayHandler();
      await Promise.resolve();

      expect(backend.createTextureFromImage).not.toHaveBeenCalled();
      expect(backend.destroyTexture).not.toHaveBeenCalled();
      expect(videoManager.getVideoElement("late-event.mp4")).toBeUndefined();
      expect(videoManager.getVideoTexture("late-event.mp4")).toBeUndefined();
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it("destroys a texture returned after re-entrant cleanup and never installs it", async () => {
      const lateTexture: FakeTex = {
        id: {},
        width: 640,
        height: 480,
        format: "rgba8",
        filter: "linear",
        wrap: "clamp",
        vflip: true,
      };
      vi.mocked(backend.createTextureFromImage).mockImplementationOnce(() => {
        videoManager.cleanup();
        return lateTexture;
      });
      const loadPromise = videoManager.loadVideoTexture("reentrant.mp4");
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === "canplay",
      )?.[1];

      canplayHandler();

      await expect(loadPromise).rejects.toThrow(/cancelled.*reentrant\.mp4/i);
      expect(backend.destroyTexture).toHaveBeenCalledTimes(1);
      expect(backend.destroyTexture).toHaveBeenCalledWith(lateTexture);
      expect(videoManager.getVideoElement("reentrant.mp4")).toBeUndefined();
      expect(videoManager.getVideoTexture("reentrant.mp4")).toBeUndefined();
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it("keeps re-entrant load cleanup settled when detached texture destruction throws", async () => {
      const lateTexture: FakeTex = {
        id: {},
        width: 640,
        height: 480,
        format: "rgba8",
        filter: "linear",
        wrap: "clamp",
        vflip: true,
      };
      vi.mocked(backend.createTextureFromImage).mockImplementationOnce(() => {
        videoManager.cleanup();
        return lateTexture;
      });
      const destroyFailure = new Error("detached texture destroy failed");
      vi.mocked(backend.destroyTexture).mockImplementationOnce(() => {
        throw destroyFailure;
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const loadPromise = videoManager.loadVideoTexture("reentrant-destroy-error.mp4");
      const canplayHandler = mockVideo.addEventListener.mock.calls.find(
        ([type]) => type === "canplay",
      )?.[1] as (() => void) | undefined;
      const rejected = expect(loadPromise).rejects
        .toThrow(/cancelled.*reentrant-destroy-error\.mp4/i);

      expect(() => canplayHandler?.()).not.toThrow();
      await rejected;
      expect(backend.destroyTexture).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to destroy detached texture for video reentrant-destroy-error.mp4:",
        destroyFailure,
      );
      expect(videoManager.getVideoTexture("reentrant-destroy-error.mp4")).toBeUndefined();

      videoManager.cleanup();
      expect(backend.destroyTexture).toHaveBeenCalledTimes(1);
    });

    it("keeps completed-load cleanup idempotent", async () => {
      const parentNode = { removeChild: vi.fn() };
      mockVideo.parentNode = parentNode;
      const loadPromise = videoManager.loadVideoTexture("completed.mp4");
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === "canplay",
      )?.[1];
      canplayHandler();
      const texture = await loadPromise;

      videoManager.cleanup();
      videoManager.cleanup();

      expect(mockVideo.pause).toHaveBeenCalledTimes(1);
      expect(parentNode.removeChild).toHaveBeenCalledTimes(1);
      expect(backend.destroyTexture).toHaveBeenCalledTimes(1);
      expect(backend.destroyTexture).toHaveBeenCalledWith(texture);
    });

    it("detaches every loaded video and continues cleanup when cancellation, reset, and destroy throw", () => {
      const parentA = { removeChild: vi.fn() };
      const parentB = { removeChild: vi.fn() };
      const videoA = createMockVideoElement();
      const videoB = createMockVideoElement();
      videoA.parentNode = parentA;
      videoB.parentNode = parentB;
      videoA.pause.mockImplementationOnce(() => {
        throw new Error("pause failed");
      });
      parentB.removeChild.mockImplementationOnce(() => {
        throw new Error("remove failed");
      });
      const textureA: FakeTex = {
        id: {}, width: 4, height: 4, format: "rgba8", filter: "linear", wrap: "clamp", vflip: true,
      };
      const textureB: FakeTex = {
        id: {}, width: 8, height: 8, format: "rgba8", filter: "linear", wrap: "clamp", vflip: true,
      };
      const state = videoManager as unknown as {
        videoElements: Record<string, HTMLVideoElement>;
        videoTextures: Record<string, FakeTex>;
        animationFrameIds: Record<string, number>;
        pendingGestureUnmute: Set<string>;
        gestureListenersArmed: boolean;
      };
      state.videoElements["a.mp4"] = videoA as unknown as HTMLVideoElement;
      state.videoElements["b.mp4"] = videoB as unknown as HTMLVideoElement;
      state.videoTextures["a.mp4"] = textureA;
      state.videoTextures["b.mp4"] = textureB;
      state.animationFrameIds["a.mp4"] = 1;
      state.animationFrameIds["b.mp4"] = 2;
      state.pendingGestureUnmute.add("a.mp4");
      state.gestureListenersArmed = true;
      vi.mocked(window.cancelAnimationFrame).mockImplementationOnce(() => {
        throw new Error("cancel failed");
      });
      vi.mocked(backend.destroyTexture).mockImplementationOnce(() => {
        throw new Error("destroy failed");
      });
      const removeDocumentListener = vi.spyOn(document, "removeEventListener");
      removeDocumentListener.mockImplementation(() => {
        throw new Error("gesture listener removal failed");
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => videoManager.cleanup()).not.toThrow();

      expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(2);
      expect(videoA.pause).toHaveBeenCalledTimes(1);
      expect(videoB.pause).toHaveBeenCalledTimes(1);
      expect(videoA.src).toBe("");
      expect(videoB.src).toBe("");
      expect(parentA.removeChild).toHaveBeenCalledWith(videoA);
      expect(parentB.removeChild).toHaveBeenCalledWith(videoB);
      expect(backend.destroyTexture).toHaveBeenCalledTimes(2);
      expect(videoManager.getVideoElement("a.mp4")).toBeUndefined();
      expect(videoManager.getVideoElement("b.mp4")).toBeUndefined();
      expect(videoManager.getVideoTexture("a.mp4")).toBeUndefined();
      expect(videoManager.getVideoTexture("b.mp4")).toBeUndefined();
      expect(state.animationFrameIds).toEqual({});
      expect(removeDocumentListener).toHaveBeenCalledTimes(2);
      expect(state.gestureListenersArmed).toBe(false);
      expect(errorSpy).toHaveBeenCalled();

      videoManager.cleanup();
      expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(2);
      expect(backend.destroyTexture).toHaveBeenCalledTimes(2);
    });

    it("destroys a replacement installed after re-entrant cleanup during a frame update", async () => {
      let updateFrame: FrameRequestCallback | undefined;
      vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
        updateFrame = callback;
        return 42;
      });
      const destroyedIds: object[] = [];
      vi.mocked(backend.destroyTexture).mockImplementation((texture) => {
        if (texture) {
          destroyedIds.push(texture.id);
        }
      });
      const loadPromise = videoManager.loadVideoTexture("resizing.mp4");
      const canplayHandler = mockVideo.addEventListener.mock.calls.find(
        ([type]) => type === "canplay",
      )?.[1] as (() => void) | undefined;
      canplayHandler?.();
      const texture = await loadPromise;
      const originalId = texture.id;
      const replacementId = {};
      vi.mocked(backend.updateTextureFromImage).mockImplementationOnce((liveTexture) => {
        videoManager.cleanup();
        liveTexture.id = replacementId;
        liveTexture.width = 1280;
        liveTexture.height = 720;
      });

      updateFrame?.(16);

      expect(destroyedIds).toEqual([originalId, replacementId]);
      expect(videoManager.getVideoTexture("resizing.mp4")).toBeUndefined();
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it("keeps a completed video load usable when scheduling its update loop throws", async () => {
      const scheduleFailure = new Error("animation frame scheduling failed");
      vi.mocked(window.requestAnimationFrame).mockImplementationOnce(() => {
        throw scheduleFailure;
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const loadPromise = videoManager.loadVideoTexture("schedule-error.mp4");
      const canplayHandler = mockVideo.addEventListener.mock.calls.find(
        ([type]) => type === "canplay",
      )?.[1] as (() => void) | undefined;

      expect(() => canplayHandler?.()).not.toThrow();
      const texture = await loadPromise;

      expect(videoManager.getVideoTexture("schedule-error.mp4")).toBe(texture);
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to schedule texture update for video schedule-error.mp4:",
        scheduleFailure,
      );
    });

    it("logs a frame upload error and retries on the next scheduled update", async () => {
      const updateFrames: FrameRequestCallback[] = [];
      vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
        updateFrames.push(callback);
        return updateFrames.length;
      });
      const loadPromise = videoManager.loadVideoTexture("retry-update.mp4");
      const canplayHandler = mockVideo.addEventListener.mock.calls.find(
        ([type]) => type === "canplay",
      )?.[1] as (() => void) | undefined;
      canplayHandler?.();
      await loadPromise;
      const updateFailure = new Error("video frame upload failed");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(backend.updateTextureFromImage).mockClear();
      vi.mocked(backend.updateTextureFromImage).mockImplementationOnce(() => {
        throw updateFailure;
      });

      updateFrames[0](16);
      updateFrames[1](32);

      expect(backend.updateTextureFromImage).toHaveBeenCalledTimes(2);
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(3);
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to update texture for video retry-update.mp4:",
        updateFailure,
      );
    });
  });

  describe("pause and resume functionality", () => {
    it("should pause all playing videos", () => {
      const backend = mockBackend();
      const videoManager = new VideoTextureManager(backend);

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
      const backend = mockBackend();
      const videoManager = new VideoTextureManager(backend);

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
      const backend = mockBackend();
      const videoManager = new VideoTextureManager(backend);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Set up a video that fails to play
      const failingVideo = createMockVideoElement({ paused: true });
      failingVideo.play.mockRejectedValue(new Error('Play failed'));

      (videoManager as any).videoElements['failing.mp4'] = failingVideo;

      // Should not throw
      expect(() => videoManager.resumeAll()).not.toThrow();

      await vi.waitFor(() => {
        expect(failingVideo.play).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          "Could not resume video failing.mp4:",
          expect.any(Error),
        );
      });
    });

    it("should ignore AbortError resume failures caused by pause races", async () => {
      const backend = mockBackend();
      const videoManager = new VideoTextureManager(backend);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const video = createMockVideoElement({ paused: true });
      const abortError = new DOMException(
        "The play() request was interrupted by a call to pause().",
        "AbortError",
      );
      video.play.mockRejectedValue(abortError);

      (videoManager as any).videoElements['interrupted.mp4'] = video;

      videoManager.resumeAll();

      await vi.waitFor(() => {
        expect(video.play).toHaveBeenCalled();
      });
      await Promise.resolve();

      expect(warnSpy).not.toHaveBeenCalled();
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

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filter: "linear" }),
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

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filter: "nearest" }),
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

  describe("mute model", () => {
    it("loads unmuted at global volume by default", async () => {
      const loadPromise = videoManager.loadVideoTexture('a.mp4');
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      canplayHandler?.();
      await loadPromise;

      const video = videoManager.getVideoElement('a.mp4')!;
      expect(video.muted).toBe(false);
      expect(video.volume).toBe(1);
    });

    it("loads muted when config says muted", async () => {
      const loadPromise = videoManager.loadVideoTexture('a.mp4', { muted: true });
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      canplayHandler?.();
      await loadPromise;

      const video = videoManager.getVideoElement('a.mp4')!;
      expect(video.muted).toBe(true);
      expect(video.volume).toBe(0);
    });

    it("loads muted while globally muted even if config is unmuted", async () => {
      videoManager.setGlobalAudioState(1, true);

      const loadPromise = videoManager.loadVideoTexture('a.mp4');
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      canplayHandler?.();
      await loadPromise;

      expect(videoManager.getVideoElement('a.mp4')!.muted).toBe(true);
    });

    it("global unmute does not unmute config-muted videos", async () => {
      const mutedVideo = createMockVideoElement();
      const openVideo = createMockVideoElement();
      let created = 0;
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'video') {
          created += 1;
          return (created === 1 ? mutedVideo : openVideo) as unknown as HTMLVideoElement;
        }
        return originalCreateElement(tagName);
      });

      const loadMuted = videoManager.loadVideoTexture('muted.mp4', { muted: true });
      const mutedCanplay = (mutedVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      mutedCanplay?.();
      await loadMuted;

      const loadOpen = videoManager.loadVideoTexture('open.mp4');
      const openCanplay = (openVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      openCanplay?.();
      await loadOpen;

      videoManager.setGlobalAudioState(0.5, true);
      videoManager.setGlobalAudioState(0.5, false);

      expect(videoManager.getVideoElement('muted.mp4')!.muted).toBe(true);
      expect(videoManager.getVideoElement('open.mp4')!.muted).toBe(false);
      expect(videoManager.getVideoElement('open.mp4')!.volume).toBe(0.5);
    });

    it("per-channel mute/unmute toggles channel state and applies global volume", async () => {
      const loadPromise = videoManager.loadVideoTexture('a.mp4');
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      canplayHandler?.();
      await loadPromise;

      videoManager.setGlobalAudioState(0.7, false);
      videoManager.muteVideo('a.mp4');
      expect(videoManager.getVideoElement('a.mp4')!.muted).toBe(true);

      videoManager.unmuteVideo('a.mp4');
      expect(videoManager.getVideoElement('a.mp4')!.muted).toBe(false);
      expect(videoManager.getVideoElement('a.mp4')!.volume).toBe(0.7);
    });

    it("reload of a cached path reapplies changed config mute", async () => {
      const loadPromise = videoManager.loadVideoTexture('a.mp4');
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      canplayHandler?.();
      await loadPromise;

      await videoManager.loadVideoTexture('a.mp4', { muted: true });

      expect(videoManager.getVideoElement('a.mp4')!.muted).toBe(true);
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
      expect(backend.createTextureFromImage).toHaveBeenCalledTimes(1);
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

    it("should remove error listener after successful load so cleanup does not report empty-src errors", async () => {
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];
      const errorHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];

      canplayHandler();
      await loadPromise;

      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('error', errorHandler);
    });

    it("should not run delayed autoplay after the video was removed during reset cleanup", async () => {
      vi.useFakeTimers();
      mockVideo.paused = true;
      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");

      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];

      canplayHandler();
      await loadPromise;
      videoManager.removeVideoTexture("test-video.mp4");

      vi.advanceTimersByTime(100);
      await Promise.resolve();

      expect(mockVideo.play).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("should not install autoplay interaction retry while loading a texture", async () => {
      vi.useFakeTimers();
      mockVideo.paused = true;
      mockVideo.play.mockRejectedValue(new Error("No supported sources"));
      const addSpy = vi.spyOn(document, 'addEventListener');

      const loadPromise = videoManager.loadVideoTexture("test-video.mp4");
      const canplayHandler = (mockVideo.addEventListener as any).mock.calls.find(
        (call: any[]) => call[0] === 'canplay'
      )?.[1];

      canplayHandler();
      await loadPromise;
      vi.advanceTimersByTime(100);
      await Promise.resolve();

      expect(mockVideo.play).not.toHaveBeenCalled();
      expect(addSpy.mock.calls.some((call) => call[0] === 'click')).toBe(false);
      expect(addSpy.mock.calls.some((call) => call[0] === 'keydown')).toBe(false);

      vi.useRealTimers();
    });
  });

  describe("autoplay policy fallback", () => {
    it("falls back to muted playback when unmuted play is blocked by autoplay policy", async () => {
      const video = createAutoplayBlockedVideoElement({ paused: true });
      (videoManager as any).videoElements['blocked.mp4'] = video;

      videoManager.resumeAll();

      await vi.waitFor(() => {
        expect(video.muted).toBe(true);
        expect(video.paused).toBe(false);
      });

      expect((videoManager as any).pendingGestureUnmute.has('blocked.mp4')).toBe(true);
    });

    it("restores effective audio state on first user gesture", async () => {
      const video = createAutoplayBlockedVideoElement({ paused: true });
      (videoManager as any).videoElements['gesture.mp4'] = video;
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      videoManager.resumeAll();

      await vi.waitFor(() => {
        expect(video.muted).toBe(true);
      });

      expect(addSpy.mock.calls.filter(c => c[0] === 'pointerdown').length).toBe(1);
      expect(addSpy.mock.calls.filter(c => c[0] === 'keydown').length).toBe(1);

      document.dispatchEvent(new Event('pointerdown'));

      expect(video.muted).toBe(false);
      expect(video.volume).toBe(1); // default global volume

      expect(removeSpy.mock.calls.filter(c => c[0] === 'pointerdown').length).toBe(1);
      expect(removeSpy.mock.calls.filter(c => c[0] === 'keydown').length).toBe(1);

      // Second gesture should be a no-op: no re-arm, no further listener churn.
      document.dispatchEvent(new Event('keydown'));

      expect(addSpy.mock.calls.filter(c => c[0] === 'pointerdown').length).toBe(1);
      expect(removeSpy.mock.calls.filter(c => c[0] === 'pointerdown').length).toBe(1);
    });

    it("gesture restore respects state changed since the block", async () => {
      const video = createAutoplayBlockedVideoElement({ paused: true });
      (videoManager as any).videoElements['changed.mp4'] = video;

      videoManager.resumeAll();

      await vi.waitFor(() => {
        expect(video.muted).toBe(true);
      });

      videoManager.muteVideo('changed.mp4');

      document.dispatchEvent(new Event('pointerdown'));

      expect(video.muted).toBe(true);
    });

    it("gesture restore does not resume a video paused in the meantime", async () => {
      const video = createAutoplayBlockedVideoElement({ paused: true });
      (videoManager as any).videoElements['paused-meanwhile.mp4'] = video;

      videoManager.resumeAll();

      await vi.waitFor(() => {
        expect(video.muted).toBe(true);
        expect(video.paused).toBe(false);
      });

      videoManager.pauseVideo('paused-meanwhile.mp4');
      expect(video.paused).toBe(true);

      const playCallsBeforeGesture = video.play.mock.calls.length;

      document.dispatchEvent(new Event('pointerdown'));

      expect(video.paused).toBe(true);
      expect(video.play.mock.calls.length).toBe(playCallsBeforeGesture);
    });

    it("config/global-muted videos are unaffected by the fallback", async () => {
      const video = createMockVideoElement({ paused: true });
      video.muted = true;
      (videoManager as any).videoElements['muted.mp4'] = video;
      (videoManager as any).channelMuted['muted.mp4'] = true;

      videoManager.resumeAll();

      await vi.waitFor(() => {
        expect(video.play).toHaveBeenCalled();
      });
      await Promise.resolve();

      expect((videoManager as any).pendingGestureUnmute.has('muted.mp4')).toBe(false);

      document.dispatchEvent(new Event('pointerdown'));

      expect(video.muted).toBe(true);
    });

    it("cleanup removes gesture listeners and pending state", async () => {
      const video = createAutoplayBlockedVideoElement({ paused: true });
      (videoManager as any).videoElements['cleanup.mp4'] = video;
      (videoManager as any).videoTextures['cleanup.mp4'] = { id: {} };

      videoManager.resumeAll();

      await vi.waitFor(() => {
        expect(video.muted).toBe(true);
      });
      expect((videoManager as any).gestureListenersArmed).toBe(true);

      videoManager.cleanup();

      expect((videoManager as any).pendingGestureUnmute.size).toBe(0);
      expect((videoManager as any).gestureListenersArmed).toBe(false);

      expect(() => {
        document.dispatchEvent(new Event('pointerdown'));
      }).not.toThrow();
    });

    it("removeVideoTexture drops the path from the pending gesture set", async () => {
      const video = createAutoplayBlockedVideoElement({ paused: true });
      (videoManager as any).videoElements['removed.mp4'] = video;
      (videoManager as any).videoTextures['removed.mp4'] = { id: {} };

      videoManager.resumeAll();

      await vi.waitFor(() => {
        expect(video.muted).toBe(true);
      });
      expect((videoManager as any).pendingGestureUnmute.has('removed.mp4')).toBe(true);

      videoManager.removeVideoTexture('removed.mp4');

      expect((videoManager as any).pendingGestureUnmute.has('removed.mp4')).toBe(false);
      expect((videoManager as any).gestureListenersArmed).toBe(false);
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

      expect(backend.createTextureFromImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ wrap: "clamp" }),
      );
    });
  });
});
