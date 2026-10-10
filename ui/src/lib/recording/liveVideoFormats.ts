export type LiveVideoFormat = "mp4" | "webm";

const LIVE_MIME_CANDIDATES: Record<LiveVideoFormat, string[]> = {
  mp4: ["video/mp4;codecs=avc1", "video/mp4"],
  webm: ["video/webm;codecs=h264", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
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

/** Check the minimal AVC configuration used if this host lacks native MP4 recording. */
export async function canCaptureLiveMp4(width: number, height: number, frameRate: number): Promise<boolean> {
  if (typeof globalThis.VideoEncoder === "undefined") {
    return false;
  }
  try {
    const { canEncodeVideo } = await import("mediabunny");
    return await canEncodeVideo("avc", {
      width: width + width % 2,
      height: height + height % 2,
      frameRate,
      bitrate: 8_000_000,
    });
  } catch {
    return false;
  }
}

/** Native recording is preferred; AVC encoding fills MP4-only capability gaps. */
export async function probeLiveVideoFormats(width: number, height: number, frameRate: number): Promise<LiveVideoFormat[]> {
  const formats = supportedLiveVideoFormats();
  if (!formats.includes("mp4") && await canCaptureLiveMp4(width, height, frameRate)) {
    formats.unshift("mp4");
  }
  return formats;
}
