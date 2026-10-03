import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemAudioCapture } from "../../resources/SystemAudioCapture";
import type { TextureBackend } from "../../resources/TextureBackend";
import { ResourceManager } from "../../resources/ResourceManager";
import { MICROPHONE_PATH, WEBCAM_PATH, SYSTEM_AUDIO_PATH } from "../../util/LiveInputConfig";

interface Texture { id: string }

const spies = vi.hoisted(() => ({
  live: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  video: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  audio: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}));

vi.mock("../../resources/LiveInputTextureManager", () => ({
  LiveInputTextureManager: vi.fn().mockImplementation(function() {
    const instance = {
      startAudioInput: vi.fn(), stopAudioInput: vi.fn(), startSystemAudio: vi.fn(), stopSystemAudio: vi.fn(), getPreview: vi.fn(), load: vi.fn(), getTexture: vi.fn(), getVideoElement: vi.fn(), getAudioState: vi.fn(),
      getSampleRate: vi.fn(() => 0), updateTextures: vi.fn(), cleanup: vi.fn(),
    };
    spies.live.push(instance);
    return instance;
  }),
}));

vi.mock("../../resources/TextureCache", () => ({
  TextureCache: vi.fn().mockImplementation(function() {
    return ({
      getImageTextureCache: vi.fn(() => ({})), getDefaultTexture: vi.fn(() => null),
      removeCachedTexture: vi.fn(), cacheTexture: vi.fn(), loadTextureFromUrl: vi.fn(), cleanup: vi.fn(), dispose: vi.fn(),
    });
  }),
}));

vi.mock("../../resources/VideoTextureManager", () => ({
  VideoTextureManager: vi.fn().mockImplementation(function() {
    const instance = {
      loadVideoTexture: vi.fn(), getVideoTexture: vi.fn(), getVideoElement: vi.fn(), updateTextures: vi.fn(), cleanup: vi.fn(),
      pauseAll: vi.fn(), resumeAll: vi.fn(), syncAllToTime: vi.fn(), resumeVideo: vi.fn(), pauseVideo: vi.fn(), muteVideo: vi.fn(), unmuteVideo: vi.fn(), resetVideo: vi.fn(), setGlobalAudioState: vi.fn(), isVideoPaused: vi.fn(), isVideoMuted: vi.fn(),
    };
    spies.video.push(instance);
    return instance;
  }),
}));

vi.mock("../../resources/AudioTextureManager", () => ({
  AudioTextureManager: vi.fn().mockImplementation(function() {
    const instance = {
      loadAudioSource: vi.fn(), resumeAudioContext: vi.fn(), updateLoopRegion: vi.fn(), getAudioTexture: vi.fn(), getAudioFFTData: vi.fn(), updateTextures: vi.fn(), getSampleRate: vi.fn(() => 44100), resumeAudio: vi.fn(), pauseAudio: vi.fn(), muteAudio: vi.fn(), unmuteAudio: vi.fn(), resetAudio: vi.fn(), seekAudio: vi.fn(), getAudioDuration: vi.fn(), isAudioPaused: vi.fn(), isAudioMuted: vi.fn(), getAudioCurrentTime: vi.fn(), pauseAll: vi.fn(), resumeAll: vi.fn(), syncAllToTime: vi.fn(), setGlobalAudioState: vi.fn(), cleanup: vi.fn(),
    };
    spies.audio.push(instance);
    return instance;
  }),
}));

vi.mock("../../resources/CubemapTextureManager", () => ({ CubemapTextureManager: vi.fn().mockImplementation(function() {
  return ({ getCubemapTexture: vi.fn(), loadCubemapFromCrossImage: vi.fn(), cleanup: vi.fn() });
}) }));
vi.mock("../../resources/ShaderKeyboardInput", () => ({ ShaderKeyboardInput: vi.fn().mockImplementation(function() {
  return ({ getKeyboardTexture: vi.fn(), updateKeyboardTexture: vi.fn(), cleanup: vi.fn() });
}) }));

const backend: TextureBackend<Texture> = { createTexture: vi.fn(), createTextureFromImage: vi.fn(), createMipmaps: vi.fn(), updateTexture: vi.fn(), updateTextureFromImage: vi.fn(), destroyTexture: vi.fn() };

describe("ResourceManager live input routing", () => {
  let resources: ResourceManager<Texture>;

  beforeEach(() => {
    spies.live.length = 0;
    spies.video.length = 0;
    spies.audio.length = 0;
    vi.clearAllMocks();
    resources = new ResourceManager(backend);
  });

  it("holds shared audio across structural rebuilds until the new analyser acquires it", async () => {
    const capture = new SystemAudioCapture();
    const release = vi.fn();
    const acquire = vi.spyOn(capture, "acquire").mockReturnValue({ stream: {} as MediaStream, release });
    const manager = new ResourceManager(backend, capture);
    manager.cleanup(true);
    expect(acquire).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    spies.live.at(-1)!.load.mockResolvedValue({ texture: { id: "shared" } });
    await manager.loadAudioSource(SYSTEM_AUDIO_PATH);
    expect(release).toHaveBeenCalledOnce();
    manager.cleanup();
    acquire.mockRestore();
  });

  it("selects Audio devices only for configured channels and retains choice across rebuilds", async () => {
    await expect(resources.controlAudioInput("start", "loopback")).resolves.toContain("loading");
    spies.live[0].load.mockResolvedValue({ texture: { id: "audio" } });
    await resources.loadAudioSource(MICROPHONE_PATH);
    await resources.controlAudioInput("start", "loopback");
    expect(spies.live[0].startAudioInput).toHaveBeenCalledWith("loopback");
    const next = resources.createIsolated();
    spies.live.at(-1)!.load.mockResolvedValue({ texture: { id: "next" } });
    await next.loadAudioSource(MICROPHONE_PATH);
    expect(spies.live.at(-1)!.load).toHaveBeenCalledWith("microphone", { deviceId: "loopback" });
    await resources.controlAudioInput("stop");
    expect(spies.live[0].stopAudioInput).toHaveBeenCalledOnce();
  });

  it("exposes the Firefox limitation to Browser Audio controls", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Firefox/159.0");
    spies.live[0].load.mockResolvedValue({ texture: null });
    await resources.loadAudioSource(SYSTEM_AUDIO_PATH);
    expect(resources.getLiveInputPreview("system-audio")?.unsupportedReason).toContain("Firefox does not support");
    vi.restoreAllMocks();
  });

  it("only starts system audio for configured channels and routes their runtime state", async () => {
    await expect(resources.controlSystemAudio("start")).resolves.toContain("loading");
    spies.live[0].load.mockResolvedValue({ texture: null });
    await expect(resources.loadAudioSource(SYSTEM_AUDIO_PATH)).resolves.toBeNull();
    expect(spies.live[0].load).toHaveBeenCalledWith("system-audio");
    spies.live[0].startSystemAudio.mockResolvedValue(undefined);
    await expect(resources.controlSystemAudio("start", "loopback")).resolves.toBeUndefined();
    expect(spies.live[0].startSystemAudio).toHaveBeenCalledWith("loopback");
    spies.live[0].getTexture.mockReturnValue({ id: "system" });
    expect(resources.getAudioTexture(SYSTEM_AUDIO_PATH)).toEqual({ id: "system" });
    resources.getAudioState(SYSTEM_AUDIO_PATH);
    expect(spies.live[0].getAudioState).toHaveBeenCalledWith("system-audio");
    await resources.controlSystemAudio("stop");
    expect(spies.live[0].stopSystemAudio).toHaveBeenCalledOnce();
  });

  it("exposes existing capture previews without loading resources", () => {
    const preview = { frequency: new Uint8Array(512) };
    spies.live[0].getPreview.mockReturnValue(preview);
    expect(resources.getLiveInputPreview("microphone")).toBe(preview);
    expect(spies.live[0].getPreview).toHaveBeenCalledWith("microphone");
    expect(spies.live[0].load).not.toHaveBeenCalled();
  });

  it("stops removed live inputs even when file media is retained", async () => {
    spies.live[0].load.mockResolvedValue({ texture: { id: "device" } });
    await resources.loadVideoTexture(WEBCAM_PATH);
    await resources.loadAudioSource(MICROPHONE_PATH);
    resources.retainLiveInputs(new Set([WEBCAM_PATH, MICROPHONE_PATH]));
    expect(spies.live[0].cleanup).not.toHaveBeenCalled();
    resources.retainLiveInputs(new Set([MICROPHONE_PATH]));
    expect(spies.live[0].cleanup).toHaveBeenCalledTimes(1);
    expect(spies.video[0].cleanup).not.toHaveBeenCalled();
    expect(spies.audio[0].cleanup).not.toHaveBeenCalled();
    spies.live[1].load.mockResolvedValue({ texture: { id: "microphone" } });
    await resources.loadAudioSource(MICROPHONE_PATH);
    resources.retainLiveInputs(new Set());
    expect(spies.live[1].cleanup).toHaveBeenCalledTimes(1);
    resources.retainLiveInputs(new Set());
    expect(spies.live).toHaveLength(3);
  });

  it("forwards webcam loads and their warning without involving file video", async () => {
    const warning = "Webcam permission was denied.";
    spies.live[0].load.mockResolvedValue({ texture: null, warning });

    await expect(resources.loadVideoTexture(WEBCAM_PATH, { filter: "nearest" })).resolves.toEqual({ texture: null, warning });

    expect(spies.live[0].load).toHaveBeenCalledWith("webcam", { filter: "nearest" });
    expect(spies.video[0].loadVideoTexture).not.toHaveBeenCalled();
  });

  it("turns microphone warnings into actionable loading errors", async () => {
    spies.live[0].load.mockResolvedValue({ texture: null, warning: "Microphone permission was denied." });

    await expect(resources.loadAudioSource(MICROPHONE_PATH)).rejects.toThrow("Microphone permission was denied.");

    expect(spies.live[0].load).toHaveBeenCalledWith("microphone", { deviceId: "default" });
    expect(spies.audio[0].loadAudioSource).not.toHaveBeenCalled();
  });

  it("routes live identities to their live getters and prefers microphone sample rate", () => {
    const webcam = { id: "webcam" };
    const microphone = { id: "microphone" };
    const video = { currentTime: 2 } as HTMLVideoElement;
    const state = { paused: false, muted: true, currentTime: 4, duration: 0 };
    spies.live[0].getTexture.mockImplementation((type: string) => type === "webcam" ? webcam : microphone);
    spies.live[0].getVideoElement.mockReturnValue(video);
    spies.live[0].getAudioState.mockReturnValue(state);
    spies.live[0].getSampleRate.mockReturnValue(48000);

    expect(resources.getVideoTexture(WEBCAM_PATH)).toBe(webcam);
    expect(resources.getAudioTexture(MICROPHONE_PATH)).toBe(microphone);
    expect(resources.getVideoElement(WEBCAM_PATH)).toBe(video);
    expect(resources.getAudioState(MICROPHONE_PATH)).toBe(state);
    expect(resources.getAudioSampleRate()).toBe(48000);
  });

  it("updates live capture once per frame alongside file video, while preserving file paths", async () => {
    const fileTexture = { id: "file" };
    spies.video[0].getVideoTexture.mockReturnValue(fileTexture);
    spies.audio[0].getAudioTexture.mockReturnValue(fileTexture);
    spies.video[0].loadVideoTexture.mockResolvedValue(fileTexture);
    spies.audio[0].loadAudioSource.mockResolvedValue(fileTexture);

    resources.updateVideoTextures();
    expect(spies.video[0].updateTextures).toHaveBeenCalledTimes(1);
    expect(spies.live[0].updateTextures).toHaveBeenCalledTimes(1);
    expect(resources.getVideoTexture("clip.webm")).toBe(fileTexture);
    expect(resources.getAudioTexture("music.ogg")).toBe(fileTexture);
    await expect(resources.loadVideoTexture("clip.webm")).resolves.toEqual({ texture: fileTexture });
    await expect(resources.loadAudioSource("music.ogg")).resolves.toBe(fileTexture);
  });

  it("replaces the capture owner during cleanup, isolating late old loads from reuse", async () => {
    let resolveOld!: (value: { texture: Texture; warning?: string }) => void;
    spies.live[0].load.mockImplementation(() => new Promise(resolve => {
      resolveOld = resolve;
    }));
    const oldRequest = resources.loadVideoTexture(WEBCAM_PATH);

    resources.cleanup();
    expect(spies.live[0].cleanup).toHaveBeenCalledTimes(1);
    expect(spies.live).toHaveLength(2);
    spies.live[1].getTexture.mockReturnValue({ id: "new" });
    resolveOld({ texture: { id: "old" } });

    await expect(oldRequest).resolves.toEqual({ texture: { id: "old" } });
    expect(resources.getVideoTexture(WEBCAM_PATH)).toEqual({ id: "new" });
  });
});
