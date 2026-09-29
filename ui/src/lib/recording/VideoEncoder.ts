import { Muxer as WebMMuxer, ArrayBufferTarget as WebMTarget } from "webm-muxer";
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4Target } from "mp4-muxer";

export interface VideoEncoderOptions {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
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
 * Colour detail is additionally limited by 4:2:0 chroma, which no bitrate
 * can recover.
 */
export const VIDEO_BITS_PER_PIXEL_CEILING = 3;
export const MIN_VIDEO_BITRATE = 2_000_000;
export const MAX_VIDEO_BITRATE = 250_000_000;

export function automaticVideoBitrate(options: Pick<VideoEncoderOptions, "width" | "height" | "fps">): number {
  const calculated = Math.round(options.width * options.height * options.fps * VIDEO_BITS_PER_PIXEL_CEILING);
  return Math.max(MIN_VIDEO_BITRATE, Math.min(MAX_VIDEO_BITRATE, calculated));
}

export function videoEncoderConfig(options: VideoEncoderOptions): VideoEncoderConfig {
  let codec: string;
  if (options.format === "mp4") {
    // AVC level must match resolution:
    // 3.1 (1f) up to 1280x720, 4.0 (28) up to 1920x1080, 5.1 (33) up to 4096x2160
    const pixels = options.width * options.height;
    const level = pixels <= 921600 ? "1f" : pixels <= 2088960 ? "28" : "33";
    codec = `avc1.4200${level}`;
  } else {
    // VP8 is more widely supported than VP9 in WebCodecs
    codec = "vp8";
  }
  return {
    codec,
    width: options.width,
    height: options.height,
    bitrate: options.bitrate ?? automaticVideoBitrate(options),
    framerate: options.fps,
    bitrateMode: "variable",
  };
}

export class VideoEncoderWrapper {
  private muxer: WebMMuxer<WebMTarget> | MP4Muxer<MP4Target>;
  private encoder: globalThis.VideoEncoder;
  private frameCount = 0;
  private fps: number;
  private format: "webm" | "mp4";
  private encoderError: Error | null = null;

  constructor(private options: VideoEncoderOptions) {
    this.fps = options.fps;
    this.format = options.format;

    if (options.format === "mp4") {
      this.muxer = new MP4Muxer({
        target: new MP4Target(),
        video: {
          codec: "avc",
          width: options.width,
          height: options.height,
        },
        fastStart: "in-memory",
      });
    } else {
      this.muxer = new WebMMuxer({
        target: new WebMTarget(),
        video: {
          codec: "V_VP8",
          width: options.width,
          height: options.height,
        },
      });
    }

    this.encoder = new globalThis.VideoEncoder({
      output: (chunk, meta) => {
        this.muxer.addVideoChunk(chunk, meta ?? undefined);
      },
      error: (e) => {
        this.encoderError = e instanceof Error ? e : new Error(String(e));
      },
    });

    this.encoder.configure(videoEncoderConfig(options));
  }

  /**
   * The bitrate to encode with: the automatic ceiling, halved until this host
   * accepts the configuration (hardware encoders and codec levels can cap it).
   * Rejects before any rendering when nothing down to the minimum is supported.
   */
  static async supportedBitrate(options: VideoEncoderOptions): Promise<number> {
    if (typeof globalThis.VideoEncoder === "undefined") {
      throw new Error("Video export is not supported by this host (WebCodecs unavailable)");
    }
    for (
      let bitrate = options.bitrate ?? automaticVideoBitrate(options);
      bitrate >= MIN_VIDEO_BITRATE;
      bitrate = Math.floor(bitrate / 2)
    ) {
      try {
        const result = await globalThis.VideoEncoder.isConfigSupported(videoEncoderConfig({ ...options, bitrate }));
        if (result.supported === true) {
          return bitrate;
        }
      } catch {
        // An invalid configuration for this host; try a lower bitrate.
      }
    }
    throw new Error(
      `${options.format.toUpperCase()} export at ${options.width}×${options.height}, ${options.fps} fps is not supported by this host`,
    );
  }

  addFrame(canvas: HTMLCanvasElement, timestampUs: number): void {
    this.throwIfEncoderFailed();
    // Firefox preserves a missing duration as null; the MP4 muxer requires it.
    const frame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / this.fps),
    });
    try {
      this.encoder.encode(frame, {
        keyFrame: this.frameCount % (this.fps * 2) === 0,
      });
    } finally {
      // Release the GPU-backed frame even when encode() throws.
      frame.close();
    }
    this.frameCount++;
  }

  /** Flush queued frames so encoding runs in parallel with rendering. */
  async flush(): Promise<void> {
    await this.encoder.flush();
    this.throwIfEncoderFailed();
  }

  async finish(): Promise<Blob> {
    await this.flush();
    this.close();
    this.muxer.finalize();
    const buffer = (this.muxer.target as WebMTarget | MP4Target).buffer;
    const mimeType = this.format === "mp4" ? "video/mp4" : "video/webm";
    return new Blob([buffer], { type: mimeType });
  }

  /** Release the encoder without producing a file (cancel/failure). Idempotent. */
  close(): void {
    if (this.encoder.state !== "closed") {
      try {
        this.encoder.close();
      } catch {
        // Already closed by an asynchronous encoder error.
      }
    }
  }

  private throwIfEncoderFailed(): void {
    if (this.encoderError) {
      throw this.encoderError;
    }
  }
}
