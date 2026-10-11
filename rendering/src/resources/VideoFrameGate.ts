/** Avoid uploading the same decoded screen frame at the shader's render rate. */
export class VideoFrameGate {
  private dirty = true;
  private callbackId: number | undefined;
  private lastTime: number | undefined;
  private disposed = false;

  constructor(private readonly video: HTMLVideoElement) {
    this.schedule();
  }

  public needsUpload(): boolean {
    if (this.disposed) {
      return false;
    }
    return typeof this.video.requestVideoFrameCallback === "function"
      ? this.dirty : this.lastTime === undefined || !Number.isFinite(this.video.currentTime) || this.video.currentTime !== this.lastTime;
  }

  public uploaded(): void {
    this.dirty = false;
    this.lastTime = this.video.currentTime;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.callbackId !== undefined) {
      this.video.cancelVideoFrameCallback?.(this.callbackId);
    }
  }

  private schedule(): void {
    if (!this.disposed && typeof this.video.requestVideoFrameCallback === "function") {
      this.callbackId = this.video.requestVideoFrameCallback(() => {
        this.dirty = true;
        this.schedule();
      });
    }
  }
}
