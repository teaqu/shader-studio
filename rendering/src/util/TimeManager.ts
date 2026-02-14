export class TimeManager {
    private paused = false;
    private pausedTime = 0;
    private lastRealTime = 0;
    private resetTime = 0;
    private frame = 0;
    private lastFrameTime = 0;
    private deltaTime = 0;
    private speedMultiplier = 1.0;
    private loopEnabled = false;
    private loopDuration = 60; // Default to 1 minute

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

        let time = this.paused
            ? (this.lastRealTime - this.resetTime) - this.pausedTime
            : (currentTime - this.resetTime) - this.pausedTime;

        // Apply speed multiplier
        time *= this.speedMultiplier;

        // Apply loop if enabled
        if (this.loopEnabled && this.loopDuration > 0) {
            time = time % this.loopDuration;
        }

        return time;
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

    public setSpeed(speed: number): void {
        // Preserve current time when changing speed
        const currentTime = performance.now() * 0.001;
        const currentShaderTime = this.getCurrentTime(currentTime * 1000);

        // Update speed multiplier
        const newSpeed = Math.max(0.25, Math.min(4.0, speed));

        // Adjust resetTime so current shader time stays the same
        // currentShaderTime = (currentTime - resetTime - pausedTime) * newSpeed
        // resetTime = currentTime - (currentShaderTime / newSpeed) - pausedTime
        this.resetTime = currentTime - (currentShaderTime / newSpeed) - this.pausedTime;
        this.speedMultiplier = newSpeed;

        if (this.paused) {
            this.lastRealTime = currentTime;
        }
    }

    public getSpeed(): number {
        return this.speedMultiplier;
    }

    public setLoopEnabled(enabled: boolean): void {
        this.loopEnabled = enabled;
    }

    public isLoopEnabled(): boolean {
        return this.loopEnabled;
    }

    public setLoopDuration(duration: number): void {
        this.loopDuration = Math.max(0, duration);
    }

    public getLoopDuration(): number {
        return this.loopDuration;
    }

    public setTime(time: number): void {
        const currentTime = performance.now() * 0.001;
        // Adjust the time accounting for speed multiplier
        const adjustedTime = time / this.speedMultiplier;
        this.resetTime = currentTime - adjustedTime;
        this.pausedTime = 0;
        this.lastFrameTime = currentTime;

        if (this.paused) {
            this.lastRealTime = currentTime;
        }
    }
}
