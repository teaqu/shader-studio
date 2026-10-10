import { expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import VrPreviewButton from "../../lib/components/menu/VrPreviewButton.svelte";
import { updateVrPreviewContext } from "../../lib/state/vrPreviewState.svelte";
import { createShaderCanvasHarness } from "../../../../rendering/src/test/e2e/ShaderCanvasHarness";

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

class TestXrSession extends EventTarget {
  inputSources: XRInputSource[] = [];
  private frameCallback: XRFrameRequestCallback | null = null;
  private nextFrame = 1;

  updateRenderState(): void {}
  async requestReferenceSpace(): Promise<XRReferenceSpace> {
    return {} as XRReferenceSpace;
  }
  requestAnimationFrame(callback: XRFrameRequestCallback): number {
    this.frameCallback = callback;
    return this.nextFrame++;
  }
  cancelAnimationFrame(): void {
    this.frameCallback = null;
  }
  async end(): Promise<void> {
    this.dispatchEvent(new Event("end"));
  }
  render(time: number, frame: XRFrame): void {
    this.frameCallback?.(time, frame);
  }
}

/** Browser-only WebXR fixture: it owns an actual texture-backed stereo framebuffer. */
class TestXrLayer {
  readonly framebuffer: WebGLFramebuffer;
  constructor(_session: XRSession, gl: WebGL2RenderingContext) {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  getViewport(view: XRView): XRViewport {
    return { x: view.eye === "left" ? 0 : 2, y: 0, width: 2, height: 2 } as XRViewport;
  }
}

function makeView(eye: XREye, eyeX: number, frustumX: number): XRView {
  const projection = identity();
  projection[8] = frustumX;
  const transform = identity();
  transform[12] = eyeX;
  return { eye, projectionMatrix: projection, transform: { matrix: transform } } as XRView;
}

function rgba(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, x: number): [number, number, number, number] {
  const pixel = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.readPixels(x, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return [...pixel] as [number, number, number, number];
}

it("enters immersive VR from the UI, draws tracked asymmetric stereo rays and restores mainImage on exit", async () => {
  const harness = createShaderCanvasHarness("glsl");
  const target = document.createElement("div");
  document.body.append(target);
  const gl = harness.canvas.getContext("webgl2")!;
  const originalXr = navigator.xr;
  const xrGlobals = globalThis as typeof globalThis & { XRWebGLLayer?: typeof XRWebGLLayer };
  const originalLayer = xrGlobals.XRWebGLLayer;
  const session = new TestXrSession();
  Object.defineProperty(gl, "makeXRCompatible", { configurable: true, value: async () => {} });
  Object.defineProperty(navigator, "xr", {
    configurable: true,
    value: { isSessionSupported: async () => true, requestSession: async () => session },
  });
  Object.defineProperty(xrGlobals, "XRWebGLLayer", { configurable: true, value: TestXrLayer });
  const component = mount(VrPreviewButton, { target });
  try {
    await harness.compile({ image: `
      void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0, 0.0, 0.0, 1.0); }
      void mainVR(out vec4 color, in vec2 coord, in vec3 origin, in vec3 direction) {
        color = vec4(origin.x * 0.5 + 0.5, direction.x * 0.5 + 0.5, iVRControllerButtons[0].x, 1.0);
      }`, path: "immersive.glsl" });
    updateVrPreviewContext(harness.engine, "immersive.glsl");
    await tick();
    await Promise.resolve();
    await tick();
    expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));

    const enter = target.querySelector<HTMLButtonElement>('button[aria-label="Enter VR"]')!;
    expect(enter).toBeTruthy();
    session.inputSources = [{
      handedness: "left",
      targetRaySpace: {} as XRSpace,
      gamepad: { buttons: [{ value: 0.8 }], axes: [] } as unknown as Gamepad,
    } as XRInputSource];
    enter.click();
    // Session setup crosses requestSession, makeXRCompatible and reference-space awaits.
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
    await tick();
    expect(target.querySelector('button[aria-label="Exit VR"]')).toBeTruthy();

    const frame = {
      session,
      getViewerPose: () => ({ views: [makeView("left", -0.5, -0.25), makeView("right", 0.5, 0.25)] }),
      getPose: () => ({ transform: { matrix: identity() } }),
    } as unknown as XRFrame;
    session.render(1000, frame);
    const layer = (harness.engine as unknown as { immersiveVr: { session: { layer: TestXrLayer } } }).immersiveVr.session.layer;
    const left = rgba(gl, layer.framebuffer, 1);
    const right = rgba(gl, layer.framebuffer, 3);
    // Origin is in red, asymmetric projection shifts the right-eye ray green, and blue is controller button 0.
    expect(left[0]).toBeGreaterThan(45);
    expect(left[0]).toBeLessThan(85);
    expect(right[0]).toBeGreaterThan(170);
    expect(right[0]).toBeLessThan(210);
    expect(right[1]).toBeGreaterThan(left[1] + 20);
    expect(left[2]).toBeGreaterThan(190);
    expect(right[2]).toBeGreaterThan(190);

    target.querySelector<HTMLButtonElement>('button[aria-label="Exit VR"]')!.click();
    await Promise.resolve();
    await tick();
    harness.holdFrames();
    expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));
  } finally {
    updateVrPreviewContext(null, "");
    await unmount(component);
    target.remove();
    Object.defineProperty(navigator, "xr", { configurable: true, value: originalXr });
    Object.defineProperty(xrGlobals, "XRWebGLLayer", { configurable: true, value: originalLayer });
    harness.dispose();
  }
});
