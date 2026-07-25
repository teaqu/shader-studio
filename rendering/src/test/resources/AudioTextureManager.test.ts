import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioTextureManager } from "../../resources/AudioTextureManager";
import type { TextureBackend } from "../../resources/TextureBackend";

interface FakeTex { id: number }

const createMockTexture = (id = 1): FakeTex => ({ id });

function mockBackend() {
  let textureId = 0;
  return {
    createTexture: vi.fn((): FakeTex => createMockTexture(++textureId)),
    createTextureFromImage: vi.fn((): FakeTex => createMockTexture(++textureId)),
    createMipmaps: vi.fn(),
    updateTexture: vi.fn(),
    updateTextureFromImage: vi.fn(),
    destroyTexture: vi.fn(),
  } satisfies TextureBackend<FakeTex>;
}

const createMockAnalyser = () => ({
  fftSize: 0,
  smoothingTimeConstant: 0,
  frequencyBinCount: 512,
  connect: vi.fn(),
  disconnect: vi.fn(),
  getByteFrequencyData: vi.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = i % 256;
    }
  }),
  getByteTimeDomainData: vi.fn(),
});

const createMockGainNode = () => ({
  gain: { value: 1.0 },
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const createMockBufferSourceNode = () => ({
  buffer: null as AudioBuffer | null,
  loop: false,
  loopStart: 0,
  loopEnd: 0,
  connect: vi.fn(),
  disconnect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
});

const createMockAudioBuffer = (duration: number = 60): AudioBuffer => ({
  duration,
  length: duration * 44100,
  numberOfChannels: 2,
  sampleRate: 44100,
  getChannelData: vi.fn(() => new Float32Array(duration * 44100)),
  copyFromChannel: vi.fn(),
  copyToChannel: vi.fn(),
});

const createMockAudioContext = () => ({
  sampleRate: 44100,
  currentTime: 0,
  createAnalyser: vi.fn(() => createMockAnalyser()),
  createGain: vi.fn(() => createMockGainNode()),
  createBufferSource: vi.fn(() => createMockBufferSourceNode()),
  decodeAudioData: vi.fn(() => Promise.resolve(createMockAudioBuffer())),
  destination: {},
  close: vi.fn().mockResolvedValue(undefined),
});

describe("AudioTextureManager", () => {
  let backend: TextureBackend<FakeTex>;
  let manager: AudioTextureManager<FakeTex>;
  let mockAudioContext: ReturnType<typeof createMockAudioContext>;
  let originalAudioContext: typeof AudioContext;

  beforeEach(() => {
    backend = mockBackend();
    mockAudioContext = createMockAudioContext();

    originalAudioContext = globalThis.AudioContext;
    (globalThis as any).AudioContext = class MockAudioContext {
      sampleRate = mockAudioContext.sampleRate;
      currentTime = mockAudioContext.currentTime;
      destination = mockAudioContext.destination;
      createAnalyser = mockAudioContext.createAnalyser;
      createGain = mockAudioContext.createGain;
      createBufferSource = mockAudioContext.createBufferSource;
      decodeAudioData = mockAudioContext.decodeAudioData;
      close = mockAudioContext.close;
    };

    // Mock fetch to return a mock Response with arrayBuffer
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    } as Response);

    manager = new AudioTextureManager(backend);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    manager.cleanup();
    (globalThis as any).AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

  async function loadTestAudio(path: string = "test.mp3"): Promise<void> {
    await manager.loadAudioSource(path);
  }

  describe("audio playback controls", () => {
    it("should not auto-play on load", async () => {
      await loadTestAudio("track.mp3");

      expect(manager.isAudioPaused("track.mp3")).toBe(true);
    });

    it("should pause and resume audio", async () => {
      await loadTestAudio("track.mp3");

      // Audio starts paused after load
      expect(manager.isAudioPaused("track.mp3")).toBe(true);

      manager.resumeAudio("track.mp3");
      expect(manager.isAudioPaused("track.mp3")).toBe(false);

      manager.pauseAudio("track.mp3");
      expect(manager.isAudioPaused("track.mp3")).toBe(true);

      manager.resumeAudio("track.mp3");
      expect(manager.isAudioPaused("track.mp3")).toBe(false);
    });

    it("should mute and unmute audio via gainNode", async () => {
      await loadTestAudio("track.mp3");

      expect(manager.isAudioMuted("track.mp3")).toBe(false);

      manager.muteAudio("track.mp3");
      expect(manager.isAudioMuted("track.mp3")).toBe(true);

      manager.unmuteAudio("track.mp3");
      expect(manager.isAudioMuted("track.mp3")).toBe(false);
    });

    it("should reset audio to beginning", async () => {
      await loadTestAudio("track.mp3");

      manager.resetAudio("track.mp3");
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(0);
    });

    it("should return paused=true for non-existent path", () => {
      expect(manager.isAudioPaused("nonexistent")).toBe(true);
    });

    it("should return muted=true for non-existent path", () => {
      expect(manager.isAudioMuted("nonexistent")).toBe(true);
    });

    it("should handle pause/resume/mute/unmute/reset on non-existent paths gracefully", () => {
      expect(() => {
        manager.pauseAudio("nope");
        manager.resumeAudio("nope");
        manager.muteAudio("nope");
        manager.unmuteAudio("nope");
        manager.resetAudio("nope");
      }).not.toThrow();
    });
  });

  describe("bulk audio controls", () => {
    it("should pause and resume all audio", async () => {
      await loadTestAudio("a.mp3");
      await loadTestAudio("b.mp3");

      // Start playing first
      manager.resumeAudio("a.mp3");
      manager.resumeAudio("b.mp3");
      expect(manager.isAudioPaused("a.mp3")).toBe(false);
      expect(manager.isAudioPaused("b.mp3")).toBe(false);

      manager.pauseAll();
      expect(manager.isAudioPaused("a.mp3")).toBe(true);
      expect(manager.isAudioPaused("b.mp3")).toBe(true);

      manager.resumeAll();
      expect(manager.isAudioPaused("a.mp3")).toBe(false);
      expect(manager.isAudioPaused("b.mp3")).toBe(false);
    });

    it("should not resume user-paused audio on resumeAll", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");

      // User pauses individually
      manager.pauseAudio("track.mp3");

      // resumeAll should skip user-paused
      manager.resumeAll();
      expect(manager.isAudioPaused("track.mp3")).toBe(true);
    });

    it("resumeAll should resume never-started audio (for togglePause unpause)", async () => {
      await loadTestAudio("track.mp3");

      // Audio was loaded but never started — resumeAll DOES resume it
      // because it's not userPaused. This is correct for togglePause unpause.
      manager.resumeAll();
      expect(manager.isAudioPaused("track.mp3")).toBe(false);
    });

    it("should sync all audio to shader time", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");

      const initialCalls = mockAudioContext.createBufferSource.mock.calls.length;
      // duration = 60 (from mock), shaderTime=35 -> 35 % 60 = 35
      manager.syncAllToTime(35);
      // seekAudio should have been called (restarts source node)
      expect(mockAudioContext.createBufferSource.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  describe("getAudioFFTData", () => {
    it("should return null for non-existent path", () => {
      expect(manager.getAudioFFTData("nonexistent.mp3")).toBeNull();
    });
  });

  describe("getSampleRate", () => {
    it("should return default sample rate before audio context is created", () => {
      expect(manager.getSampleRate()).toBe(44100);
    });

    it("should return audio context sample rate after loading audio", async () => {
      await loadTestAudio("track.mp3");
      expect(manager.getSampleRate()).toBe(44100);
    });
  });

  describe("updateLoopRegion", () => {
    it("should set a new loop region on a loaded audio source", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");

      manager.updateLoopRegion("track.mp3", 5.0, 20.0);

      // Reset should now use the updated startTime
      manager.resetAudio("track.mp3");
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(5.0);
    });

    it("should update an existing loop region", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");

      manager.updateLoopRegion("track.mp3", 2.0, 10.0);
      manager.updateLoopRegion("track.mp3", 8.0, 25.0);

      manager.resetAudio("track.mp3");
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(8.0);
    });

    it("should remove loop region when both startTime and endTime are undefined", async () => {
      await loadTestAudio("track.mp3");

      manager.updateLoopRegion("track.mp3", 5.0, 20.0);
      manager.updateLoopRegion("track.mp3", undefined, undefined);

      // Reset should go to 0 since no loop region
      manager.resetAudio("track.mp3");
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(0);
    });

    it("should set loop region with only startTime", async () => {
      await loadTestAudio("track.mp3");

      manager.updateLoopRegion("track.mp3", 10.0);

      manager.resetAudio("track.mp3");
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(10.0);
    });

    it("should handle updateLoopRegion on non-existent path gracefully", () => {
      expect(() => {
        manager.updateLoopRegion("nonexistent.mp3", 5.0, 10.0);
      }).not.toThrow();
    });
  });

  describe("loadAudioSource", () => {
    it("should use fetch to load audio data", async () => {
      await loadTestAudio("track.mp3");

      expect(globalThis.fetch).toHaveBeenCalledWith("track.mp3");
      expect(mockAudioContext.decodeAudioData).toHaveBeenCalled();
    });

    it("should not start playback after loading", async () => {
      await loadTestAudio("track.mp3");

      expect(manager.isAudioPaused("track.mp3")).toBe(true);
      // No source node created yet — playback hasn't started
      expect(mockAudioContext.createBufferSource).not.toHaveBeenCalled();
    });

    it("should return existing texture if already loaded", async () => {
      const tex1 = await manager.loadAudioSource("track.mp3");
      const tex2 = await manager.loadAudioSource("track.mp3");

      expect(tex1).toBe(tex2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("should handle fetch failure gracefully", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      // Should not throw
      await manager.loadAudioSource("missing.mp3");
      expect(console.warn).toHaveBeenCalled();
    });

    it("should set startTime as initial offset when provided", async () => {
      await manager.loadAudioSource("track.mp3", { startTime: 15.0 });

      // Audio doesn't auto-play, but offset should be set
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(15.0);
    });

    it("should set loop region when startTime/endTime provided", async () => {
      await manager.loadAudioSource("track.mp3", { startTime: 5.0, endTime: 20.0 });

      // Resume to trigger source node creation with loop settings
      manager.resumeAudio("track.mp3");

      const sourceNode = mockAudioContext.createBufferSource.mock.results[0].value;
      expect(sourceNode.loopStart).toBe(5.0);
      expect(sourceNode.loopEnd).toBe(20.0);
    });

    it("should apply muted option", async () => {
      await manager.loadAudioSource("track.mp3", { muted: true });

      expect(manager.isAudioMuted("track.mp3")).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("should clean up all audio resources", async () => {
      await loadTestAudio("track.mp3");

      manager.cleanup();

      expect(manager.getAudioTexture("track.mp3")).toBeNull();
      expect(mockAudioContext.close).toHaveBeenCalled();
    });

    it("should handle cleanup when nothing is connected", () => {
      expect(() => manager.cleanup()).not.toThrow();
    });
  });

  describe("seekAudio", () => {
    it("should restart playback from new position when playing", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");

      const initialSourceCallCount = mockAudioContext.createBufferSource.mock.calls.length;
      manager.seekAudio("track.mp3", 30.0);

      // Should have created a new source node for the seek
      expect(mockAudioContext.createBufferSource.mock.calls.length).toBeGreaterThan(initialSourceCallCount);
    });

    it("should update offset when paused", async () => {
      await loadTestAudio("track.mp3");
      manager.pauseAudio("track.mp3");

      manager.seekAudio("track.mp3", 25.0);
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(25.0);
    });

    it("should handle seek on non-existent path gracefully", () => {
      expect(() => manager.seekAudio("nope", 10)).not.toThrow();
    });
  });

  describe("fetch-based audio loading (CORS fix)", () => {
    it("should use fetch instead of HTMLAudioElement for webview compatibility", async () => {
      await loadTestAudio("track.mp3");

      // Verify fetch was used (not HTMLAudioElement)
      expect(globalThis.fetch).toHaveBeenCalledWith("track.mp3");

      // Verify decodeAudioData was used (not createMediaElementSource)
      expect(mockAudioContext.decodeAudioData).toHaveBeenCalled();
    });

    it("should handle fetch network error gracefully", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));

      await manager.loadAudioSource("bad.mp3");

      // Should not throw, should warn
      expect(console.warn).toHaveBeenCalled();
      expect(manager.getAudioTexture("bad.mp3")).toBeNull();
    });

    it("should handle decodeAudioData failure gracefully", async () => {
      mockAudioContext.decodeAudioData.mockRejectedValueOnce(new Error("Invalid audio data"));

      await manager.loadAudioSource("corrupt.mp3");

      expect(console.warn).toHaveBeenCalled();
    });

    it("should work with vscode webview resource URIs", async () => {
      const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/Users/test/music.mp3";
      await manager.loadAudioSource(webviewUri);

      expect(globalThis.fetch).toHaveBeenCalledWith(webviewUri);
      expect(mockAudioContext.decodeAudioData).toHaveBeenCalled();
    });

    it("should create AudioBufferSourceNode on resume, not on load", async () => {
      await loadTestAudio("track.mp3");

      // Not created on load
      expect(mockAudioContext.createBufferSource).not.toHaveBeenCalled();

      // Created on resume
      manager.resumeAudio("track.mp3");
      expect(mockAudioContext.createBufferSource).toHaveBeenCalled();

      const sourceNode = mockAudioContext.createBufferSource.mock.results[0].value;
      expect(sourceNode.start).toHaveBeenCalled();
    });

    it("should set native loop properties on AudioBufferSourceNode when resumed", async () => {
      await manager.loadAudioSource("track.mp3", { startTime: 5.0, endTime: 20.0 });

      manager.resumeAudio("track.mp3");

      const sourceNode = mockAudioContext.createBufferSource.mock.results[0].value;
      expect(sourceNode.loop).toBe(true);
      expect(sourceNode.loopStart).toBe(5.0);
      expect(sourceNode.loopEnd).toBe(20.0);
    });
  });

  describe("seeking during drag (performance fix)", () => {
    it("should allow rapid seeking without errors", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");

      // Simulate rapid seeking as would happen during drag
      expect(() => {
        for (let i = 0; i < 50; i++) {
          manager.seekAudio("track.mp3", i * 1.2);
        }
      }).not.toThrow();
    });

    it("should allow rapid loop region updates without errors", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");

      // Simulate rapid loop region updates as would happen during drag
      expect(() => {
        for (let i = 0; i < 50; i++) {
          manager.updateLoopRegion("track.mp3", i * 0.5, 30 + i * 0.5);
        }
      }).not.toThrow();
    });

    it("should correctly track position after seek", async () => {
      await loadTestAudio("track.mp3");
      manager.pauseAudio("track.mp3");

      manager.seekAudio("track.mp3", 45.0);
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(45.0);

      manager.seekAudio("track.mp3", 10.0);
      expect(manager.getAudioCurrentTime("track.mp3")).toBe(10.0);
    });

  });

  describe("getAudioDuration", () => {
    it("should return 0 for non-existent path", () => {
      expect(manager.getAudioDuration("nope")).toBe(0);
    });

    it("should return buffer duration after loading", async () => {
      await loadTestAudio("track.mp3");
      expect(manager.getAudioDuration("track.mp3")).toBe(60);
    });
  });

  describe("pause/unpause/reset flow (regression prevention)", () => {
    it("pauseAll does NOT set userPaused — resumeAll resumes after pauseAll", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");
      expect(manager.isAudioPaused("track.mp3")).toBe(false);

      // System pause (e.g., togglePause pausing the shader)
      manager.pauseAll();
      expect(manager.isAudioPaused("track.mp3")).toBe(true);

      // System unpause — should resume because pauseAll didn't set userPaused
      manager.resumeAll();
      expect(manager.isAudioPaused("track.mp3")).toBe(false);
    });

    it("pauseAudio sets userPaused — resumeAll does NOT resume after pauseAudio", async () => {
      await loadTestAudio("track.mp3");
      manager.resumeAudio("track.mp3");

      // User pause (e.g., clicking individual pause button)
      manager.pauseAudio("track.mp3");
      expect(manager.isAudioPaused("track.mp3")).toBe(true);

      // System unpause — should NOT resume because user explicitly paused
      manager.resumeAll();
      expect(manager.isAudioPaused("track.mp3")).toBe(true);
    });

    it("shader switch: cleanup removes all state, new load does not auto-play", async () => {
      // Load audio for shader A
      await loadTestAudio("shaderA-music.mp3");
      manager.resumeAll();
      expect(manager.isAudioPaused("shaderA-music.mp3")).toBe(false);

      // Switch to shader B — cleanup is called
      manager.cleanup();
      expect(manager.getAudioTexture("shaderA-music.mp3")).toBeNull();

      // Re-create manager for new shader (simulates new compilation)
      manager = new AudioTextureManager(backend);

      // Load audio for shader B
      await manager.loadAudioSource("shaderB-drums.mp3");
      // Should NOT auto-play
      expect(manager.isAudioPaused("shaderB-drums.mp3")).toBe(true);
    });

    it("togglePause cycle: play → pauseAll → resumeAll preserves state correctly", async () => {
      await loadTestAudio("a.mp3");
      await loadTestAudio("b.mp3");

      // Start both playing
      manager.resumeAll();
      expect(manager.isAudioPaused("a.mp3")).toBe(false);
      expect(manager.isAudioPaused("b.mp3")).toBe(false);

      // User pauses one individually
      manager.pauseAudio("a.mp3");

      // System pause (togglePause)
      manager.pauseAll();
      expect(manager.isAudioPaused("a.mp3")).toBe(true);
      expect(manager.isAudioPaused("b.mp3")).toBe(true);

      // System unpause (togglePause)
      manager.resumeAll();

      // b should resume (was system-paused), a should stay paused (was user-paused)
      expect(manager.isAudioPaused("a.mp3")).toBe(true);
      expect(manager.isAudioPaused("b.mp3")).toBe(false);
    });

    it("resumeAll skips audio still initializing", async () => {
      const loadPromise = manager.loadAudioSource("loading.mp3");

      manager.resumeAll();

      await loadPromise;

      expect(manager.isAudioPaused("loading.mp3")).toBe(true);
    });
  });

  describe("mute model", () => {
    // The mock createGain() returns a fresh { gain: { value }, connect, disconnect }
    // object per call. Track the gain object for a path the first time createGain
    // is invoked for it (new sources only — cache hits reuse the existing gainNode).
    const gainNodes: Record<string, { value: number }> = {};

    async function loadTracked(
      path: string,
      options?: { muted?: boolean; startTime?: number; endTime?: number },
    ): Promise<void> {
      const before = mockAudioContext.createGain.mock.calls.length;
      await manager.loadAudioSource(path, options);
      const after = mockAudioContext.createGain.mock.calls.length;
      if (after > before) {
        gainNodes[path] = mockAudioContext.createGain.mock.results[before].value.gain;
      }
    }

    function gainValueFor(path: string): number {
      return gainNodes[path]?.value ?? NaN;
    }

    it("loads audible at gain 1 by default", async () => {
      await loadTracked("a.mp3");
      expect(gainValueFor("a.mp3")).toBe(1);
    });

    it("loads at gain 0 when config muted", async () => {
      await loadTracked("a.mp3", { muted: true });
      expect(gainValueFor("a.mp3")).toBe(0);
    });

    it("loads at gain 0 while globally muted", async () => {
      manager.setGlobalAudioState(1, true);
      await loadTracked("a.mp3");
      expect(gainValueFor("a.mp3")).toBe(0);
    });

    it("global unmute restores volume only for channels not config-muted", async () => {
      await loadTracked("muted.mp3", { muted: true });
      await loadTracked("open.mp3");
      manager.setGlobalAudioState(0.5, true);
      manager.setGlobalAudioState(0.5, false);
      expect(gainValueFor("muted.mp3")).toBe(0);
      expect(gainValueFor("open.mp3")).toBe(0.5);
    });

    it("per-channel mute/unmute toggles gain against global volume", async () => {
      await loadTracked("a.mp3");
      manager.setGlobalAudioState(0.7, false);
      manager.muteAudio("a.mp3");
      expect(gainValueFor("a.mp3")).toBe(0);
      expect(manager.isAudioMuted("a.mp3")).toBe(true);
      manager.unmuteAudio("a.mp3");
      expect(gainValueFor("a.mp3")).toBe(0.7);
      expect(manager.isAudioMuted("a.mp3")).toBe(false);
    });

    it("reload of a cached path reapplies changed config mute", async () => {
      await loadTracked("a.mp3");
      await loadTracked("a.mp3", { muted: true });
      expect(gainValueFor("a.mp3")).toBe(0);
    });

    it("clamps global volume to [0,1]", async () => {
      await loadTracked("a.mp3");
      manager.setGlobalAudioState(2, false);
      expect(gainValueFor("a.mp3")).toBe(1);
      manager.setGlobalAudioState(-1, false);
      expect(gainValueFor("a.mp3")).toBe(0);
    });

    it("clears channelMuted state when a source is removed", async () => {
      await loadTracked("a.mp3", { muted: true });
      expect(gainValueFor("a.mp3")).toBe(0);

      manager.removeAudioSource("a.mp3");
      await loadTracked("a.mp3");
      expect(gainValueFor("a.mp3")).toBe(1);
    });
  });

  describe("resumeAudioContext", () => {
    it("starts loaded audio after a browser interaction resumes a suspended context", async () => {
      const mockResume = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).AudioContext = class MockAudioContext {
        sampleRate = 44100;
        currentTime = 0;
        destination = {};
        state = 'suspended';
        createAnalyser = mockAudioContext.createAnalyser;
        createGain = mockAudioContext.createGain;
        createBufferSource = mockAudioContext.createBufferSource;
        decodeAudioData = mockAudioContext.decodeAudioData;
        close = mockAudioContext.close;
        resume = mockResume;
      };

      manager.cleanup();
      manager = new AudioTextureManager(backend);
      await manager.loadAudioSource("test.mp3");

      document.dispatchEvent(new MouseEvent('click'));

      await vi.waitFor(() => {
        expect(mockResume).toHaveBeenCalledTimes(1);
        expect(mockAudioContext.createBufferSource).toHaveBeenCalledTimes(1);
      });
      expect(manager.isAudioPaused("test.mp3")).toBe(false);
    });

    it("starts audio that finishes loading after the browser interaction", async () => {
      let resolveDecode!: (buffer: AudioBuffer) => void;
      mockAudioContext.decodeAudioData.mockReturnValue(new Promise((resolve) => {
        resolveDecode = resolve;
      }));
      const mockResume = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).AudioContext = class MockAudioContext {
        sampleRate = 44100;
        currentTime = 0;
        destination = {};
        state = 'suspended';
        createAnalyser = mockAudioContext.createAnalyser;
        createGain = mockAudioContext.createGain;
        createBufferSource = mockAudioContext.createBufferSource;
        decodeAudioData = mockAudioContext.decodeAudioData;
        close = mockAudioContext.close;
        resume = mockResume;
      };

      manager.cleanup();
      manager = new AudioTextureManager(backend);
      const loadPromise = manager.loadAudioSource("test.mp3");
      await vi.waitFor(() => expect(mockAudioContext.decodeAudioData).toHaveBeenCalledTimes(1));

      document.dispatchEvent(new MouseEvent('click'));
      await vi.waitFor(() => expect(mockResume).toHaveBeenCalledTimes(1));
      resolveDecode(createMockAudioBuffer());
      await loadPromise;

      expect(mockAudioContext.createBufferSource).toHaveBeenCalledTimes(1);
      expect(manager.isAudioPaused("test.mp3")).toBe(false);
    });

    it("should resume a suspended AudioContext", async () => {
      const mockResume = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).AudioContext = class MockAudioContext {
        sampleRate = 44100;
        currentTime = 0;
        destination = {};
        state = 'suspended';
        createAnalyser = mockAudioContext.createAnalyser;
        createGain = mockAudioContext.createGain;
        createBufferSource = mockAudioContext.createBufferSource;
        decodeAudioData = mockAudioContext.decodeAudioData;
        close = mockAudioContext.close;
        resume = mockResume;
      };

      const freshManager = new AudioTextureManager(backend);
      // Trigger AudioContext creation
      await freshManager.loadAudioSource("test.mp3");
      await freshManager.resumeAudioContext();

      expect(mockResume).toHaveBeenCalled();
      freshManager.cleanup();
    });

    it("should not call resume if AudioContext is already running", async () => {
      const mockResume = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).AudioContext = class MockAudioContext {
        sampleRate = 44100;
        currentTime = 0;
        destination = {};
        state = 'running';
        createAnalyser = mockAudioContext.createAnalyser;
        createGain = mockAudioContext.createGain;
        createBufferSource = mockAudioContext.createBufferSource;
        decodeAudioData = mockAudioContext.decodeAudioData;
        close = mockAudioContext.close;
        resume = mockResume;
      };

      const freshManager = new AudioTextureManager(backend);
      await freshManager.loadAudioSource("test.mp3");
      await freshManager.resumeAudioContext();

      expect(mockResume).not.toHaveBeenCalled();
      freshManager.cleanup();
    });

    it("should be a no-op if no AudioContext exists", async () => {
      const freshManager = new AudioTextureManager(backend);
      // Don't load any audio (no AudioContext created)
      await freshManager.resumeAudioContext();
      // Should not throw
      freshManager.cleanup();
    });
  });
});
