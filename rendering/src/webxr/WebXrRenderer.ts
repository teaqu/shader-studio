import type { FrameRenderer } from "../webgl/FrameRenderer";
import type { PassRenderer } from "../webgl/PassRenderer";
import { buildVrEyeView, readVrControllers } from "./WebXrFrameData";
import { WebXrSession, type WebXrFrame } from "./WebXrSession";

/** Bridges one XR frame to one simulation update and one Image draw per eye. */
export class WebXrRenderer {
  private session: WebXrSession;
  private restoreLoop = false;
  private disposed = false;
  private starting = false;
  private onEnded: ((error?: string) => void) | undefined;

  constructor(private gl: WebGL2RenderingContext, private frameRenderer: FrameRenderer, private passRenderer: PassRenderer, private updateFrame: (time: number) => void) {
    this.session = new WebXrSession(gl, {
      start: () => {
        if (!passRenderer.vrPreview.available) {
          throw new Error("The current fullscreen GLSL shader must define mainVR");
        }
        this.restoreLoop = frameRenderer.isRunning();
        frameRenderer.stopRenderLoop();
        passRenderer.xr.active = true;
      },
      frame: (time, data) => this.render(time, data),
      end: error => {
        passRenderer.xr.reset();
        if (!this.disposed && !gl.isContextLost() && this.restoreLoop) {
          frameRenderer.startRenderLoop();
        }
        this.restoreLoop = false;
        this.onEnded?.(error);
        this.onEnded = undefined;
      },
    });
  }

  get active(): boolean {
    return this.session.active;
  }

  async start(onEnded?: (error?: string) => void): Promise<void> {
    if (!this.passRenderer.vrPreview.available) {
      throw new Error("The current fullscreen GLSL shader must define mainVR");
    }
    if (this.active || this.starting) {
      throw new Error("VR is already active");
    }
    this.starting = true;
    this.onEnded = onEnded;
    try {
      await this.session.start();
    } catch (error) {
      this.onEnded = undefined;
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private render(time: number, data: WebXrFrame): void {
    if (!this.passRenderer.vrPreview.available) {
      void this.session.end();
      return;
    }
    this.passRenderer.xr.controllers = readVrControllers(data.frame, data.reference);
    // Desktop mirror/buffers are updated once, never once per eye.
    this.updateFrame(time);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, data.layer.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    try {
      for (const view of data.pose?.views ?? []) {
        const viewport = data.layer.getViewport(view);
        if (viewport && viewport.width > 0 && viewport.height > 0) {
          this.frameRenderer.renderVrView(data.layer.framebuffer, buildVrEyeView(view, viewport));
        }
      }
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    }
  }

  end(): Promise<void> {
    return this.session.end();
  }

  dispose(): void {
    this.disposed = true;
    this.session.dispose();
  }
}
