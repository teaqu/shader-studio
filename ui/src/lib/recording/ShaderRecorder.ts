import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import { assertGifMemoryBudget, GifEncoderWrapper } from "./GifEncoder";
import { automaticVideoBitrate, VideoEncoderWrapper } from "./VideoEncoder";
import { recordingStore } from "../stores/recordingStore";
import { createEngineForLanguage } from "../engineFactory";
import {
  createRenderCaptureSnapshot,
  type RenderCaptureSnapshot,
  type ScreenshotConfig,
  type RecordingConfig,
  type ShaderInfo,
} from "./types";
import { createRenderTimeline, type RenderFrameStep, type RenderTimeline } from "./renderTimeline";
import { liveVideoMimeType } from "./liveVideoFormats";
import { describeRenderInputLimitations, renderInputLimitations } from "./captureSnapshot";

export type { ScreenshotConfig, RecordingConfig, ShaderInfo };

export class ShaderRecorder {
  private static readonly SCREENSHOT_HISTORY_FPS = 60;
  private cancelled = false;
  private offscreenEngine: RenderingEngine | null = null;
  private activeGifEncoder: GifEncoderWrapper | null = null;
  private activeMediaRecorder: MediaRecorder | null = null;
  private liveStream: MediaStream | null = null;
  private rejectLiveRecording: ((reason?: unknown) => void) | null = null;
  private outputNotice: string | null = null;

  /**
   * Something the user should know about the last saved output, e.g. that
   * MP4 dimensions were rounded to even numbers. Cleared once read.
   */
  consumeOutputNotice(): string | null {
    const notice = this.outputNotice;
    this.outputNotice = null;
    return notice;
  }

  private createOffscreenEngine(width: number, height: number, language: ShaderInfo["language"]): { canvas: HTMLCanvasElement; engine: RenderingEngine } {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    // Position offscreen instead of display:none so WebGL rendering works
    canvas.style.position = "fixed";
    canvas.style.left = "-9999px";
    canvas.style.top = "-9999px";
    canvas.style.pointerEvents = "none";
    document.body.appendChild(canvas);

    const engine = createEngineForLanguage(language);
    engine.initialize(canvas, true);
    engine.handleCanvasResize(width, height);

    return { canvas, engine };
  }

  private disposeOffscreen(canvas: HTMLCanvasElement, engine: RenderingEngine) {
    engine.dispose();
    canvas.remove();
    recordingStore.setPreviewCanvas(null);
  }

  private encodeImageData(image: ImageData, format: ScreenshotConfig["format"]): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to create an image encoder for the captured frame");
    }
    context.putImageData(image, 0, 0);
    const type = format === "jpeg" ? "image/jpeg" : "image/png";
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to encode the captured frame"));
        }
      }, type, format === "jpeg" ? 0.95 : undefined);
    });
  }

  async captureLiveScreenshot(
    config: ScreenshotConfig,
    engine: RenderingEngine,
  ): Promise<Blob> {
    this.outputNotice = null;
    const image = await engine.captureCurrentFrame();
    return this.encodeImageData(image, config.format);
  }

  recordLive(config: RecordingConfig, engine: RenderingEngine): Promise<Blob> {
    this.outputNotice = null;
    if (config.format === "gif") {
      return Promise.reject(new Error("Live GIF recording is not supported"));
    }
    if (this.activeMediaRecorder) {
      return Promise.reject(new Error("A Live recording is already active"));
    }
    const canvas = engine.getCanvas();
    if (!canvas || typeof canvas.captureStream !== "function") {
      return Promise.reject(new Error("Live video capture is not supported by this host"));
    }
    if (typeof MediaRecorder === "undefined") {
      return Promise.reject(new Error("Live video recording is not supported by this host"));
    }

    const mimeType = liveVideoMimeType(config.format);
    if (!mimeType) {
      return Promise.reject(new Error(`${config.format.toUpperCase()} Live recording is not supported by this host`));
    }

    this.cancelled = false;
    const stream = canvas.captureStream(config.fps);
    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: automaticVideoBitrate({
          width: canvas.width,
          height: canvas.height,
          fps: config.fps,
          format: config.format,
        }),
      });
    } catch (error) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return Promise.reject(error);
    }
    this.activeMediaRecorder = mediaRecorder;
    this.liveStream = stream;
    recordingStore.startLiveRecording(config.format);

    return new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      this.rejectLiveRecording = reject;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      mediaRecorder.onerror = () => {
        this.cleanupLiveRecording();
        reject(new Error("Live video encoding failed"));
      };
      mediaRecorder.onstop = () => {
        const cancelled = this.cancelled;
        this.cleanupLiveRecording();
        if (cancelled) {
          reject(new Error("Recording cancelled"));
        } else {
          resolve(new Blob(chunks, { type: mediaRecorder.mimeType || mimeType }));
        }
      };
      try {
        mediaRecorder.start(1000);
      } catch (error) {
        this.cleanupLiveRecording();
        reject(error);
      }
    });
  }

  stopLiveRecording(): void {
    if (this.activeMediaRecorder?.state === "recording") {
      recordingStore.setFinalizing();
      this.activeMediaRecorder.stop();
    }
  }

  private cleanupLiveRecording(): void {
    for (const track of this.liveStream?.getTracks() ?? []) {
      track.stop();
    }
    this.liveStream = null;
    this.activeMediaRecorder = null;
    this.rejectLiveRecording = null;
  }

  private async initializeCaptureEngine(
    engine: RenderingEngine,
    snapshot: RenderCaptureSnapshot,
  ): Promise<void> {
    const args: Parameters<RenderingEngine["compileShaderPipeline"]> = [
      snapshot.code,
      snapshot.config,
      snapshot.path,
      snapshot.buffers,
    ];
    if (
      snapshot.customUniformDeclarations !== undefined
      || snapshot.customUniformInfo.length > 0
      || snapshot.slangModules !== undefined
      || snapshot.slangSourcePath !== undefined
      || snapshot.slangSourcePaths !== undefined
    ) {
      args.push(snapshot.customUniformDeclarations, snapshot.customUniformInfo);
    }
    if (
      snapshot.slangModules !== undefined
      || snapshot.slangSourcePath !== undefined
      || snapshot.slangSourcePaths !== undefined
    ) {
      args.push(snapshot.slangModules);
    }
    if (snapshot.slangSourcePath !== undefined || snapshot.slangSourcePaths !== undefined) {
      args.push(snapshot.slangSourcePath);
    }
    if (snapshot.slangSourcePaths !== undefined) {
      args.push(snapshot.slangSourcePaths);
    }

    const result = await engine.compileShaderPipeline(...args);
    if (result && !result.success) {
      throw new Error(`Shader compilation failed: ${result.errors?.join(", ")}`);
    }
    engine.setCustomUniformValues(snapshot.customUniformValues);
  }

  private async renderStep(
    engine: RenderingEngine,
    tm: ReturnType<RenderingEngine["getTimeManager"]>,
    step: RenderFrameStep,
  ): Promise<void> {
    tm.setTime(step.time);
    tm.setFrame(step.frame);
    tm.setDeltaTime(step.delta);
    await engine.renderForCapture();
  }

  private async prepareTimeline(
    engine: RenderingEngine,
    tm: ReturnType<RenderingEngine["getTimeManager"]>,
    timeline: RenderTimeline,
  ): Promise<void> {
    for (let index = 0; index < timeline.preparationCount; index++) {
      if (this.cancelled) {
        throw new Error("Recording cancelled");
      }
      await this.renderStep(engine, tm, timeline.preparationStep(index));
      recordingStore.updatePreparation(index + 1, timeline.preparationCount);
      if (this.cancelled) {
        throw new Error("Recording cancelled");
      }
      if (index % 4 === 3) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  async captureScreenshot(
    config: ScreenshotConfig,
    shaderInfo: ShaderInfo,
  ): Promise<Blob> {
    this.cancelled = false;
    const snapshot = createRenderCaptureSnapshot(shaderInfo);
    this.outputNotice = describeRenderInputLimitations(renderInputLimitations(snapshot));
    const { canvas, engine } = this.createOffscreenEngine(config.width, config.height, snapshot.language);

    try {
      await this.initializeCaptureEngine(engine, snapshot);

      const tm = engine.getTimeManager();
      const time = config.time ?? 0;
      const timeline = createRenderTimeline(time, ShaderRecorder.SCREENSHOT_HISTORY_FPS);
      if (timeline.preparationCount > 0) {
        recordingStore.setPreviewCanvas(canvas);
        recordingStore.startPreparing(config.format, 1, timeline.preparationCount);
      }
      await this.prepareTimeline(engine, tm, timeline);
      if (timeline.preparationCount > 0) {
        recordingStore.startRecording(config.format, 1);
      }
      await this.renderStep(engine, tm, timeline.outputStep(0));
      if (timeline.preparationCount > 0) {
        recordingStore.updateProgress(1, 1);
        recordingStore.setFinalizing();
      }

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
      recordingStore.reset();
    }
  }

  async record(
    config: RecordingConfig,
    shaderInfo: ShaderInfo,
  ): Promise<Blob> {
    this.cancelled = false;
    const snapshot = createRenderCaptureSnapshot(shaderInfo);

    // H.264 (MP4) requires even dimensions
    let width = config.width;
    let height = config.height;
    if (config.format === "mp4") {
      width = width % 2 === 0 ? width : width + 1;
      height = height % 2 === 0 ? height : height + 1;
    }
    const notices = [
      width !== config.width || height !== config.height
        ? `Saved at ${width} × ${height}: MP4 needs even dimensions, so ${config.width} × ${config.height} was rounded up.`
        : null,
      describeRenderInputLimitations(renderInputLimitations(snapshot)),
    ].filter((notice): notice is string => notice !== null);
    this.outputNotice = notices.length > 0 ? notices.join(" ") : null;

    const { canvas, engine } = this.createOffscreenEngine(width, height, snapshot.language);
    this.offscreenEngine = engine;

    try {
      await this.initializeCaptureEngine(engine, snapshot);

      recordingStore.setPreviewCanvas(canvas);

      const tm = engine.getTimeManager();
      const totalFrames = Math.ceil(config.duration * config.fps);
      if (config.format === "gif") {
        assertGifMemoryBudget(width, height, totalFrames);
      } else {
        await VideoEncoderWrapper.assertSupported({ width, height, fps: config.fps, format: config.format });
      }
      const timeline = createRenderTimeline(config.startTime, config.fps);

      if (timeline.preparationCount > 0) {
        recordingStore.startPreparing(config.format, totalFrames, timeline.preparationCount);
      } else {
        recordingStore.startRecording(config.format, totalFrames);
      }
      await this.prepareTimeline(engine, tm, timeline);
      if (timeline.preparationCount > 0) {
        recordingStore.startRecording(config.format, totalFrames);
      }

      let blob: Blob;

      if (config.format === "gif") {
        blob = await this.recordGif(canvas, engine, tm, config, totalFrames, width, height, timeline);
      } else {
        blob = await this.recordVideo(canvas, engine, tm, config, totalFrames, width, height, timeline);
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
    if (this.activeMediaRecorder?.state === "recording") {
      this.activeMediaRecorder.stop();
    } else if (this.rejectLiveRecording) {
      this.rejectLiveRecording(new Error("Recording cancelled"));
      this.cleanupLiveRecording();
    }
  }

  private async recordGif(
    canvas: HTMLCanvasElement,
    renderingEngine: RenderingEngine,
    tm: ReturnType<RenderingEngine["getTimeManager"]>,
    config: RecordingConfig,
    totalFrames: number,
    width: number,
    height: number,
    timeline: RenderTimeline,
  ): Promise<Blob> {
    const encoder = new GifEncoderWrapper({
      width,
      height,
      fps: config.fps,
      quality: config.quality ?? 100,
      repeat: config.loopCount === 0 || config.loopCount === undefined
        ? undefined
        : Math.max(0, config.loopCount),
    });
    this.activeGifEncoder = encoder;

    for (let i = 0; i < totalFrames; i++) {
      if (this.cancelled) {
        throw new Error("Recording cancelled");
      }

      await this.renderStep(renderingEngine, tm, timeline.outputStep(i));

      const imageData = this.captureGifFrame(canvas, width, height);
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

  private captureGifFrame(canvas: HTMLCanvasElement, width: number, height: number): ImageData {
    const gl = canvas.getContext("webgl2");
    if (gl) {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // WebGL reads bottom-up, flip vertically.
      const flipped = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const srcRow = (height - 1 - y) * width * 4;
        const dstRow = y * width * 4;
        flipped.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow);
      }

      return new ImageData(flipped, width, height);
    }

    const copyCanvas = document.createElement("canvas");
    copyCanvas.width = width;
    copyCanvas.height = height;
    const ctx = copyCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to capture GIF frame");
    }
    ctx.drawImage(canvas, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  }

  private async recordVideo(
    canvas: HTMLCanvasElement,
    renderingEngine: RenderingEngine,
    tm: ReturnType<RenderingEngine["getTimeManager"]>,
    config: RecordingConfig,
    totalFrames: number,
    width: number,
    height: number,
    timeline: RenderTimeline,
  ): Promise<Blob> {
    const encoder = new VideoEncoderWrapper({
      width,
      height,
      fps: config.fps,
      format: config.format as "webm" | "mp4",
    });

    // Flush every N frames so encoding runs in parallel with rendering
    // instead of building up a massive backlog for finish(). Each flush is
    // awaited, so at most flushInterval frames are ever queued.
    const flushInterval = Math.max(4, Math.ceil(config.fps / 2));

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (this.cancelled) {
          throw new Error("Recording cancelled");
        }

        await this.renderStep(renderingEngine, tm, timeline.outputStep(i));

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

      return await encoder.finish();
    } finally {
      // finish() closes on success; this releases the encoder on cancel/error.
      encoder.close();
    }
  }
}
