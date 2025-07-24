export class TimeManager {
    private paused = false;
    private pausedTime = 0;
    private lastRealTime = 0;
    private resetTime = 0;
    private frame = 0;
    private lastFrameTime = 0;
    private deltaTime = 0;

    constructor() {
        this.resetTime = performance.now() * 0.001;
        this.lastFrameTime = this.resetTime;
    }

    public isPaused(): boolean {
        return this.paused;
    }

    public togglePause(): void {
        if (this.paused) {
            // Resume: calculate how long we were paused and adjust the offset
            const currentTime = performance.now() * 0.001;
            this.pausedTime += currentTime - this.lastRealTime;
            this.lastFrameTime = currentTime; // Reset frame time to avoid large delta
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
        this.lastFrameTime = currentTime;
        this.deltaTime = 0;

        if (this.paused) {
            this.lastRealTime = this.resetTime;
        } else {
            this.lastRealTime = 0;
        }
    }

    public getCurrentTime(currentFrameTime: number): number {
        const currentTime = currentFrameTime * 0.001;

        return this.paused
            ? (this.lastRealTime - this.resetTime) - this.pausedTime
            : (currentTime - this.resetTime) - this.pausedTime;
    }

    public updateFrame(frameTimeMs: number): void {
        const currentTime = frameTimeMs * 0.001; // Convert to seconds

        if (!this.paused) {
            if (this.frame > 0) {
                this.deltaTime = currentTime - this.lastFrameTime;
            } else {
                this.deltaTime = 0.016667; // Default to ~60fps for first frame
            }
            this.lastFrameTime = currentTime;
        }
    }

    public getDeltaTime(): number {
        return this.deltaTime;
    }

    public getFrame(): number {
        return this.frame;
    }

    public incrementFrame(): void {
        this.frame++;
    }

    public getCurrentDate(): Float32Array {
        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const day = currentDate.getDate();
        const timeInSeconds = currentDate.getHours() * 60.0 * 60 +
            currentDate.getMinutes() * 60 +
            currentDate.getSeconds() +
            currentDate.getMilliseconds() / 1000.0;

        return new Float32Array([year, month, day, timeInSeconds]);
    }
}
