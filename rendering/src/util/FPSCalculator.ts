export class FPSCalculator {
  private currentFPS = 0;
  private lastFrameTime = 0;
  private frameTimes: number[] = [];
  private maxFrameTimesSamples: number;
  private minSamples: number;

  constructor(windowSize: number = 30, minSamples: number = 5) {
    this.maxFrameTimesSamples = windowSize;
    this.minSamples = minSamples;
  }

  public reset(): void {
    this.currentFPS = 60.0;
    this.lastFrameTime = 0;
    this.frameTimes = [];
  }

  public updateFrame(currentTime: number): boolean {
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = currentTime;
      this.currentFPS = 60.0;
      return false;
    }

    const frameTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    if (frameTime > 0 && frameTime < 100) {
      this.frameTimes.push(frameTime);

      if (this.frameTimes.length > this.maxFrameTimesSamples) {
        this.frameTimes.shift();
      }

      if (this.frameTimes.length >= this.minSamples) {
        const avgFrameTime = this.frameTimes.reduce((sum, ft) => sum + ft, 0) / this.frameTimes.length;
        this.currentFPS = 1000 / avgFrameTime;
        return true;
      }
    }

    return false;
  }

  public getFPS(rounded: boolean = true): number {
    return rounded ? Math.round(this.currentFPS) : this.currentFPS;
  }

  public getRawFPS(): number {
    return this.currentFPS;
  }

  public getSampleCount(): number {
    return this.frameTimes.length;
  }

  public isStable(): boolean {
    return this.frameTimes.length >= this.minSamples;
  }
}
