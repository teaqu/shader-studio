import { buildVrEyeView, readVrControllers, type VrControllerData, type VrEyeView } from "./WebXrFrameData";
import { WebXrEyeCompositor } from "./WebXrEyeCompositor";
import { WebXrLocomotion } from "./WebXrLocomotion";
import { WebXrSession, type WebXrFrame } from "./WebXrSession";
import type { VrNavigationSettings } from "./VrNavigationSettings";

export interface WebGpuXrHost {
  readonly vr: {
    readonly available: boolean;
    active: boolean;
    controllers: VrControllerData;
    resetSession(): void;
  };
  isRunning(): boolean;
  startRenderLoop(): void;
  stopRenderLoop(): void;
  /** One simulation update and desktop mirror per headset frame. */
  updateFrame(time: number): void;
  /** Renders one eye at its own origin and returns the image to composite, or null. */
  renderEye(view: VrEyeView, eye: number): TexImageSource | null;
}

const MAIN_VR_REQUIRED = "The current fullscreen Image shader must define mainVR";

/** The XR layer needs an XR-compatible WebGL2 context, separate from the WebGPU canvas. */
function createXrCompatibleContext(): WebGL2RenderingContext | null {
  return document.createElement("canvas").getContext("webgl2", {
    xrCompatible: true, alpha: false, antialias: false, depth: false, stencil: false,
  });
}

/** Bridges one XR frame to one WebGPU simulation update and one Image draw per eye. */
export class WebGpuXrRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private session: WebXrSession | null = null;
  private compositor: WebXrEyeCompositor | null = null;
  private restoreLoop = false;
  private disposed = false;
  private starting = false;
  private locomotion = new WebXrLocomotion();
  private onEnded: ((error?: string) => void) | undefined;

  constructor(private readonly host: WebGpuXrHost, private readonly createContext = createXrCompatibleContext) {}

  get active(): boolean {
    return this.session?.active ?? false;
  }

  setNavigationSettings(settings: VrNavigationSettings): void {
    this.locomotion.configure(settings);
  }

  async start(onEnded?: (error?: string) => void): Promise<void> {
    if (this.disposed) {
      throw new Error("VR renderer is disposed");
    }
    if (!this.host.vr.available) {
      throw new Error(MAIN_VR_REQUIRED);
    }
    if (this.active || this.starting) {
      throw new Error("VR is already active");
    }
    // Synchronous setup keeps requestSession inside the button's user activation.
    const session = this.ensureSession();
    this.starting = true;
    this.onEnded = onEnded;
    try {
      await session.start();
    } catch (error) {
      this.onEnded = undefined;
      throw error;
    } finally {
      this.starting = false;
    }
  }

  end(): Promise<void> {
    return this.session?.end() ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.session?.dispose();
    this.compositor?.dispose();
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.session = null;
    this.compositor = null;
    this.gl = null;
  }

  private ensureSession(): WebXrSession {
    if (this.session && this.gl && !this.gl.isContextLost()) {
      return this.session;
    }
    this.session?.dispose();
    this.compositor?.dispose();
    const gl = this.createContext();
    if (!gl) {
      throw new Error("Headset rendering requires WebGL2");
    }
    this.gl = gl;
    this.compositor = new WebXrEyeCompositor(gl);
    this.session = new WebXrSession(gl, {
      start: () => {
        if (!this.host.vr.available) {
          throw new Error(MAIN_VR_REQUIRED);
        }
        this.restoreLoop = this.host.isRunning();
        this.host.stopRenderLoop();
        this.locomotion.reset();
        this.host.vr.active = true;
      },
      frame: (time, data) => this.render(gl, time, data),
      end: error => {
        this.locomotion.reset();
        this.host.vr.resetSession();
        if (!this.disposed && this.restoreLoop) {
          this.host.startRenderLoop();
        }
        this.restoreLoop = false;
        this.onEnded?.(error);
        this.onEnded = undefined;
      },
    });
    return this.session;
  }

  private render(gl: WebGL2RenderingContext, time: number, data: WebXrFrame): void {
    if (!this.host.vr.available) {
      void this.session?.end();
      return;
    }
    const controllers = readVrControllers(data.frame, data.reference);
    this.locomotion.update(time, data.pose?.transform?.matrix ?? null, controllers);
    this.locomotion.transformControllers(controllers);
    this.host.vr.controllers = controllers;
    this.host.updateFrame(time);
    gl.bindFramebuffer(gl.FRAMEBUFFER, data.layer.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    try {
      (data.pose?.views ?? []).forEach((view, index) => {
        const viewport = data.layer.getViewport(view);
        if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
          return;
        }
        const eye = buildVrEyeView(view, viewport);
        this.locomotion.transformEye(eye);
        // Each eye renders into its own texture, so its fragCoord origin is zero.
        const image = this.host.renderEye({ ...eye, viewport: { x: 0, y: 0, width: viewport.width, height: viewport.height } }, index);
        if (image) {
          this.compositor!.draw(data.layer.framebuffer, eye.viewport, image);
        }
      });
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }
}
