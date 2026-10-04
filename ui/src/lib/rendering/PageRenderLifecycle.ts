export interface RenderLoopController {
  startRenderLoop(): void;
  stopRenderLoop(): void;
}

/** Stops GPU work while the app is backgrounded and redraws immediately on
 * resume. User pause state belongs to the engine clock and is not changed. */
export class PageRenderLifecycle {
  private readonly handleVisibilityChange = (): void => {
    const engine = this.getEngine();
    if (!engine) {
      return;
    }
    if (this.page.visibilityState === 'hidden') {
      engine.stopRenderLoop();
    } else {
      engine.startRenderLoop();
    }
  };

  constructor(
    private readonly page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
    private readonly getEngine: () => RenderLoopController | null,
  ) {
    page.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  dispose(): void {
    this.page.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
