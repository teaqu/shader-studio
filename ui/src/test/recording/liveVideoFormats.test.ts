import { afterEach, describe, expect, it, vi } from "vitest";
import { liveVideoMimeType, supportedLiveVideoFormats, probeLiveVideoFormats } from "../../lib/recording/liveVideoFormats";

describe("liveVideoFormats", () => {
  it("prefers Shadertoy's H264 WebM before VP9 and VP8", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    expect(liveVideoMimeType("webm")).toBe("video/webm;codecs=h264");
  });
  it("offers native WebM even when WebCodecs is unavailable", async () => {
    vi.stubGlobal("VideoEncoder", {});
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (mime: string) => mime === "video/webm;codecs=h264" });
    expect(await probeLiveVideoFormats(948, 534, 60)).toEqual(["webm"]);
  });
  it("does not offer MP4 when native MediaRecorder rejects it, even with WebCodecs", async () => {
    vi.stubGlobal("VideoEncoder", {});
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (mime: string) => mime.startsWith("video/webm") });
    expect(await probeLiveVideoFormats(640, 360, 30)).toEqual(["webm"]);
  });
  it("uses the native AVC MIME type for MP4", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    expect(liveVideoMimeType("mp4")).toBe("video/mp4;codecs=avc1");
  });
  it("uses native support directly without probing WebCodecs codecs", async () => {
    vi.stubGlobal("VideoEncoder", {});
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (mime: string) => mime === "video/webm;codecs=vp8" });
    expect(await probeLiveVideoFormats(641, 361, 24)).toEqual(["webm"]);
  });
  it("reports no formats when native MediaRecorder supports none", async () => {
    vi.stubGlobal("VideoEncoder", {});
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    expect(await probeLiveVideoFormats(640, 360, 30)).toEqual([]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks the first MIME type the host reports as supported", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (type: string) => type === "video/webm;codecs=vp8" || type === "video/mp4",
    });

    expect(liveVideoMimeType("webm")).toBe("video/webm;codecs=vp8");
    expect(liveVideoMimeType("mp4")).toBe("video/mp4");
    expect(supportedLiveVideoFormats()).toEqual(["mp4", "webm"]);
  });

  it("reports nothing when MediaRecorder is missing or throws", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(supportedLiveVideoFormats()).toEqual([]);

    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => {
      throw new Error("blocked");
    } });
    expect(liveVideoMimeType("webm")).toBeNull();
  });
});
