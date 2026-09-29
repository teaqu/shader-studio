import { beforeEach, describe, expect, it, vi } from "vitest";

describe("capture preferences", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
      clear: vi.fn(() => values.clear()),
      key: vi.fn(() => null),
      length: 0,
    });
  });

  it("treats a saved 'current' start mode as 0 and keeps a custom start time", async () => {
    values.set("shader-studio-capture-preferences", JSON.stringify({
      version: 2,
      screenshot: { startMode: "current", customTime: "4" },
      video: { startMode: "custom", customStartTime: "12.5" },
      gif: { startMode: "current" },
    }));

    const preferences = await import("../../lib/state/capturePreferences.svelte");

    expect(preferences.getScreenshotCapturePreferences().startMode).toBe("zero");
    expect(preferences.getVideoCapturePreferences()).toMatchObject({ startMode: "custom", customStartTime: "12.5" });
    expect(preferences.getGifCapturePreferences().startMode).toBe("zero");
  });

  it("persists settings independently for each output", async () => {
    const preferences = await import("../../lib/state/capturePreferences.svelte");
    preferences.updateScreenshotCapturePreferences({
      ...preferences.getScreenshotCapturePreferences(),
      format: "jpeg",
      mode: "render",
    });
    preferences.updateVideoCapturePreferences({
      ...preferences.getVideoCapturePreferences(),
      format: "webm",
      fps: 60,
    });
    preferences.updateGifCapturePreferences({
      ...preferences.getGifCapturePreferences(),
      quality: 80,
      loopCount: -1,
    });

    vi.resetModules();
    const reloaded = await import("../../lib/state/capturePreferences.svelte");

    expect(reloaded.getScreenshotCapturePreferences()).toMatchObject({ format: "jpeg", mode: "render" });
    expect(reloaded.getVideoCapturePreferences()).toMatchObject({ format: "webm", fps: 60 });
    expect(reloaded.getGifCapturePreferences()).toMatchObject({ quality: 80, loopCount: -1 });
  });

  it("falls back to safe defaults when stored data is invalid", async () => {
    values.set("shader-studio-capture-preferences", "not JSON");

    const preferences = await import("../../lib/state/capturePreferences.svelte");

    expect(preferences.getScreenshotCapturePreferences()).toMatchObject({ format: "png", mode: "live", startMode: "zero" });
    expect(preferences.getVideoCapturePreferences()).toMatchObject({ format: "mp4", mode: "live", startMode: "zero", fps: 0 });
    expect(preferences.getGifCapturePreferences()).toMatchObject({ quality: 100, loopCount: 0 });
  });

  it("migrates the original current-time and 30fps defaults", async () => {
    values.set("shader-studio-capture-preferences", JSON.stringify({
      version: 1,
      screenshot: { startMode: "current" },
      video: { startMode: "current", fps: 30 },
      gif: { startMode: "current" },
    }));

    const preferences = await import("../../lib/state/capturePreferences.svelte");

    expect(preferences.getScreenshotCapturePreferences().startMode).toBe("zero");
    expect(preferences.getVideoCapturePreferences()).toMatchObject({ startMode: "zero", fps: 0 });
    expect(preferences.getGifCapturePreferences().startMode).toBe("zero");
  });
});
