import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenCapture } from "../../resources/ScreenCapture";

function stream(video = true) {
  const listeners = new Map<string, () => void>();
  const track = { readyState: "live", stop: vi.fn(), addEventListener: vi.fn((name: string, fn: () => void) => listeners.set(name, fn)), removeEventListener: vi.fn((name: string) => listeners.delete(name)), end: () => listeners.get("ended")?.() };
  return { getTracks: () => [track], getVideoTracks: () => video ? [track] : [], getAudioTracks: () => [], track };
}
function host(request: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: request } });
}
afterEach(() => vi.unstubAllGlobals());

describe("ScreenCapture", () => {
  it('removes unwanted audio tracks and rejects an already-ended video', async () => {
    const source = stream();
    const audio = { stop: vi.fn() };
    const removeTrack = vi.fn();
    host(vi.fn().mockResolvedValue({ ...source, getAudioTracks: () => [audio], removeTrack }));
    const capture = new ScreenCapture();
    await expect(capture.start()).resolves.toBeUndefined();
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(removeTrack).toHaveBeenCalledWith(audio);
    capture.dispose();
    source.track.readyState = 'ended';
    host(vi.fn().mockResolvedValue(source));
    await expect(new ScreenCapture().start()).resolves.toContain('did not provide screen video');
  });

  it.each([
    new DOMException('blocked', 'SecurityError'),
    new DOMException('unavailable', 'NotReadableError'),
    new Error('picker failed'),
  ])('explains capture errors without retaining a source: %s', async (error) => {
    host(vi.fn().mockRejectedValue(error));
    const capture = new ScreenCapture();
    await expect(capture.start()).resolves.toContain(error instanceof DOMException && error.name === 'SecurityError' ? 'cancelled or denied' : 'could not start');
    expect(capture.acquire()).toBeNull();
  });
  it("requests video without audio only on explicit start and shares ownership", async () => {
    const capture = new ScreenCapture();
    const source = stream();
    const request = vi.fn().mockResolvedValue(source);
    host(request);
    expect(capture.acquire()).toBeNull();
    expect(request).not.toHaveBeenCalled();
    await expect(capture.start()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
    const first = capture.acquire();
    const second = capture.acquire();
    expect(first?.stream).toBe(source);
    first?.release();
    expect(source.track.stop).not.toHaveBeenCalled();
    second?.release();
    expect(source.track.stop).toHaveBeenCalledOnce();
  });

  it("releases all owners when the browser ends screen sharing", async () => {
    const capture = new ScreenCapture();
    const source = stream();
    host(vi.fn().mockResolvedValue(source));
    await capture.start();
    const ended = vi.fn();
    const lease = capture.acquire(ended);
    source.track.end();
    lease?.release();
    expect(ended).toHaveBeenCalledOnce();
    expect(source.track.stop).toHaveBeenCalledOnce();
    expect(capture.acquire()).toBeNull();
  });

  it("rejects a source with no video and stops every track", async () => {
    const capture = new ScreenCapture();
    const source = stream(false);
    host(vi.fn().mockResolvedValue(source));
    await expect(capture.start()).resolves.toContain("did not provide screen video");
    expect(source.track.stop).toHaveBeenCalledOnce();
  });

  it("reports permissions and unsupported hosts", async () => {
    host(vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")));
    await expect(new ScreenCapture().start()).resolves.toContain("cancelled or denied");
    vi.stubGlobal("navigator", {});
    await expect(new ScreenCapture().start()).resolves.toContain("localhost or HTTPS");
  });

  it("discards a late picker result after stop and cannot restart after disposal", async () => {
    let finish!: (value: ReturnType<typeof stream>) => void;
    host(vi.fn().mockImplementation(() => new Promise(resolve => {
      finish = resolve;
    })));
    const capture = new ScreenCapture();
    const request = capture.start();
    capture.stop();
    const source = stream();
    finish(source);
    await expect(request).resolves.toContain("stopped before");
    expect(source.track.stop).toHaveBeenCalledOnce();
    capture.dispose();
    await expect(capture.start()).resolves.toContain("no longer available");
  });
});
