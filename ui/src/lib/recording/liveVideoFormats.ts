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
