import { automaticVideoBitrate } from "./VideoEncoder";

export type LiveVideoFormat = "mp4" | "webm";

const LIVE_MIME_CANDIDATES: Record<LiveVideoFormat, string[]> = {
  // A fixed level 3.0 caps AVC at 10 Mbps, even for large, detailed previews.
  // Prefer High/Baseline level 5.2 for bitrate headroom, with host fallbacks.
  mp4: ["video/mp4;codecs=avc1.640034", "video/mp4;codecs=avc1.420034", "video/mp4;codecs=avc1", "video/mp4"],
  webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
};

/**
 * The MediaRecorder MIME type this host can record for `format`, or null.
 * Support differs between browsers, VS Code webviews and Electron, so Live
 * video only offers what the host actually reports.
 */
export function liveVideoMimeType(format: LiveVideoFormat): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return null;
  }
  return LIVE_MIME_CANDIDATES[format].find((candidate) => {
    try {
      return MediaRecorder.isTypeSupported(candidate);
    } catch {
      return false;
    }
  }) ?? null;
}

/** Live video formats this host can record, in the order they are offered. */
export function supportedLiveVideoFormats(): LiveVideoFormat[] {
  return (["mp4", "webm"] as const).filter((format) => liveVideoMimeType(format) !== null);
}

/** Probe the encoder used for Live capture, independent of MediaRecorder. */
export async function probeLiveVideoFormats(width: number, height: number, fps: number): Promise<LiveVideoFormat[]> {
  if (typeof globalThis.VideoEncoder === "undefined") {
    return supportedLiveVideoFormats();
  }
  const { canEncodeVideo, Quality } = await import("mediabunny");
  const formats: LiveVideoFormat[] = [];
  for (const format of ["mp4", "webm"] as const) {
    const w = width + (format === "mp4" ? width % 2 : 0);
    const h = height + (format === "mp4" ? height % 2 : 0);
    const bitrate = automaticVideoBitrate({ width: w, height: h, fps });
    for (const codec of format === "mp4" ? ["avc"] as const : ["vp9", "vp8"] as const) {
      try {
        if (await canEncodeVideo(codec, { width: w, height: h, frameRate: fps, quality: new Quality(codec === "vp8" ? { bitrate } : { quantizer: 12, bitrate }) })) {
          formats.push(format);
          break;
        }
      } catch {
        // Unsupported encoder configuration; try the next codec.
      }
    }
  }
  return formats;
}
