import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureSaveChannel, shaderMessageEndsLiveRecording } from "../../lib/recording/captureSaveChannel";

describe("CaptureSaveChannel", () => {
  let posted: Array<{ requestId: string; defaultName: string }>;
  let channel: CaptureSaveChannel;

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    channel = new CaptureSaveChannel((request) => posted.push(request), 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts a labelled request and resolves only on its own reply", async () => {
    const save = channel.save("AA==", "shader.png", { PNG: ["png"] });
    const settled = vi.fn();
    save.then(settled, settled);

    expect(posted).toEqual([expect.objectContaining({ defaultName: "shader.png", requestId: "capture-save-1" })]);
    expect(channel.handleResult({ success: true, requestId: "capture-save-99" })).toBe(false);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    expect(channel.handleResult({ success: true, requestId: "capture-save-1" })).toBe(true);
    await expect(save).resolves.toBeUndefined();
  });

  it("treats a dismissed dialog as success and a host error as a failure", async () => {
    const cancelled = channel.save("AA==", "a.png", {});
    channel.handleResult({ success: false, cancelled: true, requestId: "capture-save-1" });
    await expect(cancelled).resolves.toBeUndefined();

    const failed = channel.save("AA==", "b.png", {});
    channel.handleResult({ success: false, error: "EACCES", requestId: "capture-save-2" });
    await expect(failed).rejects.toThrow("EACCES");
  });

  it("accepts an unlabelled reply from an older host for the outstanding save", async () => {
    const save = channel.save("AA==", "a.png", {});
    channel.handleResult({ success: true });
    await expect(save).resolves.toBeUndefined();
  });

  it("frees the slot after a lost reply so the next capture can save", async () => {
    const lost = channel.save("AA==", "a.png", {});
    lost.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    await expect(lost).rejects.toThrow("timed out");

    const retry = channel.save("AA==", "b.png", {});
    channel.handleResult({ success: true, requestId: "capture-save-2" });
    await expect(retry).resolves.toBeUndefined();
  });

  it("lets a newer save supersede one whose reply never arrived", async () => {
    const stale = channel.save("AA==", "a.png", {});
    stale.catch(() => {});
    const next = channel.save("AA==", "b.png", {});

    await expect(stale).rejects.toThrow("did not complete");
    channel.handleResult({ success: true, requestId: "capture-save-1" });
    channel.handleResult({ success: true, requestId: "capture-save-2" });
    await expect(next).resolves.toBeUndefined();
  });

  it("rejects the outstanding save on dispose", async () => {
    const save = channel.save("AA==", "a.png", {});
    channel.dispose();
    await expect(save).rejects.toThrow("viewer closed");
  });
});

describe("shaderMessageEndsLiveRecording", () => {
  const samePath = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();

  it("keeps recording through a hot reload of the same shader", () => {
    expect(shaderMessageEndsLiveRecording("main", "/A/shader.glsl", "/a/shader.glsl", samePath)).toBe(false);
  });

  it("ends the recording when a different main shader is opened", () => {
    expect(shaderMessageEndsLiveRecording("main", "/a/other.glsl", "/a/shader.glsl", samePath)).toBe(true);
  });

  it("ignores buffer and vertex updates", () => {
    expect(shaderMessageEndsLiveRecording("buffer", "/a/bufferA.glsl", "/a/shader.glsl", samePath)).toBe(false);
    expect(shaderMessageEndsLiveRecording("vertex", "/a/mesh.vert", "/a/shader.glsl", samePath)).toBe(false);
  });
});
