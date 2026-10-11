import { describe, expect, it, vi } from "vitest";
import { VideoFrameGate } from "../../resources/VideoFrameGate";

describe("VideoFrameGate", () => {
  it("uploads each presented frame once and cancels callbacks on disposal", () => {
    let frame!: VideoFrameRequestCallback;
    const video = { currentTime: 0, requestVideoFrameCallback: vi.fn((callback: VideoFrameRequestCallback) => {
      frame = callback;
      return 7;
    }), cancelVideoFrameCallback: vi.fn() };
    const gate = new VideoFrameGate(video as unknown as HTMLVideoElement);
    expect(gate.needsUpload()).toBe(true);
    gate.uploaded();
    expect(gate.needsUpload()).toBe(false);
    frame(0, {} as VideoFrameCallbackMetadata);
    expect(gate.needsUpload()).toBe(true);
    gate.uploaded();
    expect(gate.needsUpload()).toBe(false);
    gate.dispose();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
    expect(gate.needsUpload()).toBe(false);
    frame(0, {} as VideoFrameCallbackMetadata);
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
  });

  it("falls back to media time and does not suppress a failed upload", () => {
    const video = { currentTime: 0 };
    const gate = new VideoFrameGate(video as HTMLVideoElement);
    expect(gate.needsUpload()).toBe(true);
    expect(gate.needsUpload()).toBe(true);
    gate.uploaded();
    expect(gate.needsUpload()).toBe(false);
    video.currentTime = 1;
    expect(gate.needsUpload()).toBe(true);
    gate.uploaded();
    expect(gate.needsUpload()).toBe(false);
  });
});
