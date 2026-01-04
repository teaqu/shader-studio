import { RenderingEngine } from '@shader-studio/rendering/RenderingEngine';

interface ThumbnailRequest {
  canvas: HTMLCanvasElement;
  code: string;
  config: any;
  path: string;
  buffers: Record<string, string>;
  resolve: (dataUrl: string | null) => void;
}

class ThumbnailRenderer {
  private queue: ThumbnailRequest[] = [];
  private processing = false;
  private engine: RenderingEngine | null = null;
  private currentCanvas: HTMLCanvasElement | null = null;

  async renderThumbnail(
    canvas: HTMLCanvasElement,
    code: string,
    config: any,
    path: string,
    buffers: Record<string, string>
  ): Promise<string | null> {
    return new Promise((resolve) => {
      this.queue.push({ canvas, code, config, path, buffers, resolve });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      const dataUrl = await this.renderSingle(request);
      request.resolve(dataUrl);
    }

    // Clean up the engine when done
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.engine.dispose();
      this.engine = null;
      this.currentCanvas = null;
    }

    this.processing = false;
  }

  private async renderSingle(request: ThumbnailRequest): Promise<string | null> {
    try {
      // If we're switching canvases, recreate the engine
      if (this.currentCanvas !== request.canvas || !this.engine) {
        if (this.engine) {
          this.engine.stopRenderLoop();
          this.engine.dispose();
        }

        const gl = request.canvas.getContext('webgl2');
        if (!gl) {
          console.warn('WebGL2 not supported');
          return null;
        }

        this.engine = new RenderingEngine();
        this.engine.initialize(request.canvas);
        this.currentCanvas = request.canvas;
      }

      console.log('Rendering thumbnail for:', request.path);

      const result = await this.engine.compileShaderPipeline(
        request.code,
        request.config,
        request.path,
        request.buffers
      );

      if (result?.success) {
        // Wait for a frame to render
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Capture the canvas as an image
        const dataUrl = request.canvas.toDataURL('image/png');
        console.log('Captured thumbnail');
        return dataUrl;
      }

      return null;
    } catch (err) {
      console.error('Failed to render thumbnail:', err);
      return null;
    }
  }
}

// Export a singleton instance
export const thumbnailRenderer = new ThumbnailRenderer();
