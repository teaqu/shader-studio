import { SharedMediaCapture } from "./SharedMediaCapture";
export type { CaptureLease as SystemAudioLease, CaptureEndedListener as SystemAudioEndedListener } from "./SharedMediaCapture";

/** Firefox currently returns screen video without tab/system audio (Mozilla bug 1541425). */
export function browserAudioSupportWarning(userAgent: string): string | undefined {
  return /Firefox\//i.test(userAgent)
    ? "Firefox does not support browser audio sharing. Use Chrome or Edge to share a tab’s audio, or choose Mic for an audio input."
    : undefined;
}

type DisplayAudioConstraints = MediaStreamConstraints & {
  systemAudio?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
};

/** Owns shared tab audio or a selected microphone/loopback device. */
export class SystemAudioCapture extends SharedMediaCapture {
  protected requestCapture(deviceId?: string): Promise<MediaStream> | string {
    if (!navigator.mediaDevices) {
      return "System audio capture needs a secure localhost or HTTPS page.";
    }
    if (deviceId === undefined) {
      const unsupported = browserAudioSupportWarning(navigator.userAgent);
      if (unsupported) {
        return unsupported;
      }
      if (!navigator.mediaDevices.getDisplayMedia) {
        return "This browser cannot share tab or system audio. Try a current Chromium-based browser.";
      }
      // This call must remain directly in the user-gesture call stack.
      return navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        systemAudio: "include",
        selfBrowserSurface: "exclude",
      } as DisplayAudioConstraints);
    } else {
      if (!navigator.mediaDevices.getUserMedia) {
        return "This browser cannot access audio input devices.";
      }
      return navigator.mediaDevices.getUserMedia({
        video: false,
        audio: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
      });
    }
  }

  protected prepareStream(stream: MediaStream): string | undefined {
    // getDisplayMedia needs video in most browsers, but Shader Studio only
    // consumes audio. Remove it immediately so it cannot remain captured.
    for (const track of stream.getVideoTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
    if (stream.getAudioTracks().length === 0) {
      return "The selected share source did not provide audio. Choose a tab or screen with Share audio enabled.";
    }

    return undefined;
  }

  protected captureWarning(deviceId: string | undefined, error: unknown): string {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return deviceId === undefined
        ? "System audio sharing was cancelled or denied. Choose a source and enable Share audio."
        : "Audio device permission was denied. Allow microphone access, then try again.";
    }
    if (name === "NotFoundError" && deviceId !== undefined) {
      return "The selected audio device was not found.";
    }
    return deviceId === undefined
      ? "System audio sharing could not start. Try selecting a source with audio in the browser picker."
      : "Audio device capture could not start. Check that the device is available.";
  }
}
