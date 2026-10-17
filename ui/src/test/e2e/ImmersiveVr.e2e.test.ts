import { expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import VrPreviewButton from "../components/fixtures/VrPaneHarness.svelte";
import { updateVrPreviewContext, updateVrNavigationSettings } from "../../lib/state/vrPreviewState.svelte";
import { createShaderCanvasHarness } from "../../../../rendering/src/test/e2e/ShaderCanvasHarness";

import controllerLab from "../../../../docs/assets/shaders/vr-controller-lab.glsl?raw";

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
  static eyeSize = 2;
  private readonly eyeSize = TestXrLayer.eyeSize;
  readonly framebuffer: WebGLFramebuffer;
  constructor(_session: XRSession, gl: WebGL2RenderingContext) {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.eyeSize * 2, this.eyeSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  getViewport(view: XRView): XRViewport {
    return { x: view.eye === "left" ? 0 : this.eyeSize, y: 0, width: this.eyeSize, height: this.eyeSize } as XRViewport;
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
      #define SHADER_STUDIO_VR_INPUTS
      void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0, 0.0, 0.0, 1.0); }
      void mainVR(out vec4 color, in vec2 coord, in vec3 origin, in vec3 direction) {
        color = vec4(origin.x * 0.5 + 0.5, direction.x * 0.5 + 0.5, iVRControllerButtons[0].x, 1.0);
      }`, path: "immersive.glsl" });
    updateVrPreviewContext(harness.engine, "immersive.glsl");
    await tick();
    await Promise.resolve();
    await tick();
    expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));
    target.querySelector<HTMLButtonElement>('button[aria-label="VR"]')!.click();
    await tick();
    const enter = [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Enter VR')!;
    expect(enter).toBeTruthy();
    const leftAxes = [0, 0, 0, 0];
    const rightAxes = [0, 0, 0, 0];
    session.inputSources = [{
      handedness: "left",
      targetRaySpace: {} as XRSpace,
      gamepad: { buttons: [{ value: 0.8, touched: true }, { value: 0.6 }, { value: 0 }, { value: 1 }, { value: 0.4, touched: true }, { value: 0.2 }], axes: leftAxes } as unknown as Gamepad,
    } as XRInputSource, {
      handedness: "right",
      targetRaySpace: {} as XRSpace,
      gamepad: { buttons: [], axes: rightAxes } as unknown as Gamepad,
    } as XRInputSource];
    enter.click();
    // Session setup crosses requestSession, makeXRCompatible and reference-space awaits.
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
    await tick();
    expect([...target.querySelectorAll('button')].some(button => button.textContent === 'Exit VR')).toBe(true);

    const frame = {
      session,
      getViewerPose: () => ({ transform: { matrix: identity() }, views: [makeView("left", -0.5, -0.25), makeView("right", 0.5, 0.25)] }),
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

    // Default settings do not consume sticks for camera movement.
    leftAxes[2] = 1;
    session.render(1100, frame);
    expect(rgba(gl, layer.framebuffer, 1)).toEqual(left);
    updateVrNavigationSettings({ movement: true, turning: 'snap' });
    session.render(1200, frame);
    const movedLeft = rgba(gl, layer.framebuffer, 1);
    const movedRight = rgba(gl, layer.framebuffer, 3);
    // The held left trigger boosts movement by 3x.
    expect(movedLeft[0]).toBeGreaterThan(left[0] + 60);
    expect(movedRight[0]).toBeGreaterThan(right[0] + 20);
    expect(movedLeft[2]).toBeGreaterThan(190);
    leftAxes[2] = 0;
    // Right thumbstick changes view direction once until released.
    rightAxes[2] = 1;
    session.render(1300, frame);
    const turned = rgba(gl, layer.framebuffer, 1);
    expect(turned[1]).toBeGreaterThan(movedLeft[1] + 20);
    session.render(1400, frame);
    expect(rgba(gl, layer.framebuffer, 1)).toEqual(turned);

    await harness.compile({ image: `
      #define SHADER_STUDIO_VR_INPUTS
      void mainImage(out vec4 c, in vec2 p) { c = vec4(1, 0, 0, 1); }
      void mainVR(out vec4 c, in vec2 p, in vec3 o, in vec3 d) {
        c = vec4(iVRControllerFaceButtons[0].xy, iVRControllerTouches[0].x, iVRControllerFaceTouches[0].x);
      }`, path: "immersive.glsl" });
    session.render(1500, frame);
    expect(rgba(gl, layer.framebuffer, 1)).toEqual([102, 51, 255, 255]);

    // Forward follows headset pitch, including vertical movement.
    await harness.compile({ image: `
      void mainImage(out vec4 c, in vec2 p) { c = vec4(1, 0, 0, 1); }
      void mainVR(out vec4 c, in vec2 p, in vec3 o, in vec3 d) { c = vec4(o.y * 0.5 + 0.5, 0, 0, 1); }
    `, path: "immersive.glsl" });
    updateVrNavigationSettings({ movement: true, turning: 'off' });
    const pitched = identity();
    pitched[9] = -1;
    pitched[10] = 0;
    const pitchedFrame = { ...frame, getViewerPose: () => ({ transform: { matrix: pitched }, views: [makeView("left", -0.5, 0), makeView("right", 0.5, 0)] }) } as unknown as XRFrame;
    leftAxes[2] = 0;
    leftAxes[3] = -1;
    session.render(1600, pitchedFrame);
    const raised = rgba(gl, layer.framebuffer, 1)[0];
    expect(raised).toBeGreaterThan(180);
    pitched[9] = 1;
    session.render(1700, pitchedFrame);
    expect(rgba(gl, layer.framebuffer, 1)[0]).toBeLessThan(raised - 60);

    [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Exit VR')!.click();
    await Promise.resolve();
    await tick();
    harness.holdFrames();
    expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));
  } finally {
    updateVrNavigationSettings({ movement: false, turning: 'off' });
    updateVrPreviewContext(null, "");
    await unmount(component);
    target.remove();
    Object.defineProperty(navigator, "xr", { configurable: true, value: originalXr });
    Object.defineProperty(xrGlobals, "XRWebGLLayer", { configurable: true, value: originalLayer });
    harness.dispose();
  }
});


it("renders a distinct Controller Lab response for each supported Quest control with navigation disabled", async () => {
  const harness = createShaderCanvasHarness("glsl");
  const gl = harness.canvas.getContext("webgl2")!;
  const originalXr = navigator.xr;
  const originalLayer = (globalThis as typeof globalThis & { XRWebGLLayer?: typeof XRWebGLLayer }).XRWebGLLayer;
  const session = new TestXrSession();
  const buttons = [Array.from({ length: 6 }, () => ({ value: 0, touched: false })), Array.from({ length: 6 }, () => ({ value: 0, touched: false }))];
  const axes = [Array(4).fill(0), Array(4).fill(0)];
  TestXrLayer.eyeSize = 32;
  Object.defineProperty(gl, "makeXRCompatible", { configurable: true, value: async () => {} });
  Object.defineProperty(navigator, "xr", { configurable: true, value: { isSessionSupported: async () => true, requestSession: async () => session } });
  Object.defineProperty(globalThis, "XRWebGLLayer", { configurable: true, value: TestXrLayer });
  try {
    await harness.compile({ image: controllerLab, path: "vr-controller-lab.glsl" });
    harness.engine.setVrNavigationSettings?.({ movement: false, turning: 'off', movementSpeed: 2, snapAngle: 30, turnSpeed: 90 });
    session.inputSources = ['left', 'right'].map((handedness, hand) => ({ handedness, targetRaySpace: {}, gamepad: { buttons: buttons[hand], axes: axes[hand] } })) as unknown as XRInputSource[];
    await harness.engine.enterVr?.();
    const frame = {
      session,
      getViewerPose: () => ({ transform: { matrix: identity() }, views: [makeView("left", -0.03, 0), makeView("right", 0.03, 0)] }),
      getPose: () => ({ transform: { matrix: identity() } }),
    } as unknown as XRFrame;
    const layer = (harness.engine as unknown as { immersiveVr: { session: { layer: TestXrLayer } } }).immersiveVr.session.layer;
    const read = () => {
      session.render(1000, frame);
      const pixels = new Uint8Array(64 * 32 * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.readPixels(0, 0, 64, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return pixels;
    };
    const baseline = read();
    expect(baseline.some((value, index) => index % 4 !== 3 && value > 30)).toBe(true);
    const effects: Uint8Array[] = [];
    for (const [hand, button, name] of [[0, 0, 'left trigger'], [1, 0, 'right trigger'], [0, 1, 'left grip'], [1, 1, 'right grip'], [0, 3, 'left click'], [1, 3, 'right click'], [0, 4, 'X'], [0, 5, 'Y'], [1, 4, 'A'], [1, 5, 'B']] as const) {
      buttons[hand][button].value = 1;
      const changed = read();
      expect(changed, name).not.toEqual(baseline);
      effects.push(changed);
      buttons[hand][button].value = 0;
      expect(read(), `${name} released`).toEqual(baseline);
    }
    for (const hand of [0, 1]) {
      for (const axis of [2, 3]) {
        axes[hand][axis] = 0.7;
        expect(read(), `hand ${hand} axis ${axis}`).not.toEqual(baseline);
        axes[hand][axis] = 0;
        expect(read()).toEqual(baseline);
      }
    }
    for (const hand of [0, 1]) {
      for (const button of [0, 1, 3, 4, 5]) {
        buttons[hand][button].touched = true;
        expect(read(), `hand ${hand} touch ${button}`).not.toEqual(baseline);
        buttons[hand][button].touched = false;
        expect(read()).toEqual(baseline);
      }
    }
    const controllerPose = identity();
    controllerPose[12] = 0.5;
    const movedFrame = { ...frame, getPose: () => ({ transform: { matrix: controllerPose } }) } as unknown as XRFrame;
    session.render(1000, movedFrame);
    const movedBeam = new Uint8Array(64 * 32 * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.readPixels(0, 0, 64, 32, gl.RGBA, gl.UNSIGNED_BYTE, movedBeam);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    expect(movedBeam).not.toEqual(baseline);
    expect(new Set(effects.map(pixels => Array.from(pixels).join(','))).size).toBe(effects.length);
  } finally {
    await harness.engine.exitVr?.();
    harness.dispose();
    TestXrLayer.eyeSize = 2;
    Object.defineProperty(navigator, "xr", { configurable: true, value: originalXr });
    Object.defineProperty(globalThis, "XRWebGLLayer", { configurable: true, value: originalLayer });
  }
});
