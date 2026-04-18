import { RenderingEngine } from "../../../../rendering/src/RenderingEngine";
import { GifEncoderWrapper } from "./GifEncoder";
import { VideoEncoderWrapper } from "./VideoEncoder";
import { recordingStore } from "../stores/recordingStore";
import type { ScreenshotConfig, RecordingConfig, ShaderInfo } from "./types";

export type { ScreenshotConfig, RecordingConfig, ShaderInfo };

export class ShaderRecorder {
  private cancelled = false;
  private offscreenEngine: RenderingEngine | null = null;
  private activeGifEncoder: GifEncoderWrapper | null = null;

  private createOffscreenEngine(width: number, height: number): { canvas: HTMLCanvasElement; engine: RenderingEngine } {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    // Position offscreen instead of display:none so WebGL rendering works
    canvas.style.position = "fixed";
    canvas.style.left = "-9999px";
    canvas.style.top = "-9999px";
    canvas.style.pointerEvents = "none";
    document.body.appendChild(canvas);

    const engine = new RenderingEngine();
    engine.initialize(canvas, true);
    engine.handleCanvasResize(width, height);

    return { canvas, engine };
  }

  private disposeOffscreen(canvas: HTMLCanvasElement, engine: RenderingEngine) {
    engine.dispose();
    canvas.remove();
    recordingStore.setPreviewCanvas(null);
  }

  async captureScreenshot(
    config: ScreenshotConfig,
    shaderInfo: ShaderInfo,
  ): Promise<Blob> {
    const { canvas, engine } = this.createOffscreenEngine(config.width, config.height);

    try {
      const result = await engine.compileShaderPipeline(
        shaderInfo.code,
        shaderInfo.config,
        shaderInfo.path,
        shaderInfo.buffers,
      );
      if (result && !result.success) {
        throw new Error(`Shader compilation failed: ${result.errors?.join(", ")}`);
      }

      const tm = engine.getTimeManager();
      const time = config.time ?? 0;
      tm.setTime(time);
      tm.setFrame(0);
      tm.setDeltaTime(0);
      engine.renderForCapture();

      const type = config.format === "jpeg" ? "image/jpeg" : "image/png";
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Failed to capture screenshot"));
            }
          },
          type,
          config.format === "jpeg" ? 0.95 : undefined,
        );
      });
    } finally {
      this.disposeOffscreen(canvas, engine);
    }
  }

  async record(
    config: RecordingConfig,
    shaderInfo: ShaderInfo,
  ): Promise<Blob> {
    this.cancelled = false;

    // H.264 (MP4) requires even dimensions
    let width = config.width;
    let height = config.height;
    if (config.format === "mp4") {
      width = width % 2 === 0 ? width : width + 1;
      height = height % 2 === 0 ? height : height + 1;
    }

    const { canvas, engine } = this.createOffscreenEngine(width, height);
    this.offscreenEngine = engine;

    try {
      const result = await engine.compileShaderPipeline(
        shaderInfo.code,
        shaderInfo.config,
        shaderInfo.path,
        shaderInfo.buffers,
      );
      if (result && !result.success) {
        throw new Error(`Shader compilation failed: ${result.errors?.join(", ")}`);
      }

      recordingStore.setPreviewCanvas(canvas);

      const tm = engine.getTimeManager();
      const totalFrames = Math.ceil(config.duration * config.fps);
      const dt = 1 / config.fps;

      recordingStore.startRecording(config.format, totalFrames);

      let blob: Blob;

      if (config.format === "gif") {
        blob = await this.recordGif(canvas, engine, tm, config, totalFrames, dt, width, height);
      } else {
        blob = await this.recordVideo(canvas, engine, tm, config, totalFrames, dt, width, height);
      }

      return blob;
    } finally {
      this.offscreenEngine = null;
      this.disposeOffscreen(canvas, engine);
      recordingStore.reset();
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.activeGifEncoder) {
      this.activeGifEncoder.cancel();
      this.activeGifEncoder = null;
    }
  }

  private async recordGif(
    canvas: HTMLCanvasElement,
    renderingEngine: RenderingEngine,
    tm: ReturnType<RenderingEngine["getTimeManager"]>,
    config: RecordingConfig,
    totalFrames: number,
    dt: number,
    width: number,
    height: number,
  ): Promise<Blob> {
    const encoder = new GifEncoderWrapper({
      width,
      height,
      fps: config.fps,
      quality: config.quality ?? 100,
      repeat: config.loopCount ?? 0,
    });
    this.activeGifEncoder = encoder;

    const gl = canvas.getContext("webgl2")!;

    for (let i = 0; i < totalFrames; i++) {
      if (this.cancelled) {
        throw new Error("Recording cancelled");
      }

      const time = config.startTime + i * dt;
      tm.setTime(time);
      tm.setFrame(i);
      tm.setDeltaTime(dt);
      renderingEngine.renderForCapture();

      // Read pixels from WebGL
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // WebGL reads bottom-up, flip vertically
      const flipped = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const srcRow = (height - 1 - y) * width * 4;
        const dstRow = y * width * 4;
        flipped.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow);
      }

      const imageData = new ImageData(new Uint8ClampedArray(flipped), width, height);
      encoder.addFrame(imageData);

      recordingStore.updateProgress(i + 1, totalFrames);

      // Yield every 4 frames to keep UI responsive
      if (i % 4 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // gifski encodes all frames in one WASM call — this is the slow part
    // but produces high-quality dithered output
    recordingStore.setFinalizing();
    await new Promise((r) => setTimeout(r, 0));

    const bytes = await encoder.finish();
    return new Blob([bytes], { type: "image/gif" });
  }

  private async recordVideo(
    canvas: HTMLCanvasElement,
    renderingEngine: RenderingEngine,
    tm: ReturnType<RenderingEngine["getTimeManager"]>,
    config: RecordingConfig,
    totalFrames: number,
    dt: number,
    width: number,
    height: number,
  ): Promise<Blob> {
    const encoder = new VideoEncoderWrapper({
      width,
      height,
      fps: config.fps,
      format: config.format as "webm" | "mp4",
    });

    // Flush every N frames so encoding runs in parallel with rendering
    // instead of building up a massive backlog for finish().
    const flushInterval = Math.max(4, Math.ceil(config.fps / 2));

    for (let i = 0; i < totalFrames; i++) {
      if (this.cancelled) {
        throw new Error("Recording cancelled");
      }

      const time = config.startTime + i * dt;
      tm.setTime(time);
      tm.setFrame(i);
      tm.setDeltaTime(dt);
      renderingEngine.renderForCapture();

      const timestampUs = Math.round((i / config.fps) * 1_000_000);
      encoder.addFrame(canvas, timestampUs);

      recordingStore.updateProgress(i + 1, totalFrames);

      // Flush encoder periodically to keep queue short and UI responsive
      if (i % flushInterval === flushInterval - 1) {
        await encoder.flush();
      }
    }

    recordingStore.setFinalizing();
    await new Promise((r) => setTimeout(r, 0));

    return encoder.finish();
  }
}
