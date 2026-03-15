import { ShaderRecorder } from "./recording/ShaderRecorder";
import type { RecordingConfig, ScreenshotConfig, ShaderInfo } from "./recording/types";
import { recordingStore } from "./stores/recordingStore";

export class RecordingManager {
  private recorder = new ShaderRecorder();
  private unsubRecording: (() => void) | null = null;
  private _isRecording = false;
  private onStateChanged: ((isRecording: boolean) => void) | null = null;

  constructor(
    private getShaderContext: () => ShaderInfo,
    private sendFile: (blob: Blob, defaultName: string, filters: Record<string, string[]>) => void,
    onStateChanged?: (isRecording: boolean) => void,
  ) {
    this.onStateChanged = onStateChanged ?? null;
    this.unsubRecording = recordingStore.subscribe((s) => {
      this._isRecording = s.isRecording;
      this.onStateChanged?.(this._isRecording);
    });
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  async screenshot(config: ScreenshotConfig): Promise<void> {
    try {
      const shaderInfo = this.getShaderContext();
      const blob = await this.recorder.captureScreenshot(config, shaderInfo);
      const ext = config.format === "jpeg" ? "jpg" : "png";
      const defaultName = `shader-${new Date().toISOString().slice(0, 10)}.${ext}`;
      this.sendFile(blob, defaultName, { [config.format.toUpperCase()]: [ext] });
    } catch (err) {
      console.error("Screenshot failed:", err);
    }
  }

  async record(config: RecordingConfig): Promise<void> {
    try {
      const shaderInfo = this.getShaderContext();
      const blob = await this.recorder.record(config, shaderInfo);
      const ext = config.format === "gif" ? "gif" : config.format === "mp4" ? "mp4" : "webm";
      const defaultName = `shader-${new Date().toISOString().slice(0, 10)}.${ext}`;
      const label = config.format === "gif" ? "GIF" : config.format === "mp4" ? "MP4 Video" : "WebM Video";
      this.sendFile(blob, defaultName, { [label]: [ext] });
    } catch (err) {
      if ((err as Error).message !== "Recording cancelled") {
        console.error("Recording failed:", err);
      }
    }
  }

  cancel(): void {
    this.recorder.cancel();
  }

  dispose(): void {
    if (this.unsubRecording) {
      this.unsubRecording();
      this.unsubRecording = null;
    }
  }
}
