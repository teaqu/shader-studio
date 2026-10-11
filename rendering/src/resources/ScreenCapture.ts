import { SharedMediaCapture } from "./SharedMediaCapture";

/** Screen pixels are captured only from an explicit user action; audio is excluded. */
export class ScreenCapture extends SharedMediaCapture {
  constructor() {
    super("Screen");
  }

  protected requestCapture(): Promise<MediaStream> | string {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      return "Screen sharing needs a supported browser on localhost or HTTPS.";
    }
    // Display capture rejects initial max/exact constraints. Ideals let the
    // browser scale its selected source without blocking capture readiness.
    return navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false,
    });
  }

  protected prepareStream(stream: MediaStream): string | undefined {
    for (const track of stream.getAudioTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
    return stream.getVideoTracks().some(track => track.readyState !== "ended")
      ? undefined : "The selected source did not provide screen video.";
  }

  protected captureWarning(_deviceId: string | undefined, error: unknown): string {
    const name = error instanceof DOMException ? error.name : "";
    return name === "NotAllowedError" || name === "SecurityError"
      ? "Screen sharing was cancelled or denied. Choose a screen, window or tab and allow sharing."
      : "Screen sharing could not start. Check browser and system screen-recording permissions.";
  }
}
