/** Firefox currently returns screen video without tab/system audio (Mozilla bug 1541425). */
export function browserAudioSupportWarning(userAgent: string): string | undefined {
  return /Firefox\//i.test(userAgent)
    ? "Firefox does not support browser audio sharing. Use Chrome or Edge to share a tab’s audio, or choose Mic for an audio input."
    : undefined;
}

/**
 * Owns the user-selected audio stream used for system/tab capture. It is kept
 * separate from GPU resource managers so an engine rebuild can create a fresh
 * analyser/texture without reopening the browser sharing picker.
 */
export interface SystemAudioLease {
  readonly stream: MediaStream;
  release(): void;
}

export type SystemAudioEndedListener = () => void;

interface LeaseRecord {
  released: boolean;
  onEnded: SystemAudioEndedListener;
}

type DisplayAudioConstraints = MediaStreamConstraints & {
  systemAudio?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
};

export class SystemAudioCapture {
  private stream: MediaStream | null = null;
  private readonly leases = new Set<LeaseRecord>();
  private readonly stoppedStreams = new WeakSet<MediaStream>();
  private generation = 0;
  private disposed = false;
  private onTrackEnded: (() => void) | null = null;

  /**
   * Start sharing system/tab audio (no device id), or capture a microphone
   * device when an id is supplied. The display-media call intentionally occurs
   * before the first await so callers can invoke this directly from a click.
   */
  public async start(deviceId?: string): Promise<string | undefined> {
    if (this.disposed) {
      return "System audio capture is no longer available.";
    }

    this.stop();
    const generation = ++this.generation;

    let capture: Promise<MediaStream>;
    try {
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
        capture = navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          systemAudio: "include",
          selfBrowserSurface: "exclude",
        } as DisplayAudioConstraints);
      } else {
        if (!navigator.mediaDevices.getUserMedia) {
          return "This browser cannot access audio input devices.";
        }
        capture = navigator.mediaDevices.getUserMedia({
          video: false,
          audio: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
        });
      }
    } catch (error) {
      return this.captureWarning(deviceId, error);
    }

    let stream: MediaStream;
    try {
      stream = await capture;
    } catch (error) {
      return this.captureWarning(deviceId, error);
    }

    if (this.disposed || generation !== this.generation) {
      this.stopStream(stream);
      return "System audio capture was stopped before it became ready.";
    }

    // getDisplayMedia needs video in most browsers, but Shader Studio only
    // consumes audio. Remove it immediately so it cannot remain captured.
    for (const track of stream.getVideoTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
    if (stream.getAudioTracks().length === 0) {
      this.stopStream(stream);
      return "The selected share source did not provide audio. Choose a tab or screen with Share audio enabled.";
    }

    this.stream = stream;
    const ended = () => this.handleStreamEnded(stream);
    this.onTrackEnded = ended;
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", ended);
    }
    return undefined;
  }

  /** Acquire the current source for a resource manager. It never opens UI. */
  public acquire(onEnded: SystemAudioEndedListener = () => undefined): SystemAudioLease | null {
    const stream = this.stream;
    if (!stream || this.disposed) {
      return null;
    }
    const record: LeaseRecord = { released: false, onEnded };
    this.leases.add(record);
    return {
      stream,
      release: () => this.release(record),
    };
  }

  /** Stop sharing and notify every owner that its source is no longer valid. */
  public stop(): void {
    ++this.generation;
    const stream = this.stream;
    if (!stream) {
      return;
    }
    this.detach(stream);
    this.stopStream(stream);
    this.notifyLeases();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stop();
  }

  private release(record: LeaseRecord): void {
    if (record.released) {
      return;
    }
    record.released = true;
    this.leases.delete(record);
    if (this.leases.size === 0 && this.stream) {
      const stream = this.stream;
      this.detach(stream);
      this.stopStream(stream);
    }
  }

  private handleStreamEnded(stream: MediaStream): void {
    if (this.stream !== stream) {
      return;
    }
    this.detach(stream);
    this.stopStream(stream);
    this.notifyLeases();
  }

  private detach(stream: MediaStream): void {
    if (this.stream === stream) {
      this.stream = null;
    }
    if (this.onTrackEnded) {
      for (const track of stream.getAudioTracks()) {
        track.removeEventListener("ended", this.onTrackEnded);
      }
      this.onTrackEnded = null;
    }
  }

  private notifyLeases(): void {
    const records = [...this.leases];
    this.leases.clear();
    for (const record of records) {
      if (record.released) {
        continue;
      }
      record.released = true;
      try {
        record.onEnded();
      } catch {
        // A consumer cleanup failure must not retain the captured stream.
      }
    }
  }

  private stopStream(stream: MediaStream): void {
    if (this.stoppedStreams.has(stream)) {
      return;
    }
    this.stoppedStreams.add(stream);
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  private captureWarning(deviceId: string | undefined, error: unknown): string {
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
