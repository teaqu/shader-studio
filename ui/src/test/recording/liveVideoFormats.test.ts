import { canEncodeVideo } from "mediabunny";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveVideoMimeType, supportedLiveVideoFormats, probeLiveVideoFormats } from "../../lib/recording/liveVideoFormats";

vi.mock("mediabunny", () => ({ canEncodeVideo: vi.fn(async () => true), Quality: class {} }));
describe("liveVideoFormats", () => {
  it("offers WebCodecs MP4 even when MediaRecorder rejects MP4", async () => {
    vi.stubGlobal("VideoEncoder", {});
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    expect(await probeLiveVideoFormats(640, 360, 30)).toEqual(["mp4", "webm"]);
  });
  it("prefers AVC with enough bitrate headroom for detailed previews", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    expect(liveVideoMimeType("mp4")).toBe("video/mp4;codecs=avc1.640034");
  });
  it("falls back to VP8 when VP9 probing throws and excludes unsupported MP4", async () => {
    vi.stubGlobal("VideoEncoder", {});
    vi.mocked(canEncodeVideo).mockImplementation(async codec => {
      if (codec === "vp9") {
        throw new Error("unsupported");
      }
      return codec === "vp8";
    });
    expect(await probeLiveVideoFormats(641, 361, 24)).toEqual(["webm"]);
    expect(canEncodeVideo).toHaveBeenCalledWith("avc", expect.objectContaining({ width: 642, height: 362, frameRate: 24 }));
  });
  it("reports no formats when WebCodecs supports none and uses MediaRecorder without WebCodecs", async () => {
    vi.stubGlobal("VideoEncoder", {});
    vi.mocked(canEncodeVideo).mockResolvedValue(false);
    expect(await probeLiveVideoFormats(640, 360, 30)).toEqual([]);
    vi.stubGlobal("VideoEncoder", undefined);
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (mime: string) => mime.startsWith("video/webm") });
    expect(await probeLiveVideoFormats(640, 360, 30)).toEqual(["webm"]);
  });
  afterEach(() => {
    vi.mocked(canEncodeVideo).mockReset().mockResolvedValue(true);
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
