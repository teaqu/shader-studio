import { afterEach, describe, expect, it, vi } from "vitest";
import { liveVideoMimeType, supportedLiveVideoFormats } from "../../lib/recording/liveVideoFormats";

describe("liveVideoFormats", () => {
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
