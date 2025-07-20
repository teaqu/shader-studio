export class TimeManager {
  private paused = false;
  private pausedTime = 0;
  private lastRealTime = 0;
  private resetTime = 0;
  private frame = 0;

  constructor() {
    this.resetTime = performance.now() * 0.001;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public togglePause(): void {
    if (this.paused) {
      // Resume: calculate how long we were paused and adjust the offset
      const currentTime = performance.now() * 0.001;
      this.pausedTime += currentTime - this.lastRealTime;
      this.paused = false;
    } else {
      // Pause: record the current time (absolute time, not relative to resetTime)
      this.lastRealTime = performance.now() * 0.001;
      this.paused = true;
    }
  }

  public cleanup(): void {
    const currentTime = performance.now() * 0.001;
    this.resetTime = currentTime;
    this.pausedTime = 0;
    this.frame = 0;

    if (this.paused) {
      this.lastRealTime = this.resetTime;
    } else {
      this.lastRealTime = 0;
    }
  }

  public getCurrentTime(currentFrameTime: number): number {
    return this.paused
      ? (this.lastRealTime - this.resetTime) - this.pausedTime
      : (currentFrameTime * 0.001 - this.resetTime) - this.pausedTime;
  }

  public getFrame(): number {
    return this.frame;
  }

  public incrementFrame(): void {
    this.frame++;
  }
}
