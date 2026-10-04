import { ShaderRecorder } from "./recording/ShaderRecorder";
import type { RecordingConfig, ScreenshotConfig, ShaderInfo } from "./recording/types";
import { recordingStore } from "./stores/recordingStore";
import type { RenderingEngineInterface as RenderingEngine } from "@shader-studio/rendering";

function buildCaptureFilename(shaderPath: string, extension: string, capturedAt = new Date()): string {
  const leaf = shaderPath.replaceAll("\\", "/").split("/").pop() ?? "";
  const withoutExtension = leaf.replace(/\.[^.]+$/, "");
  const safeBase = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "") || "shader";
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const timestamp = [
    `${capturedAt.getFullYear()}-${pad(capturedAt.getMonth() + 1)}-${pad(capturedAt.getDate())}`,
    `${pad(capturedAt.getHours())}-${pad(capturedAt.getMinutes())}-${pad(capturedAt.getSeconds())}-${pad(capturedAt.getMilliseconds(), 3)}`,
  ].join("_");
  return `${safeBase}-${timestamp}.${extension}`;
}

export class RecordingManager {
  private recorder = new ShaderRecorder();
  private unsubRecording: (() => void) | null = null;
  private _isRecording = false;
  private _isLive = false;
  private liveStopNotice: string | null = null;
  private onStateChanged: ((isRecording: boolean) => void) | null = null;

  constructor(
    private getShaderContext: () => ShaderInfo,
    private sendFile: (blob: Blob, defaultName: string, filters: Record<string, string[]>) => void | Promise<void>,
    onStateChanged?: (isRecording: boolean) => void,
    private getLiveEngine?: () => RenderingEngine,
  ) {
    this.onStateChanged = onStateChanged ?? null;
    this.unsubRecording = recordingStore.subscribe((s) => {
      this._isRecording = s.isRecording;
      this._isLive = s.isLive;
      this.onStateChanged?.(this._isRecording);
    });
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  get isLiveRecording(): boolean {
    return this._isLive;
  }

  async screenshot(config: ScreenshotConfig): Promise<void> {
    try {
      const shaderContext = this.getShaderContext();
      const capturedAt = new Date();
      const blob = config.mode === "live"
        ? await this.recorder.captureLiveScreenshot(config, this.requireLiveEngine())
        : await this.recorder.captureScreenshot(config, shaderContext);
      const ext = config.format === "jpeg" ? "jpg" : "png";
      const defaultName = buildCaptureFilename(shaderContext.path, ext, capturedAt);
      recordingStore.setSaving(config.format);
      await this.sendFile(blob, defaultName, { [config.format.toUpperCase()]: [ext] });
      const notice = this.recorder.consumeOutputNotice?.() ?? null;
      if (notice) {
        recordingStore.setNotice(notice);
      } else {
        recordingStore.reset();
      }
    } catch (err) {
      console.error("Screenshot failed:", err);
      recordingStore.setError(this.errorMessage(err));
    } finally {
      this.recorder.consumeOutputNotice?.();
    }
  }

  async record(config: RecordingConfig): Promise<void> {
    try {
      const shaderContext = this.getShaderContext();
      const capturedAt = new Date();
      const blob = config.mode === "live"
        ? await this.recorder.recordLive(config, this.requireLiveEngine())
        : await this.recorder.record(config, shaderContext);
      const ext = config.format === "gif" ? "gif" : config.format === "mp4" ? "mp4" : "webm";
      const defaultName = buildCaptureFilename(shaderContext.path, ext, capturedAt);
      const label = config.format === "gif" ? "GIF" : config.format === "mp4" ? "MP4 Video" : "WebM Video";
      recordingStore.setSaving(config.format);
      await this.sendFile(blob, defaultName, { [label]: [ext] });
      const notice = this.liveStopNotice ?? this.recorder.consumeOutputNotice?.() ?? null;
      if (notice) {
        recordingStore.setNotice(notice);
      } else {
        recordingStore.reset();
      }
    } catch (err) {
      if ((err as Error).message !== "Recording cancelled") {
        console.error("Recording failed:", err);
        recordingStore.setError(this.errorMessage(err));
      } else {
        recordingStore.reset();
      }
    } finally {
      this.liveStopNotice = null;
      // Never carry a notice from one capture over to the next.
      this.recorder.consumeOutputNotice?.();
    }
  }

  cancel(): void {
    this.recorder.cancel();
  }

  stopLiveRecording(): void {
    this.recorder.stopLiveRecording();
  }

  /**
   * End a Live recording the app can't continue (e.g. a different shader was
   * opened). What was recorded is kept and saved, and `notice` tells the user
   * why it stopped. Discarding is only ever the user's choice.
   */
  endLiveRecording(notice: string): void {
    if (!this._isLive) {
      return;
    }
    this.liveStopNotice = notice;
    this.recorder.stopLiveRecording();
  }

  private requireLiveEngine(): RenderingEngine {
    const engine = this.getLiveEngine?.();
    if (!engine) {
      throw new Error("Live capture is unavailable because the shader viewer is not ready");
    }
    return engine;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  dispose(): void {
    this.liveStopNotice = null;
    this.recorder.cancel();
    recordingStore.reset();
    if (this.unsubRecording) {
      this.unsubRecording();
      this.unsubRecording = null;
    }
  }
}
