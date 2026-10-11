import {
  BufferTarget, canEncodeVideo, Mp4OutputFormat, Output, Quality,
  VideoSample, VideoSampleSource, WebMOutputFormat,
} from "mediabunny";

export interface VideoEncoderOptions {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  codec?: "avc" | "vp8" | "vp9";
  format: "webm" | "mp4";
}

/**
 * Automatic video bitrate: a ceiling, not a fixed rate. The encoders run in
 * variable-bitrate mode and spend only what the content needs, so the ceiling
 * is set for the hardest shaders.
 *
 * Measured with decoded VP8 output (#39): ray-spheres, whose fine pattern
 * changes every frame, needs about 3 bits per pixel to reach ~32 dB luma
 * (0.1 bpp gave 18-19 dB, visibly blocky), while a smooth gradient shader
 * stays near 1.1 Mbps at 640x360 whether the ceiling is 1 or 6 bpp.
 * Windows Chromium fell below the saved-media 28 dB floor at that ceiling;
 * budget 5 bits per pixel to allow for host encoder differences.
 * Colour detail is additionally limited by 4:2:0 chroma, which no bitrate
 * can recover.
 */
const VIDEO_BITS_PER_PIXEL_CEILING = 5;
export const MIN_VIDEO_BITRATE = 2_000_000;
export const MAX_VIDEO_BITRATE = 250_000_000;

export function automaticVideoBitrate(options: Pick<VideoEncoderOptions, "width" | "height" | "fps">): number {
  const calculated = Math.round(options.width * options.height * options.fps * VIDEO_BITS_PER_PIXEL_CEILING);
  return Math.max(MIN_VIDEO_BITRATE, Math.min(MAX_VIDEO_BITRATE, calculated));
}

function videoQuality(options: VideoEncoderOptions): Quality {
  if (options.codec === "vp9") {
    return new Quality({ quantizer: 12, bitrate: options.bitrate ?? automaticVideoBitrate(options) });
  }
  return new Quality({ bitrate: options.bitrate ?? automaticVideoBitrate(options), bitrateMode: "variable" });
}

function videoCodec(options: VideoEncoderOptions): "avc" | "vp8" | "vp9" {
  return options.codec ?? (options.format === "mp4" ? "avc" : "vp8");
}

export class VideoEncoderWrapper {
  private readonly target = new BufferTarget();
  private readonly output: Output;
  private readonly source: VideoSampleSource;
  private readonly ready: Promise<void>;
  private closed = false;
  private finished = false;

  constructor(private readonly options: VideoEncoderOptions) {
    this.output = new Output({
      target: this.target,
      format: options.format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
    });
    this.source = new VideoSampleSource({
      codec: videoCodec(options),
      quality: videoQuality(options),
      keyFrameInterval: 2,
      latencyMode: "quality",
      contentHint: "detail",
    });
    this.output.addVideoTrack(this.source, { frameRate: options.fps });
    this.ready = this.output.start();
    // Startup may fail before the caller adds a frame; addFrame/finish surface it.
    void this.ready.catch(() => {});
  }

  /** Lower the quality ceiling until this host supports the exact encoding parameters. */
  static async supportedEncoding(options: VideoEncoderOptions): Promise<{ codec: "avc" | "vp8" | "vp9"; bitrate: number }> {
    if (typeof globalThis.VideoEncoder === "undefined") {
      throw new Error("Video export is not supported by this host (WebCodecs unavailable)");
    }
    for (const codec of options.format === "mp4" ? ["avc"] as const : ["vp9", "vp8"] as const) {
      for (
        let bitrate = options.bitrate ?? automaticVideoBitrate(options);
        bitrate >= MIN_VIDEO_BITRATE;
        bitrate = Math.floor(bitrate / 2)
      ) {
        try {
          if (await canEncodeVideo(codec, {
            width: options.width,
            height: options.height,
            frameRate: options.fps,
            quality: videoQuality({ ...options, codec, bitrate }),
            latencyMode: "quality",
            contentHint: "detail",
          })) {
            return { codec, bitrate };
          }
        } catch {
          // Invalid host configuration; try a lower bitrate or the next codec.
        }
      }
    }
    throw new Error(
      `${options.format.toUpperCase()} export at ${options.width}×${options.height}, ${options.fps} fps is not supported by this host`,
    );
  }

  async addFrame(canvas: HTMLCanvasElement, timestampUs: number): Promise<void> {
    this.assertOpen();
    // Snapshot before yielding: WebGL drawing buffers can be cleared on presentation.
    const sample = new VideoSample(canvas, {
      timestamp: timestampUs / 1_000_000,
      duration: 1 / this.options.fps,
    });
    try {
      await this.ready;
      this.assertOpen();
      // Await encoder/writer backpressure before the recorder renders another frame.
      await this.source.add(sample);
    } finally {
      sample.close();
    }
  }

  async finish(): Promise<Blob> {
    this.assertOpen();
    await this.ready;
    this.assertOpen();
    this.source.close();
    await this.output.finalize();
    this.finished = true;
    const buffer = this.target.buffer;
    if (!buffer?.byteLength) {
      throw new Error("Render export produced no video data");
    }
    return new Blob([buffer], { type: `video/${this.options.format}` });
  }

  /** Release unfinished encoding on cancellation/failure. Idempotent. */
  async close(): Promise<void> {
    if (this.closed || this.finished) {
      return;
    }
    this.closed = true;
    try {
      await this.ready.catch(() => {});
      await this.output.cancel();
    } catch {
      // Preserve the original recording error if cleanup also fails.
    }
  }

  private assertOpen(): void {
    if (this.closed || this.finished) {
      throw new Error("Video encoder is closed");
    }
  }
}
