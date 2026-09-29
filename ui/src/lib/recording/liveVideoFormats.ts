export type LiveVideoFormat = "mp4" | "webm";

const LIVE_MIME_CANDIDATES: Record<LiveVideoFormat, string[]> = {
  mp4: ["video/mp4;codecs=avc1.42E01E", "video/mp4"],
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
