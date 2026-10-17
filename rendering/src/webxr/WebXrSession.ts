/// <reference types="webxr" />
export interface WebXrFrame {
  frame: XRFrame;
  reference: XRReferenceSpace;
  pose: XRViewerPose | null;
  layer: XRWebGLLayer;
}

interface Callbacks {
  start(): void;
  frame(time: number, data: WebXrFrame): void;
  end(error?: string): void;
}

export async function isImmersiveVrSupported(): Promise<boolean> {
  try {
    return await navigator.xr?.isSessionSupported("immersive-vr") ?? false;
  } catch {
    return false;
  }
}

/** Owns the user-initiated WebXR session and its animation loop. */
export class WebXrSession {
  private session: XRSession | null = null;
  private reference: XRReferenceSpace | null = null;
  private layer: XRWebGLLayer | null = null;
  private pending = false;
  private disposed = false;
  private started = false;
  private error: string | undefined;
  private raf: number | null = null;

  constructor(private gl: WebGL2RenderingContext, private callbacks: Callbacks) {}

  get active(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.disposed || this.pending || this.session) {
      throw new Error("VR session is already starting, active, or disposed");
    }
    if (!navigator.xr) {
      throw new Error("WebXR is unavailable in this browser");
    }
    this.pending = true;
    this.error = undefined;
    try {
      // This call must happen before the first await to preserve the button's user activation.
      const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] });
      if (this.disposed) {
        await session.end();
        throw new Error("VR preview was disposed during startup");
      }
      this.session = session;
      session.addEventListener("end", this.finish);
      await this.gl.makeXRCompatible();
      this.assertSession(session);
      this.layer = new XRWebGLLayer(session, this.gl, { alpha: false, depth: false, stencil: false, antialias: false });
      session.updateRenderState({ baseLayer: this.layer });
      this.reference = await session.requestReferenceSpace("local-floor").catch(() => session.requestReferenceSpace("local"));
      this.assertSession(session);
      this.started = true;
      this.callbacks.start();
      this.gl.canvas.addEventListener("webglcontextlost", this.contextLost);
      this.raf = session.requestAnimationFrame(this.frame);
    } catch (error) {
      await this.end();
      throw error;
    } finally {
      this.pending = false;
    }
  }

  private assertSession(session: XRSession): void {
    if (this.disposed || this.session !== session) {
      throw new Error("VR session ended during startup");
    }
  }

  private frame = (time: number, frame: XRFrame): void => {
    this.raf = null;
    if (!this.started || frame.session !== this.session || !this.reference || !this.layer) {
      return;
    }
    try {
      this.callbacks.frame(time, { frame, reference: this.reference, pose: frame.getViewerPose(this.reference) ?? null, layer: this.layer });
      if (this.started && this.session) {
        this.raf = this.session.requestAnimationFrame(this.frame);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      void this.end();
    }
  };

  private contextLost = (): void => {
    this.error = "WebGL context lost during VR";
    void this.end();
  };

  async end(): Promise<void> {
    const session = this.session;
    if (session) {
      try {
        await session.end();
      } catch (error) {
        if (this.session === session) {
          this.error ??= error instanceof Error ? error.message : String(error);
        }
      } finally {
        if (this.session === session) {
          this.finish();
        }
      }
    }
  }

  private finish = (): void => {
    const session = this.session;
    if (!session) {
      return;
    }
    if (this.raf !== null) {
      session.cancelAnimationFrame(this.raf);
    }
    session.removeEventListener("end", this.finish);
    this.gl.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.session = null;
    this.reference = null;
    this.layer = null;
    this.raf = null;
    const started = this.started;
    this.started = false;
    if (started) {
      this.callbacks.end(this.error);
    }
  };

  dispose(): void {
    this.disposed = true;
    void this.end();
  }
}
