import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineOwners } from "./engineOwners";
import { UNIFORM_OFFSETS } from "../../webgpu/SlangPrelude";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import type { VrEyeView } from "../../webxr/WebXrFrameData";
import { WgslCompiler } from "../../webgpu/WgslCompiler";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";

const xrState = vi.hoisted(() => ({
  host: null as any,
  active: false,
  start: vi.fn(async () => {}),
  end: vi.fn(async () => {}),
  dispose: vi.fn(),
  setNavigationSettings: vi.fn(),
}));

vi.mock("../../webxr/WebGpuXrRenderer", () => ({
  WebGpuXrRenderer: class {
    constructor(host: unknown) {
      xrState.host = host;
    }
    get active() {
      return xrState.active;
    }
    start = xrState.start;
    end = xrState.end;
    dispose = xrState.dispose;
    setNavigationSettings = xrState.setNavigationSettings;
  },
}));

vi.mock("../../webgpu/WebGPUPixelRegionCapturer", () => ({
  WebGPUPixelRegionCapturer: class {
    cancelPendingCaptures(): void {}
    encodeAfterRender(): boolean {
      return false;
    }
    beginMappings(): void {}
    dispose(): void {}
  },
}));

const VR_SOURCE = "fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }\nfn mainVR(c: vec2f, o: vec3f, d: vec3f) -> vec4f { return vec4f(d, 1); }";

function webGpuCanvas(): HTMLCanvasElement {
  return {
    width: 800, height: 600,
    getContext: vi.fn(() => ({ configure: vi.fn() })),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

function pipeline(label: string) {
  return {
    uniform: { label: `${label}-uniform` },
    getPipeline: () => ({ label: `${label}-pipeline` }),
    getBindGroup: () => ({ label: `${label}-bind-group` }),
    getUniformBuffer() {
      return this.uniform;
    },
    getCurrentOutputView: () => ({ label: `${label}-view` }),
    getCurrentOutputViews: () => [{ label: `${label}-view` }],
    rebuildBindGroup: vi.fn(),
    swap: vi.fn(),
    dispose: vi.fn(),
  };
}

function setup(passes: Array<Record<string, unknown>> = [
  { name: "BufferA", width: 64, height: 32, output: "texture", kind: "render", geometry: "fullscreen", channels: [], source: "" },
  { name: "Image", width: 640, height: 480, output: "canvas", kind: "render", geometry: "fullscreen", channels: [], source: VR_SOURCE },
]) {
  const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" }, "wgsl");
  engine.initialize(webGpuCanvas());
  const writeBuffer = vi.fn();
  const submit = vi.fn();
  const renderPasses: Array<{ descriptor: GPURenderPassDescriptor; setPipeline: ReturnType<typeof vi.fn>; setBindGroup: ReturnType<typeof vi.fn>; draw: ReturnType<typeof vi.fn> }> = [];
  const device = {
    queue: { writeBuffer, submit },
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn((descriptor: GPURenderPassDescriptor) => {
        const pass = { descriptor, setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
        renderPasses.push(pass);
        return pass;
      }),
      finish: vi.fn(() => ({ label: "commands" })),
    })),
  };
  const owners = engineOwners(engine);
  Object.assign(engine as any, {
    device,
    context: { getCurrentTexture: () => ({ createView: () => ({ label: "canvas" }) }) },
    format: "rgba8unorm",
  });
  const pipelines = new Map(passes.map(pass => [pass.name as string, pipeline(pass.name as string)]));
  (owners.session as any).passGraph = passes;
  (owners.session as any).passPipelines = pipelines;
  return { engine, device, writeBuffer, submit, renderPasses, pipelines, owners };
}

function install(engine: WebGPURenderingEngine, path = "/vr.wgsl"): void {
  const owners = engineOwners(engine);
  (engine as any).vr.update(path, (owners.session as any).passGraph, "");
}

const vrState = (data: ArrayBuffer) => Array.from(new Int32Array(data, UNIFORM_OFFSETS.iVrState, 4));

describe("WebGPU VR engine", () => {
  let createElement: ReturnType<typeof vi.spyOn>;
  const eyeContexts: Array<{ configure: ReturnType<typeof vi.fn>; unconfigure: ReturnType<typeof vi.fn>; getCurrentTexture: ReturnType<typeof vi.fn> }> = [];

  beforeEach(() => {
    xrState.host = null;
    xrState.active = false;
    xrState.start.mockClear();
    xrState.end.mockClear();
    xrState.dispose.mockClear();
    xrState.setNavigationSettings.mockClear();
    eyeContexts.length = 0;
    const original = document.createElement.bind(document);
    createElement = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const element = original(tag);
      if (tag === "canvas") {
        const context = {
          configure: vi.fn(),
          unconfigure: vi.fn(),
          getCurrentTexture: vi.fn(() => ({ createView: () => ({ label: `eye-${eyeContexts.indexOf(context)}` }) })),
        };
        eyeContexts.push(context);
        (element as HTMLCanvasElement).getContext = vi.fn(() => context) as never;
      }
      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    createElement.mockRestore();
  });

  it("reports availability from the installed fullscreen Image", () => {
    const { engine, owners } = setup();
    expect(engine.isVrPreviewAvailable()).toBe(false);
    install(engine);
    expect(engine.isVrPreviewAvailable()).toBe(true);
    (owners.session as any).passGraph = [];
    expect(engine.isVrPreviewAvailable()).toBe(false);
  });

  it("detects availability when a shader is installed", () => {
    const { engine, owners } = setup();
    (owners.session as any).commonCode = "";
    (engine as any).session.host.onShaderInstalled("/vr.wgsl");
    expect(engine.isVrPreviewAvailable()).toBe(true);
  });

  it("flags the desktop preview for Image only, and controllers and session state for every pass", () => {
    const { engine, writeBuffer } = setup();
    install(engine);
    engine.render(1000);
    expect(writeBuffer.mock.calls.map(call => vrState(call[2]))).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]]);

    engine.setVrPreviewEnabled(true);
    (engine as any).vr.active = true;
    (engine as any).vr.controllers.buttons[0] = 0.75;
    writeBuffer.mockClear();
    engine.render(1100);
    const [buffer, image] = writeBuffer.mock.calls.map(call => call[2] as ArrayBuffer);
    expect(vrState(buffer)).toEqual([0, 0, 1, 0]);
    expect(vrState(image)).toEqual([1, 0, 1, 0]);
    const buttons = UNIFORM_OFFSETS.iVrControllers + 2 * 32;
    expect(new Float32Array(buffer, buttons, 1)[0]).toBe(0.75);
    expect(new Float32Array(image, buttons, 1)[0]).toBe(0.75);
  });

  it("ignores enabling the preview for a shader without mainVR", () => {
    const { engine, writeBuffer } = setup([{ name: "Image", width: 8, height: 8, output: "canvas", kind: "render", geometry: "fullscreen", channels: [], source: "fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }" }]);
    install(engine);
    engine.setVrPreviewEnabled(true);
    engine.render(1000);
    expect(vrState(writeBuffer.mock.calls[0][2])).toEqual([0, 0, 0, 0]);
  });

  it("draws each headset eye with its own size, ray transform, and offscreen canvas", () => {
    const { engine, writeBuffer, submit, renderPasses, pipelines } = setup();
    install(engine);
    engine.render(1000);
    writeBuffer.mockClear();
    submit.mockClear();
    const ray = Float32Array.from({ length: 16 }, (_, index) => index);
    const eye: VrEyeView = { viewport: { x: 0, y: 0, width: 300, height: 200 }, rayTransform: ray };
    const left = xrState.host.renderEye(eye, 0) as HTMLCanvasElement;
    const right = xrState.host.renderEye({ ...eye, viewport: { x: 0, y: 0, width: 320, height: 240 } }, 1) as HTMLCanvasElement;

    expect(left).not.toBe(right);
    expect([left.width, left.height, right.width, right.height]).toEqual([300, 200, 320, 240]);
    expect(eyeContexts[0]!.configure).toHaveBeenCalledWith(expect.objectContaining({ format: "rgba8unorm", alphaMode: "opaque", device: (engine as any).device }));
    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(writeBuffer.mock.calls[0][0]).toBe(pipelines.get("Image")!.uniform);
    const data = writeBuffer.mock.calls[0][2] as ArrayBuffer;
    expect(Array.from(new Float32Array(data, 0, 2))).toEqual([300, 200]);
    expect(vrState(data)).toEqual([0, 1, 0, 0]);
    expect(Array.from(new Float32Array(data, UNIFORM_OFFSETS.iVrViewport, 4))).toEqual([0, 0, 300, 200]);
    expect(Array.from(new Float32Array(data, UNIFORM_OFFSETS.iVrRayTransform, 16))).toEqual(Array.from(ray));
    expect(submit).toHaveBeenCalledTimes(2);
    const eyePass = renderPasses.at(-2)!;
    expect((eyePass.descriptor.colorAttachments as GPURenderPassColorAttachment[])[0]!.view).toEqual({ label: "eye-0" });
    expect(eyePass.setPipeline).toHaveBeenCalledWith({ label: "Image-pipeline" });
    expect(eyePass.setBindGroup).toHaveBeenCalledWith(0, { label: "Image-bind-group" });
    expect(eyePass.draw).toHaveBeenCalledWith(3);

    expect(xrState.host.renderEye(eye, 0)).toBe(left);
    expect(eyeContexts).toHaveLength(2);
  });

  it("returns no eye image before a frame, without a device, Image pipeline, or WebGPU canvas context", () => {
    const eye: VrEyeView = { viewport: { x: 0, y: 0, width: 4, height: 4 }, rayTransform: new Float32Array(16) };
    const { engine, pipelines } = setup();
    install(engine);
    expect(xrState.host.renderEye(eye, 0)).toBeNull();

    engine.render(1000);
    pipelines.delete("Image");
    expect(xrState.host.renderEye(eye, 0)).toBeNull();

    (engine as any).device = null;
    expect(xrState.host.renderEye(eye, 1)).toBeNull();

    const fresh = setup();
    fresh.engine.render(1000);
    createElement.mockImplementation((() => ({ getContext: () => null })) as never);
    expect(xrState.host.renderEye(eye, 0)).toBeNull();
  });

  it("clamps an eye to the device texture limit", () => {
    const { engine, owners } = setup();
    install(engine);
    engine.render(1000);
    owners.constraints.maxTextureDimension2D = 256;
    const canvas = xrState.host.renderEye({ viewport: { x: 0, y: 0, width: 1000, height: 100 }, rayTransform: new Float32Array(16) }, 0) as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([256, 100]);
  });

  it("drives the XR host through the engine loop and frame", () => {
    const { engine } = setup();
    const render = vi.spyOn(engine, "render");
    xrState.host.updateFrame(42);
    expect(render).toHaveBeenCalledWith(42);
    expect(xrState.host.isRunning()).toBe(false);
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(7);
    xrState.host.startRenderLoop();
    expect(xrState.host.isRunning()).toBe(true);
    xrState.host.stopRenderLoop();
    expect(xrState.host.isRunning()).toBe(false);
    raf.mockRestore();
  });

  it("keeps the desktop loop stopped while a headset session is active", () => {
    const { engine } = setup();
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(1);
    xrState.active = true;
    engine.startRenderLoop();
    expect(raf).not.toHaveBeenCalled();
    xrState.active = false;
    engine.startRenderLoop();
    expect(raf).toHaveBeenCalledOnce();
    engine.stopRenderLoop();
    raf.mockRestore();
  });

  it("enters and exits through the XR renderer once the device is ready", async () => {
    const uninitialized = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" }, "wgsl");
    await expect(uninitialized.enterVr()).rejects.toThrow("not initialized");
    await expect(uninitialized.exitVr()).resolves.toBeUndefined();

    const { engine } = setup();
    const ended = vi.fn();
    await engine.enterVr(ended);
    expect(xrState.start).toHaveBeenCalledWith(ended);
    await engine.exitVr();
    expect(xrState.end).toHaveBeenCalledOnce();

    (engine as any).device = null;
    await expect(engine.enterVr()).rejects.toThrow("device is not ready");
  });

  it("shares normalized navigation speeds with the desktop camera and headset", () => {
    const { engine } = setup();
    const setSpeeds = vi.spyOn((engine as any).cameraManager, "setSpeeds");
    engine.setVrNavigationSettings({ movement: true, movementSpeed: 99, turning: "smooth", snapAngle: 45, turnSpeed: 120 });
    expect(setSpeeds).toHaveBeenCalledWith(10, 120);
    expect(xrState.setNavigationSettings).toHaveBeenLastCalledWith(expect.objectContaining({ movementSpeed: 10, turning: "smooth" }));
  });

  it("applies earlier navigation settings to a renderer created on initialize", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" }, "slang");
    engine.setVrNavigationSettings({ movement: true, movementSpeed: 4, turning: "snap", snapAngle: 60, turnSpeed: 90 });
    engine.initialize(webGpuCanvas());
    expect(xrState.setNavigationSettings).toHaveBeenLastCalledWith(expect.objectContaining({ movementSpeed: 4, snapAngle: 60 }));
  });

  it("reports headset support from WebXR", async () => {
    const { engine } = setup();
    const xr = { isSessionSupported: vi.fn(async () => true) };
    Object.defineProperty(navigator, "xr", { value: xr, configurable: true });
    try {
      await expect(engine.isImmersiveVrSupported()).resolves.toBe(true);
      expect(xr.isSessionSupported).toHaveBeenCalledWith("immersive-vr");
    } finally {
      delete (navigator as { xr?: unknown }).xr;
    }
    await expect(engine.isImmersiveVrSupported()).resolves.toBe(false);
  });

  it("disposes the XR renderer and unconfigures eye canvases", () => {
    const { engine } = setup();
    install(engine);
    engine.render(1000);
    xrState.host.renderEye({ viewport: { x: 0, y: 0, width: 4, height: 4 }, rayTransform: new Float32Array(16) }, 0);
    (engine as any).device = { destroy: vi.fn() };
    engine.dispose();
    expect(xrState.dispose).toHaveBeenCalledOnce();
    expect(eyeContexts[0]!.unconfigure).toHaveBeenCalledOnce();
  });

  it("replaces the XR renderer when initialized again", () => {
    const { engine } = setup();
    const first = xrState.host;
    engine.initialize(webGpuCanvas());
    expect(xrState.dispose).toHaveBeenCalledOnce();
    expect(xrState.host).not.toBe(first);
  });
});

describe("WebGPU VR availability through compilation", () => {
  function compilingEngine() {
    sharedSlangWgslCache.clear();
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" }, "wgsl");
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn(async () => ({ messages: [] })) })),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      queue: { writeBuffer: vi.fn(), submit: vi.fn(), writeTexture: vi.fn(), copyExternalImageToTexture: vi.fn() },
      createCommandEncoder: vi.fn(() => ({ beginRenderPass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() })), finish: vi.fn(() => ({})) })),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(async () => null),
    };
    Object.assign(engine as any, {
      canvas: { width: 32, height: 16 }, device, compiler: new WgslCompiler(), format: "bgra8unorm",
      context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
    });
    return { engine, device };
  }

  it("becomes available for mainVR in Common and publishes the installed Common source", async () => {
    const { engine, device } = compilingEngine();
    const vr = "fn mainVR(c: vec2f, o: vec3f, d: vec3f) -> vec4f { return vec4f(d, 1); }";
    const result = await engine.compileShaderPipeline("fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }",
      { version: "1.0", passes: { Image: {}, common: { path: "common.wgsl" } } } as never, "/vr.wgsl", { common: vr });
    expect(result?.success, JSON.stringify(result)).toBe(true);
    expect(engineOwners(engine).session.commonCode).toContain("fn mainVR");
    expect(engine.isVrPreviewAvailable()).toBe(true);
    const module = device.createShaderModule.mock.calls.at(-1) as unknown as [{ code: string }];
    expect(module[0].code).toContain("return _ss_vrImage(");

    const plain = await engine.compileShaderPipeline("fn mainImage(c: vec2f) -> vec4f { return vec4f(0.5); }", null, "/vr.wgsl", {});
    expect(plain?.success).toBe(true);
    expect(engineOwners(engine).session.commonCode).toBe("");
    expect(engine.isVrPreviewAvailable()).toBe(false);
  });

  it.each(["discardInstalledGeneration", "detachPipelines"] as const)("forgets Common when the session runs %s", method => {
    const { engine } = compilingEngine();
    const session = engineOwners(engine).session;
    session.commonCode = "fn mainVR() {}";
    session[method]();
    expect(session.commonCode).toBe("");
  });
});
