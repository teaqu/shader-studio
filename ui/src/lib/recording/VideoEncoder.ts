import { Muxer as WebMMuxer, ArrayBufferTarget as WebMTarget } from "webm-muxer";
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4Target } from "mp4-muxer";

export interface VideoEncoderOptions {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  format: "webm" | "mp4";
}

export function automaticVideoBitrate(options: VideoEncoderOptions): number {
  const bitsPerPixel = options.format === "webm" ? 0.1 : 0.14;
  const calculated = Math.round(options.width * options.height * options.fps * bitsPerPixel);
  return Math.max(1_000_000, Math.min(80_000_000, calculated));
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
   * Reject before any rendering when this host can't encode the requested
   * codec/size/bitrate, instead of failing after preparation.
   */
  static async assertSupported(options: VideoEncoderOptions): Promise<void> {
    if (typeof globalThis.VideoEncoder === "undefined") {
      throw new Error("Video export is not supported by this host (WebCodecs unavailable)");
    }
    const config = videoEncoderConfig(options);
    let supported = false;
    try {
      supported = (await globalThis.VideoEncoder.isConfigSupported(config)).supported === true;
    } catch {
      supported = false;
    }
    if (!supported) {
      throw new Error(
        `${options.format.toUpperCase()} export at ${options.width}×${options.height}, ${options.fps} fps is not supported by this host`,
      );
    }
  }

  addFrame(canvas: HTMLCanvasElement, timestampUs: number): void {
    this.throwIfEncoderFailed();
    // Firefox preserves a missing duration as null; the MP4 muxer requires it.
    const frame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / this.fps),
    });
    this.encoder.encode(frame, {
      keyFrame: this.frameCount % (this.fps * 2) === 0,
    });
    frame.close();
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
