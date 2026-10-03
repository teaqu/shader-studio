/** Shared ownership keeps a user-selected capture alive across GPU resource rebuilds. */
export interface CaptureLease {
  readonly stream: MediaStream;
  release(): void;
}
export type CaptureEndedListener = () => void;
interface LeaseRecord {
  released: boolean;
  onEnded: CaptureEndedListener;
}

export abstract class SharedMediaCapture {
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

    let capture: Promise<MediaStream> | string;
    try {
      capture = this.requestCapture(deviceId);
      if (typeof capture === "string") {
        return capture;
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

    const warning = this.prepareStream(stream);
    if (warning) {
      this.stopStream(stream);
      return warning;
    }

    this.stream = stream;
    const ended = () => this.handleStreamEnded(stream);
    this.onTrackEnded = ended;
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", ended);
    }
    return undefined;
  }

  /** Acquire the current source for a resource manager. It never opens UI. */
  public acquire(onEnded: CaptureEndedListener = () => undefined): CaptureLease | null {
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
      for (const track of stream.getTracks()) {
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

  protected abstract requestCapture(deviceId?: string): Promise<MediaStream> | string;
  protected abstract prepareStream(stream: MediaStream): string | undefined;
  protected abstract captureWarning(deviceId: string | undefined, error: unknown): string;
}
