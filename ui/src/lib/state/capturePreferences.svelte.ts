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

function loadPreferences(): CapturePreferences {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneDefaults();
    }
    const parsed = JSON.parse(raw) as StoredCapturePreferences;
    if (parsed.version !== 1 && parsed.version !== 2) {
      return cloneDefaults();
    }
    const migrateLegacyDefaults = parsed.version === 1;
    // Start time is 0 or a chosen value; an older saved "current" means 0.
    const startMode = (saved?: { startMode?: string }) => ({
      startMode: saved?.startMode === "custom" ? "custom" as const : "zero" as const,
    });
    return {
      version: 2,
      screenshot: {
        ...defaults.screenshot,
        ...parsed.screenshot,
        ...startMode(parsed.screenshot),
        ...(migrateLegacyDefaults ? { startMode: "zero" as const } : {}),
      },
      video: {
        ...defaults.video,
        ...parsed.video,
        ...startMode(parsed.video),
        ...(migrateLegacyDefaults ? { startMode: "zero" as const, fps: 0 } : {}),
      },
      gif: {
        ...defaults.gif,
        ...parsed.gif,
        ...startMode(parsed.gif),
        ...(migrateLegacyDefaults ? { startMode: "zero" as const } : {}),
      },
    };
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
