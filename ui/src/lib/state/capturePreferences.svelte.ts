export interface ScreenshotCapturePreferences {
  format: "png" | "jpeg";
  mode: "live" | "render";
  startMode: "zero" | "custom";
  customTime: string;
  resolution: "current" | "480p" | "720p" | "1080p" | "4k" | "custom";
  customWidth: string;
  customHeight: string;
}

export interface VideoCapturePreferences {
  format: "webm" | "mp4";
  mode: "live" | "render";
  duration: number;
  startMode: "zero" | "custom";
  customStartTime: string;
  fps: number;
  customFps: string;
  resolution: "current" | "720p" | "1080p" | "4k" | "custom";
  customWidth: string;
  customHeight: string;
}

export interface GifCapturePreferences {
  duration: number;
  startMode: "zero" | "custom";
  customStartTime: string;
  fps: number;
  customFps: string;
  resolution: "current" | "480p" | "720p" | "1080p" | "custom";
  customWidth: string;
  customHeight: string;
  loopCount: number;
  quality: number;
  customQuality: string;
}

interface CapturePreferences {
  version: 2;
  screenshot: ScreenshotCapturePreferences;
  video: VideoCapturePreferences;
  gif: GifCapturePreferences;
}

interface StoredCapturePreferences {
  version?: number;
  screenshot?: Partial<ScreenshotCapturePreferences>;
  video?: Partial<VideoCapturePreferences>;
  gif?: Partial<GifCapturePreferences>;
}

const STORAGE_KEY = "shader-studio-capture-preferences";

const defaults: CapturePreferences = {
  version: 2,
  screenshot: {
    format: "png",
    mode: "live",
    startMode: "zero",
    customTime: "",
    resolution: "current",
    customWidth: "",
    customHeight: "",
  },
  video: {
    format: "mp4",
    mode: "live",
    duration: 5,
    startMode: "zero",
    customStartTime: "",
    fps: 0,
    customFps: "",
    resolution: "current",
    customWidth: "",
    customHeight: "",
  },
  gif: {
    duration: 3,
    startMode: "zero",
    customStartTime: "",
    fps: 15,
    customFps: "",
    resolution: "current",
    customWidth: "",
    customHeight: "",
    loopCount: 0,
    quality: 100,
    customQuality: "",
  },
};

function cloneDefaults(): CapturePreferences {
  return structuredClone(defaults);
}

// Restored values come from storage that older versions, other hosts or a
// user may have written, so every field is checked. Anything missing, of
// the wrong type, non-finite or out of range falls back to its default.
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function numberIn(value: unknown, min: number, max: number, fallback: number, integer = false): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isInteger(value))
    ? value
    : fallback;
}

/** Text fields hold what the user typed into a number input; keep them short. */
function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length <= 16 ? value : fallback;
}

function captureMode(value: unknown, fallback: "live" | "render"): "live" | "render" {
  // "Offscreen" was the earlier name for Render.
  if (value === "render" || value === "offscreen" || value === "Offscreen") {
    return "render";
  }
  return value === "live" ? "live" : fallback;
}

/** Start time is 0 or a chosen value; an older saved "current" means 0. */
function startMode(value: unknown): "zero" | "custom" {
  return value === "custom" ? "custom" : "zero";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function restoreScreenshot(stored: Record<string, unknown>): ScreenshotCapturePreferences {
  const d = defaults.screenshot;
  return {
    format: oneOf(stored.format, ["png", "jpeg"] as const, d.format),
    mode: captureMode(stored.mode, d.mode),
    startMode: startMode(stored.startMode),
    customTime: text(stored.customTime, d.customTime),
    resolution: oneOf(stored.resolution, ["current", "480p", "720p", "1080p", "4k", "custom"] as const, d.resolution),
    customWidth: text(stored.customWidth, d.customWidth),
    customHeight: text(stored.customHeight, d.customHeight),
  };
}

function restoreVideo(stored: Record<string, unknown>): VideoCapturePreferences {
  const d = defaults.video;
  return {
    format: oneOf(stored.format, ["webm", "mp4"] as const, d.format),
    mode: captureMode(stored.mode, d.mode),
    duration: numberIn(stored.duration, 0.5, 120, d.duration),
    startMode: startMode(stored.startMode),
    customStartTime: text(stored.customStartTime, d.customStartTime),
    // 0 means "Screen" (the display's rate).
    fps: numberIn(stored.fps, 0, 120, d.fps, true),
    customFps: text(stored.customFps, d.customFps),
    resolution: oneOf(stored.resolution, ["current", "720p", "1080p", "4k", "custom"] as const, d.resolution),
    customWidth: text(stored.customWidth, d.customWidth),
    customHeight: text(stored.customHeight, d.customHeight),
  };
}

function restoreGif(stored: Record<string, unknown>): GifCapturePreferences {
  const d = defaults.gif;
  return {
    duration: numberIn(stored.duration, 0.5, 30, d.duration),
    startMode: startMode(stored.startMode),
    customStartTime: text(stored.customStartTime, d.customStartTime),
    fps: numberIn(stored.fps, 1, 60, d.fps, true),
    customFps: text(stored.customFps, d.customFps),
    resolution: oneOf(stored.resolution, ["current", "480p", "720p", "1080p", "custom"] as const, d.resolution),
    customWidth: text(stored.customWidth, d.customWidth),
    customHeight: text(stored.customHeight, d.customHeight),
    // 0 loops forever, -1 plays once, N repeats N times.
    loopCount: numberIn(stored.loopCount, -1, 100, d.loopCount, true),
    quality: numberIn(stored.quality, 1, 100, d.quality, true),
    customQuality: text(stored.customQuality, d.customQuality),
  };
}

function loadPreferences(): CapturePreferences {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneDefaults();
    }
    const parsed = record(JSON.parse(raw)) as StoredCapturePreferences;
    if (parsed.version !== 1 && parsed.version !== 2) {
      return cloneDefaults();
    }
    const restored: CapturePreferences = {
      version: 2,
      screenshot: restoreScreenshot(record(parsed.screenshot)),
      video: restoreVideo(record(parsed.video)),
      gif: restoreGif(record(parsed.gif)),
    };
    if (parsed.version === 1) {
      // Version 1 start times and video rate were earlier defaults, not
      // choices: start at 0 and match the screen rate.
      restored.screenshot.startMode = "zero";
      restored.video.startMode = "zero";
      restored.gif.startMode = "zero";
      restored.video.fps = 0;
    }
    return restored;
  } catch {
    return cloneDefaults();
  }
}

let preferences = $state<CapturePreferences>(loadPreferences());

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are optional in sandboxed or storage-disabled hosts.
  }
}

export function getScreenshotCapturePreferences(): ScreenshotCapturePreferences {
  return { ...preferences.screenshot };
}

export function updateScreenshotCapturePreferences(next: ScreenshotCapturePreferences): void {
  preferences.screenshot = { ...next };
  persist();
}

export function getVideoCapturePreferences(): VideoCapturePreferences {
  return { ...preferences.video };
}

export function updateVideoCapturePreferences(next: VideoCapturePreferences): void {
  preferences.video = { ...next };
  persist();
}

export function getGifCapturePreferences(): GifCapturePreferences {
  return { ...preferences.gif };
}

export function updateGifCapturePreferences(next: GifCapturePreferences): void {
  preferences.gif = { ...next };
  persist();
}

export function resetCapturePreferences(): void {
  preferences = cloneDefaults();
  persist();
}
