import { describe, expect, it, vi } from "vitest";
import { wrapSlangImageSource } from "../../webgpu/SlangPrelude";
import { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { DEFAULT_PREVIEW_SETTINGS } from "../../preview3d/types";

describe("WebGPU 3D preview shader variant", () => {
  it("adds a mesh entry point with a preview binding after dense channel pairs", () => {
    const source = wrapSlangImageSource("float4 mainImage(float2 p) { return float4(p, 0, 1); }", {
      geometry: "mesh",
      channels: [{ slot: 3, key: "texture", kind: "texture" }],
    });

    expect(source).toContain("[[vk::binding(3, 0)]]");
    expect(source).toContain("float3 position : POSITION");
    expect(source).toContain("float2 uv : TEXCOORD0");
    expect(source).toContain("float3 normal : NORMAL");
    expect(source).toContain("column_major float4x4 model");
    expect(source).toContain("column_major float4x4 viewProjection");
    expect(source).toContain("column_major float4x4 normalMatrix");
    expect(source).toContain("[[vk::location(0)]] float3 position : POSITION");
    expect(source).toContain("[[vk::location(1)]] float3 normal : NORMAL");
    expect(source).toContain("[[vk::location(2)]] float2 uv : TEXCOORD0");
    expect(source).toContain("1.0 - abs(frac(value * 0.5) * 2.0 - 1.0)");
    expect(source).toContain("_preview.mapping");
    expect(source).toContain("return float4(color.rgb * light, color.a)");
  });

  it("creates indexed mesh pipelines with depth and a preview uniform buffer", async () => {
    const createBuffer = vi.fn(() => ({ destroy: vi.fn() }));
    const device = {
      createShaderModule: vi.fn(() => ({ getCompilationInfo: vi.fn().mockResolvedValue({ messages: [] }) })),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createBuffer,
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
    } as unknown as GPUDevice;
    const pass = new SlangPassPipeline(device, "bgra8unorm", {
      name: "Image",
      width: 64,
      height: 64,
      output: "canvas",
      channels: [],
      geometry: "mesh",
    });

    await pass.rebuild("wgsl");

    expect((device.createRenderPipeline as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true },
      vertex: { buffers: [{ arrayStride: 32 }] },
    });
    expect(createBuffer).toHaveBeenCalledTimes(2);
    expect(pass.getPreviewUniformBuffer()).not.toBeNull();
  });

  it.each([
    ["2D to 3D", "3d", false],
    ["3D to 2D", "2d", true],
  ] as const)("clears instead of drawing during a %s pipeline mismatch", (_label, mode, isMesh) => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    const draw = vi.fn(); const beginRenderPass = vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw, end: vi.fn() }));
    (engine as any).device = { queue: { writeBuffer: vi.fn(), submit: vi.fn() }, createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) };
    (engine as any).context = { getCurrentTexture: () => ({ createView: () => ({}) }) };
    (engine as any).canvas = { width: 32, height: 32 };
    (engine as any).passGraph = [{ name: "Image", width: 32, height: 32, output: "canvas", channels: [] }];
    (engine as any).passPipelines = new Map([["Image", {
      getPipeline: () => ({}), getBindGroup: () => ({}), getUniformBuffer: () => ({}), isMesh: () => isMesh,
      getCurrentOutputView: () => null, rebuildBindGroup: vi.fn(), swap: vi.fn(),
    }]]);
    (engine as any).previewSettings = { ...DEFAULT_PREVIEW_SETTINGS, mode };
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      engine.render(1);
    } finally {
      info.mockRestore();
    }
    expect(draw).not.toHaveBeenCalled();
    expect(beginRenderPass).toHaveBeenCalledTimes(1);
  });

  it("reports transient preview geometry mismatches as informational state instead of a hard error", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    const draw = vi.fn(); const beginRenderPass = vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw, end: vi.fn() }));
    (engine as any).device = { queue: { writeBuffer: vi.fn(), submit: vi.fn() }, createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) };
    (engine as any).context = { getCurrentTexture: () => ({ createView: () => ({}) }) };
    (engine as any).canvas = { width: 32, height: 32 };
    (engine as any).passGraph = [{ name: "Image", width: 32, height: 32, output: "canvas", channels: [] }];
    (engine as any).passPipelines = new Map([["Image", {
      getPipeline: () => ({}), getBindGroup: () => ({}), getUniformBuffer: () => ({}), isMesh: () => false,
      getCurrentOutputView: () => null, rebuildBindGroup: vi.fn(), swap: vi.fn(),
    }]]);
    (engine as any).previewSettings = { ...DEFAULT_PREVIEW_SETTINGS, mode: "3d" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      engine.render(1);
      expect(error).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith("3D preview is waiting for a compatible final Image pipeline");
    } finally {
      error.mockRestore();
      info.mockRestore();
    }
  });

  it("returns the generation-safe mode-switch compilation result instead of fire-and-forget", async () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    (engine as any).lastCompile = { code: "code", path: "/image.slang", buffers: {} };
    const failure = { success: false, errors: ["mesh compile failed"] };
    vi.spyOn(engine, "compileShaderPipeline").mockResolvedValue(failure);

    const result = await engine.setPreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, mode: "3d" });

    expect(result).toEqual(failure);
    expect(engine.compileShaderPipeline).toHaveBeenCalledWith("code", null, "/image.slang", {}, undefined, undefined);
  });

  it("keeps engine settings intact when the preview scene rejects an update", async () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    const previous = { ...DEFAULT_PREVIEW_SETTINGS, mode: "2d" as const };
    (engine as any).previewSettings = previous;
    (engine as any).previewScene = { setSettings: () => {
      throw new Error("allocation failed");
    } };

    const result = await engine.setPreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, mode: "3d" });

    expect(result).toEqual({ success: false, errors: ["WebGPU 3D preview update failed: allocation failed"] });
    expect((engine as any).previewSettings).toBe(previous);
  });

  it("keeps shader mouse and keyboard input while disabling only free-fly camera in every 3D state", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    const mouse = { setEnabled: vi.fn() }; const keyboard = { setEnabled: vi.fn() }; const camera = { setEnabled: vi.fn() };
    (engine as any).mouseManager = mouse; (engine as any).keyboardManager = keyboard; (engine as any).cameraManager = camera;
    (engine as any).previewSettings = { ...DEFAULT_PREVIEW_SETTINGS, mode: "3d" };
    engine.setPreviewInputEnabled(false);

    expect(mouse.setEnabled).toHaveBeenLastCalledWith(true);
    expect(keyboard.setEnabled).toHaveBeenLastCalledWith(true);
    expect(camera.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("clears and recovers when preview depth allocation fails during encoding", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    const draw = vi.fn(); const end = vi.fn(); const beginRenderPass = vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw, end }));
    (engine as any).device = { queue: { writeBuffer: vi.fn(), submit: vi.fn() }, createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) };
    (engine as any).context = { getCurrentTexture: () => ({ createView: () => ({}) }) };
    (engine as any).canvas = { width: 32, height: 32 };
    (engine as any).passGraph = [{ name: "Image", width: 32, height: 32, output: "canvas", channels: [] }];
    (engine as any).passPipelines = new Map([["Image", { getPipeline: () => ({}), getBindGroup: () => ({}), getUniformBuffer: () => ({}), isMesh: () => true, rebuildBindGroup: vi.fn() }]]);
    (engine as any).previewSettings = { ...DEFAULT_PREVIEW_SETTINGS, mode: "3d" };
    (engine as any).previewScene = { getDepthView: () => {
      throw new Error("depth lost");
    } };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      engine.render(1);
    } finally {
      error.mockRestore();
    }
    expect(draw).not.toHaveBeenCalled();
    expect(beginRenderPass).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledOnce();
  });

  it("sizes 3D depth and camera uniforms from the actual canvas texture", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    const renderPass = {
      setPipeline: vi.fn(), setBindGroup: vi.fn(), setVertexBuffer: vi.fn(),
      setIndexBuffer: vi.fn(), draw: vi.fn(), drawIndexed: vi.fn(), end: vi.fn(),
    };
    const beginRenderPass = vi.fn(() => renderPass);
    (engine as any).device = {
      queue: { writeBuffer: vi.fn(), submit: vi.fn() },
      createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }),
    };
    (engine as any).context = {
      getCurrentTexture: () => ({ width: 64, height: 48, createView: () => ({}) }),
    };
    (engine as any).canvas = { width: 32, height: 32 };
    (engine as any).passGraph = [{ name: "Image", width: 32, height: 32, output: "canvas", channels: [] }];
    (engine as any).passPipelines = new Map([["Image", {
      getPipeline: () => ({}), getBindGroup: () => ({}), getUniformBuffer: () => ({}),
      isMesh: () => true, rebuildBindGroup: vi.fn(),
    }]]);
    (engine as any).previewSettings = { ...DEFAULT_PREVIEW_SETTINGS, mode: "3d" };
    const previewScene = {
      getDepthView: vi.fn(() => ({})),
      encodeGrid: vi.fn(),
      writePreviewUniforms: vi.fn(),
      encodeMesh: vi.fn(),
      encodeAxes: vi.fn(),
    };
    (engine as any).previewScene = previewScene;

    engine.render(1);

    expect(previewScene.getDepthView).toHaveBeenCalledWith(64, 48);
    expect(previewScene.encodeGrid).toHaveBeenCalledWith(renderPass, 64, 48);
    expect(previewScene.writePreviewUniforms).toHaveBeenCalledWith(expect.anything(), 64, 48);
    expect(previewScene.encodeAxes).toHaveBeenCalledWith(renderPass, 64, 48);
  });

  it("never submits a depth-enabled mesh pipeline without a 3D preview scene", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    const setPipeline = vi.fn(); const draw = vi.fn();
    const beginRenderPass = vi.fn(() => ({ setPipeline, setBindGroup: vi.fn(), draw, end: vi.fn() }));
    (engine as any).device = {
      queue: { writeBuffer: vi.fn(), submit: vi.fn() },
      createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }),
    };
    (engine as any).context = {
      getCurrentTexture: () => ({ width: 32, height: 32, createView: () => ({}) }),
    };
    (engine as any).canvas = { width: 32, height: 32 };
    (engine as any).passGraph = [{ name: "Image", width: 32, height: 32, output: "canvas", channels: [] }];
    (engine as any).passPipelines = new Map([["Image", {
      getPipeline: () => ({}), getBindGroup: () => ({}), getUniformBuffer: () => ({}),
      isMesh: () => true, rebuildBindGroup: vi.fn(),
    }]]);
    (engine as any).previewSettings = { ...DEFAULT_PREVIEW_SETTINGS, mode: "3d" };
    (engine as any).previewScene = null;

    engine.render(1);

    expect(setPipeline).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    expect(beginRenderPass).toHaveBeenCalledTimes(1);
  });

  it("ends a partially encoded preview pass, reports once, and retries the next frame", () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    const end = vi.fn(); const beginRenderPass = vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end }));
    (engine as any).device = { queue: { writeBuffer: vi.fn(), submit: vi.fn() }, createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) };
    (engine as any).context = { getCurrentTexture: () => ({ createView: () => ({}) }) };
    (engine as any).canvas = { width: 32, height: 32 };
    (engine as any).passGraph = [{ name: "Image", width: 32, height: 32, output: "canvas", channels: [] }];
    (engine as any).passPipelines = new Map([["Image", { getPipeline: () => ({}), getBindGroup: () => ({}), getUniformBuffer: () => ({}), isMesh: () => true, rebuildBindGroup: vi.fn() }]]);
    (engine as any).previewSettings = { ...DEFAULT_PREVIEW_SETTINGS, mode: "3d" };
    (engine as any).previewScene = { getDepthView: () => ({}), encodeGrid: () => {
      throw new Error("grid lost");
    } };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      engine.render(1); engine.render(2);
    } finally {
      error.mockRestore();
    }
    expect(end).toHaveBeenCalledTimes(4);
    expect((engine as any).previewRenderFailureReported).toBe(true);
  });
});
