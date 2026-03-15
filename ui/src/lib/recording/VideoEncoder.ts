import { Muxer as WebMMuxer, ArrayBufferTarget as WebMTarget } from "webm-muxer";
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4Target } from "mp4-muxer";

export interface VideoEncoderOptions {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  format: "webm" | "mp4";
}

export class VideoEncoderWrapper {
  private muxer: WebMMuxer<WebMTarget> | MP4Muxer<MP4Target>;
  private encoder: globalThis.VideoEncoder;
  private frameCount = 0;
  private fps: number;
  private format: "webm" | "mp4";

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

    this.encoder = new globalThis.VideoEncoder({
      output: (chunk, meta) => {
        this.muxer.addVideoChunk(chunk, meta ?? undefined);
      },
      error: (e) => {
        console.error("VideoEncoder error:", e);
      },
    });

    this.encoder.configure({
      codec,
      width: options.width,
      height: options.height,
      bitrate: options.bitrate ?? 5_000_000,
      framerate: options.fps,
    });
  }

  addFrame(canvas: HTMLCanvasElement, timestampUs: number): void {
    const frame = new VideoFrame(canvas, { timestamp: timestampUs });
    this.encoder.encode(frame, {
      keyFrame: this.frameCount % (this.fps * 2) === 0,
    });
    frame.close();
    this.frameCount++;
  }

  /** Flush queued frames so encoding runs in parallel with rendering. */
  async flush(): Promise<void> {
    await this.encoder.flush();
  }

  async finish(): Promise<Blob> {
    await this.encoder.flush();
    this.encoder.close();
    this.muxer.finalize();
    const buffer = (this.muxer.target as WebMTarget | MP4Target).buffer;
    const mimeType = this.format === "mp4" ? "video/mp4" : "video/webm";
    return new Blob([buffer], { type: mimeType });
  }
}
