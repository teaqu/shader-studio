import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemAudioCapture } from "../../resources/SystemAudioCapture";

function makeTrack(kind: "audio" | "video") {
  const listeners = new Map<string, () => void>();
  return {
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    end: () => listeners.get("ended")?.(),
  };
}

function makeStream({ audio = 1, video = 1 } = {}) {
  const audioTracks = Array.from({ length: audio }, () => makeTrack("audio"));
  const videoTracks = Array.from({ length: video }, () => makeTrack("video"));
  const tracks = [...audioTracks, ...videoTracks];
  return {
    getTracks: vi.fn(() => tracks),
    getAudioTracks: vi.fn(() => audioTracks),
    getVideoTracks: vi.fn(() => videoTracks),
    removeTrack: vi.fn((track: unknown) => {
      const index = tracks.indexOf(track as typeof tracks[number]);
      if (index >= 0) {
        tracks.splice(index, 1);
      }
    }),
    audioTracks,
    videoTracks,
  };
}

describe("SystemAudioCapture", () => {
  let capture: SystemAudioCapture;
  let getDisplayMedia: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    capture = new SystemAudioCapture();
    getDisplayMedia = vi.fn();
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia, getUserMedia },
    });
  });

  afterEach(() => {
    capture.dispose();
    vi.restoreAllMocks();
  });

  it("explains Firefox audio sharing support without opening a screen-only picker", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Firefox/159.0");
    getDisplayMedia.mockResolvedValue(makeStream({ audio: 0 }));
    await expect(capture.start()).resolves.toContain("Firefox does not support");
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(capture.acquire()).toBeNull();
  });

  it("shares one audio source between leases and stops it after the final release", async () => {
    const stream = makeStream();
    getDisplayMedia.mockResolvedValue(stream);

    await expect(capture.start()).resolves.toBeUndefined();
    const first = capture.acquire();
    const second = capture.acquire();

    expect(first?.stream).toBe(stream);
    expect(second?.stream).toBe(stream);
    expect(stream.videoTracks[0].stop).toHaveBeenCalledTimes(1);
    expect(stream.removeTrack).toHaveBeenCalledWith(stream.videoTracks[0]);

    first?.release();
    expect(stream.audioTracks[0].stop).not.toHaveBeenCalled();
    second?.release();
    expect(stream.audioTracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it("requests display capture with system audio hints", async () => {
    const stream = makeStream({ video: 0 });
    getDisplayMedia.mockResolvedValue(stream);

    await capture.start();

    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: true,
      audio: true,
      systemAudio: "include",
      selfBrowserSurface: "exclude",
    });
  });

  it("uses the default audio constraint or exact requested device", async () => {
    const first = makeStream({ video: 0 });
    const second = makeStream({ video: 0 });
    getUserMedia.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await capture.start("default");
    await capture.start("usb-mic");

    expect(getUserMedia).toHaveBeenNthCalledWith(1, { video: false, audio: true });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { video: false, audio: { deviceId: { exact: "usb-mic" } } });
    expect(first.audioTracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it("stops all tracks and explains when the shared source contains no audio", async () => {
    const stream = makeStream({ audio: 0, video: 1 });
    getDisplayMedia.mockResolvedValue(stream);

    await expect(capture.start()).resolves.toContain("did not provide audio");

    expect(stream.videoTracks[0].stop).toHaveBeenCalledTimes(1);
    expect(capture.acquire()).toBeNull();
  });

  it("notifies leases when browser sharing ends", async () => {
    const stream = makeStream({ video: 0 });
    const ended = vi.fn();
    getDisplayMedia.mockResolvedValue(stream);
    await capture.start();
    const lease = capture.acquire(ended);

    stream.audioTracks[0].end();

    expect(ended).toHaveBeenCalledTimes(1);
    expect(stream.audioTracks[0].stop).toHaveBeenCalledTimes(1);
    lease?.release();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(capture.acquire()).toBeNull();
  });

  it("replaces an active share, notifies its leases, and stops the old stream", async () => {
    const oldStream = makeStream({ video: 0 });
    const replacement = makeStream({ video: 0 });
    const ended = vi.fn();
    getDisplayMedia.mockResolvedValueOnce(oldStream).mockResolvedValueOnce(replacement);
    await capture.start();
    capture.acquire(ended);

    await capture.start();

    expect(ended).toHaveBeenCalledTimes(1);
    expect(oldStream.audioTracks[0].stop).toHaveBeenCalledTimes(1);
    expect(capture.acquire()?.stream).toBe(replacement);
  });

  it("stops a late stream when a newer request replaces it", async () => {
    let resolveOld!: (stream: ReturnType<typeof makeStream>) => void;
    const oldRequest = new Promise<ReturnType<typeof makeStream>>(resolve => {
      resolveOld = resolve;
    });
    const replacement = makeStream({ video: 0 });
    const oldStream = makeStream({ video: 0 });
    getDisplayMedia.mockReturnValueOnce(oldRequest).mockResolvedValueOnce(replacement);

    const oldStart = capture.start();
    await capture.start();
    resolveOld(oldStream);

    await expect(oldStart).resolves.toContain("stopped before");
    expect(oldStream.audioTracks[0].stop).toHaveBeenCalledTimes(1);
    expect(capture.acquire()?.stream).toBe(replacement);
  });

  it("returns an actionable warning when sharing is cancelled", async () => {
    getDisplayMedia.mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));

    await expect(capture.start()).resolves.toContain("cancelled or denied");
  });
});
