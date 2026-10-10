/**
 * Keeps a Live recording's output size fixed. While a Live recording runs,
 * resize requests are held instead of reaching the engine: the canvas keeps
 * its pixel size and the browser scales it to the new layout. The latest
 * held size is applied once the recording ends, however it ends.
 */
export class LiveCanvasSizeHold {
  private held: { width: number; height: number } | null = null;
  private unsubscribe: (() => void) | null;

  /**
   * @param apply resizes the live engine.
   * @param watchLive subscribes to "is a Live recording running"; the hold
   *   releases itself whenever that becomes false.
   */
  constructor(
    private apply: (width: number, height: number) => void,
    watchLive?: (listener: (live: boolean) => void) => () => void,
  ) {
    this.unsubscribe = watchLive?.((live) => {
      if (!live) {
        this.release();
      }
    }) ?? null;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.held = null;
  }

  /** Apply now, or hold the size while a Live recording is running. */
  resize(width: number, height: number, liveRecording: boolean): void {
    if (liveRecording) {
      this.held = { width, height };
      return;
    }
    this.held = null;
    this.apply(width, height);
  }

  /** Apply the latest held size, if any. Safe to call repeatedly. */
  release(): void {
    const held = this.held;
    if (!held) {
      return;
    }
    this.held = null;
    this.apply(held.width, held.height);
  }

  get isHolding(): boolean {
    return this.held !== null;
  }
}
