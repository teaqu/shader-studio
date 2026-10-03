import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveInputTextureManager } from "../../resources/LiveInputTextureManager";
import type { TextureBackend } from "../../resources/TextureBackend";

interface Texture { id: number }

function backend(): TextureBackend<Texture> {
  let id = 0;
  return {
    createTexture: vi.fn(() => ({ id: ++id })),
    createTextureFromImage: vi.fn(() => ({ id: ++id })),
    createMipmaps: vi.fn(),
    updateTexture: vi.fn(),
    updateTextureFromImage: vi.fn(),
    destroyTexture: vi.fn(),
  };
}

function stream() {
  const listeners = new Map<string, () => void>();
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    end: () => listeners.get("ended")?.(),
  };
  return { getTracks: vi.fn(() => [track]), track };
}

function audioContext() {
  const analyser = { fftSize: 0, getByteFrequencyData: vi.fn(), getByteTimeDomainData: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = { state: "suspended" as AudioContextState, sampleRate: 48000, destination: {}, createAnalyser: vi.fn(() => analyser), createGain: vi.fn(() => gain), createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })), resume: vi.fn().mockImplementation(async () => {
    context.state = "running";
  }), close: vi.fn().mockResolvedValue(undefined), analyser, gain };
  return context;
}

describe("LiveInputTextureManager", () => {
  let textureBackend: TextureBackend<Texture>;
  let manager: LiveInputTextureManager<Texture>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let mockStream: ReturnType<typeof stream>;
  let mockContext: ReturnType<typeof audioContext>;

  beforeEach(() => {
    textureBackend = backend();
    manager = new LiveInputTextureManager(textureBackend);
    mockStream = stream();
    getUserMedia = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    mockContext = audioContext();
    vi.stubGlobal("AudioContext", class {
      sampleRate = mockContext.sampleRate; destination = mockContext.destination; get state() {
        return mockContext.state;
      } createAnalyser = mockContext.createAnalyser; createGain = mockContext.createGain; createMediaStreamSource = mockContext.createMediaStreamSource; resume = mockContext.resume; close = mockContext.close;
    });
  });

  afterEach(() => {
    manager.cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads one muted, inline webcam stream and updates its texture", async () => {
    const video = { muted: false, playsInline: false, autoplay: false, srcObject: null, videoWidth: 640, videoHeight: 480, style: {}, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), remove: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(video as unknown as HTMLVideoElement);
    vi.spyOn(document.body, "appendChild").mockImplementation(node => node);

    const [first, second] = await Promise.all([manager.load("webcam"), manager.load("webcam")]);
    manager.updateTextures();

    expect(first.texture).toBe(second.texture);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(video).toMatchObject({ muted: true, playsInline: true, autoplay: true, srcObject: mockStream });
    expect(textureBackend.updateTextureFromImage).toHaveBeenCalledWith(first.texture, video);
  });

  it("returns an actionable warning for denied capture permission", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    const result = await manager.load("microphone");

    expect(result.texture).toBeNull();
    expect(result.warning).toContain("permission was denied");
  });

  it("explains secure-browser requirements when media capture is unavailable", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    await expect(manager.load("webcam")).resolves.toMatchObject({ texture: null, warning: expect.stringContaining("HTTPS") });
  });

  it.each(["NotFoundError", "NotReadableError"])("returns an actionable %s capture warning", async (name) => {
    getUserMedia.mockRejectedValue(new DOMException("capture failed", name));

    const result = await manager.load("webcam");

    expect(result.texture).toBeNull();
    expect(result.warning).toMatch(/camera|device|application/i);
  });

  it("uploads analyser FFT and waveform data without audible monitoring", async () => {
    const result = await manager.load("microphone", { filter: "nearest", wrap: "repeat" });
    manager.updateTextures();

    expect(result.texture).not.toBeNull();
    expect(mockContext.gain.gain.value).toBe(0);
    expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(mockStream);
    expect(textureBackend.createTexture).toHaveBeenCalledWith(expect.objectContaining({ width: 512, height: 2, format: "r8", filter: "nearest", wrap: "repeat" }));
    expect(textureBackend.updateTexture).toHaveBeenCalledTimes(2);
    expect(manager.getSampleRate()).toBe(48000);
    expect(manager.getAudioState()).toMatchObject({ paused: false, muted: true, duration: 0 });
  });

  it("reports no audio sample rate or state before microphone capture", () => {
    expect(manager.getSampleRate()).toBe(0);
    expect(manager.getAudioState()).toBeNull();
    expect(manager.getVideoElement()).toBeUndefined();
  });

  it("resumes microphone analysis from the next user gesture", async () => {
    await manager.load("microphone");
    await Promise.resolve();
    expect(mockContext.resume).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();

    expect(mockContext.resume).toHaveBeenCalledTimes(1);
  });

  it("stops a late permission stream after cleanup", async () => {
    let resolve!: (value: ReturnType<typeof stream>) => void;
    getUserMedia.mockImplementation(() => new Promise(done => {
      resolve = done;
    }));
    const pending = manager.load("webcam");
    manager.cleanup();
    resolve(mockStream);

    const result = await pending;
    expect(result.texture).toBeNull();
    expect(mockStream.track.stop).toHaveBeenCalledTimes(1);
  });

  it("releases tracks, GPU textures, nodes, and audio context", async () => {
    await manager.load("microphone");
    manager.cleanup();
    await Promise.resolve();

    expect(mockStream.track.stop).toHaveBeenCalledTimes(1);
    expect(textureBackend.destroyTexture).toHaveBeenCalledWith(expect.anything());
    expect(mockContext.analyser.disconnect).toHaveBeenCalled();
    expect(mockContext.gain.disconnect).toHaveBeenCalled();
    expect(mockContext.createMediaStreamSource.mock.results[0]?.value.disconnect).toHaveBeenCalled();
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it("closes partially installed microphone nodes and context when texture allocation fails", async () => {
    vi.mocked(textureBackend.createTexture).mockReturnValue(null);

    await expect(manager.load("microphone")).resolves.toMatchObject({ texture: null, warning: expect.stringContaining("GPU texture allocation failed") });
    await Promise.resolve();

    expect(mockStream.track.stop).toHaveBeenCalledTimes(1);
    expect(mockContext.analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(mockContext.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(mockContext.createMediaStreamSource.mock.results[0]?.value.disconnect).toHaveBeenCalledTimes(1);
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it("releases ended webcam resources so stale capture is not reported loaded", async () => {
    const video = { muted: false, playsInline: false, autoplay: false, srcObject: null, videoWidth: 640, videoHeight: 480, style: {}, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), remove: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(video as unknown as HTMLVideoElement);
    vi.spyOn(document.body, "appendChild").mockImplementation(node => node);
    await manager.load("webcam");

    mockStream.track.end();

    expect(manager.getTexture("webcam")).toBeNull();
    expect(manager.getVideoElement()).toBeUndefined();
    expect(video.srcObject).toBeNull();
    expect(textureBackend.destroyTexture).toHaveBeenCalledTimes(1);
  });

  it("cancels a delayed zero-dimension webcam wait during cleanup", async () => {
    const listeners = new Map<string, () => void>();
    const video = {
      muted: false, playsInline: false, autoplay: false, srcObject: null, videoWidth: 0, videoHeight: 0, style: {}, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), remove: vi.fn(),
      addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)), removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    };
    vi.spyOn(document, "createElement").mockReturnValue(video as unknown as HTMLVideoElement);
    vi.spyOn(document.body, "appendChild").mockImplementation(node => node);
    const pending = manager.load("webcam");
    await vi.waitFor(() => expect(video.addEventListener).toHaveBeenCalledWith("loadeddata", expect.any(Function), { once: true }));

    manager.cleanup();

    await expect(pending).resolves.toMatchObject({ texture: null, warning: expect.stringContaining("stopped") });
    expect(mockStream.track.stop).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("releases granted webcam capture when autoplay is rejected", async () => {
    const video = { muted: false, playsInline: false, autoplay: false, srcObject: null, videoWidth: 640, videoHeight: 480, style: {}, play: vi.fn().mockRejectedValue(new Error("blocked")), pause: vi.fn(), remove: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(video as unknown as HTMLVideoElement);
    vi.spyOn(document.body, "appendChild").mockImplementation(node => node);

    await expect(manager.load("webcam")).resolves.toMatchObject({ texture: null, warning: expect.stringContaining("blocked") });
    expect(mockStream.track.stop).toHaveBeenCalledTimes(1);
    expect(video.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps gesture retry listeners after rejected audio resume and removes them after success", async () => {
    mockContext.resume.mockRejectedValueOnce(new Error("not activated")).mockImplementationOnce(async () => {
      mockContext.state = "running";
    });
    await manager.load("microphone");
    await Promise.resolve();

    document.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();
    document.dispatchEvent(new Event("keydown"));

    expect(mockContext.resume).toHaveBeenCalledTimes(2);
  });

  it("REGRESSION: stops granted capture immediately when cleanup races a pending video play", async () => {
    let resolvePlay!: () => void;
    const video = { muted: false, playsInline: false, autoplay: false, srcObject: null, videoWidth: 640, videoHeight: 480, style: {}, play: vi.fn(() => new Promise<void>(resolve => {
      resolvePlay = resolve;
    })), pause: vi.fn(), remove: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(video as unknown as HTMLVideoElement);
    vi.spyOn(document.body, "appendChild").mockImplementation(node => node);
    const pending = manager.load("webcam");
    await Promise.resolve();
    await Promise.resolve();

    manager.cleanup();

    // Fails until provisional webcam ownership is registered before play().
    expect(mockStream.track.stop).toHaveBeenCalledTimes(1);
    resolvePlay();
    await pending;
  });
});
