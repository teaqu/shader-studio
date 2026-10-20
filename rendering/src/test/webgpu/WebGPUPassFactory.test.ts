import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGPUPassFactory } from "../../webgpu/WebGPUPassFactory";
import { buildSlangPassGraph } from "../../webgpu/SlangPassGraph";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";
import { pipelineCacheKey, wgslCacheKey } from "../../webgpu/WebGPUCompileKeys";
import type { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import type { SlangComputePipeline } from "../../webgpu/SlangComputePipeline";
import type { SlangSourceModule } from "@shader-studio/types";
import type { PendingPipelineCandidates } from "../../webgpu/WebGPUCompilationTypes";

const config = { version: "1", passes: { Image: { inputs: {} } } };
function harness() {
  const graph = buildSlangPassGraph({ imageCode: "void mainImage(out float4 color, float2 coord) {}", config, buffers: {}, canvasWidth: 10, canvasHeight: 10 });
  const session = { compileGeneration: 1, passGraph: graph.passes, currentConfig: config,
    passPipelines: new Map<string, SlangPassPipeline>(), computePipelines: new Map<string, SlangComputePipeline>(), dispatchOnceRan: new Set<string>() };
  const candidate = { resize: vi.fn(), rebuild: vi.fn(async () => [] as string[]) };
  // The factory operates on pipeline capabilities; these tests isolate GPU allocation at that boundary.
  const pipeline = candidate as unknown as SlangPassPipeline;
  session.passPipelines.set("Image", pipeline);
  const keys = new Map([["Image", "old-size"]]);
  const candidates: PendingPipelineCandidates = { generation: 1, render: new Set(), compute: new Set(), resourceManager: null, resourceLoadsPending: 0, resourceManagerDisposed: false, installed: false, settled: false };
  const registerPipelineCandidate = vi.fn(() => true);
  const factory = new WebGPUPassFactory({ session, candidates: { registerPipelineCandidate },
    constraints: { clampResolutionToTextureLimit: (resolution) => resolution }, device: null,
    canvas: { width: 20, height: 20 } as HTMLCanvasElement,
    format: "bgra8unorm", bufferTextureFormat: "rgba16float", disposed: false });
  const computeKeys = new Map([["Image", "old-size"]]);
  const reconcile = (modules: SlangSourceModule[] = []) => factory.reconcileCandidateResolutions(graph, config, session.passPipelines, keys, session.computePipelines, computeKeys, candidates, 1, [], modules);
  return { graph, session, candidate, pipeline, keys, computeKeys, candidates, factory, reconcile, registerPipelineCandidate };
}

afterEach(() => {
  sharedSlangWgslCache.clear();
});

describe("WebGPUPassFactory reconciliation boundaries", () => {
  it("rejects GPU allocation before initialization", () => {
    const { factory, graph } = harness();
    expect(() => factory.createPassPipeline(graph.passes[0], [])).toThrow("device unavailable");
  });

  it("reports a candidate resize failure without publishing a new key", async () => {
    const { candidate, pipeline, candidates, keys, reconcile } = harness();
    candidates.render.add(pipeline);
    candidate.resize.mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal -- Exercise a driver rejection with a non-Error value.
      throw "driver resize error";
    });
    expect(await reconcile()).toEqual(["Image: driver resize error"]);
    expect(keys.get("Image")).toBe("old-size");
  });

  it("rejects uncached installed WGSL without replacing the installed pipeline", async () => {
    const { session, pipeline, reconcile } = harness();
    expect(await reconcile()).toEqual(["Image: compiled WGSL unavailable during resolution reconciliation"]);
    expect(session.passPipelines.get("Image")).toBe(pipeline);
  });

  it("reports replacement compilation diagnostics without publishing the failed replacement", async () => {
    const { graph, factory, session, pipeline, reconcile } = harness();
    sharedSlangWgslCache.set(wgslCacheKey(graph.passes[0], graph.commonCode, [], [], []), { success: true, wgsl: "// WGSL" });
    const replacement = { rebuild: vi.fn(async () => ["invalid pipeline"]) } as unknown as SlangPassPipeline;
    vi.spyOn(factory, "createPassPipeline").mockReturnValue(replacement);
    expect(await reconcile()).toEqual(["Image: invalid pipeline"]);
    expect(session.passPipelines.get("Image")).toBe(pipeline);
  });

  it.each(["render", "compute"] as const)("reconciles %s pipelines with only storage referenced by the pass and its dependencies", async (kind) => {
    const { graph, factory, session, keys, computeKeys, reconcile } = harness();
    const pass = graph.passes[0];
    pass.kind = kind;
    pass.source = "passData[0]";
    pass.vertexSrc = kind === "render" ? "vertexData[0]" : undefined;
    graph.commonCode = "commonData[0]";
    graph.storage = ["unusedData", "passData", "vertexData", "commonData", "moduleData", "otherPassData"].map((name, binding) => ({
      name, binding, elementType: "float", builtin: true, count: 1, stride: 4,
    }));
    const modules: SlangSourceModule[] = [
      { moduleName: "helper", path: "helper.slang", source: "moduleData[0]", ownerPass: "Image" },
      { moduleName: "other", path: "other.slang", source: "otherPassData[0]", ownerPass: "BufferA" },
    ];
    const passModules = [{ moduleName: "helper", path: "helper.slang", source: "moduleData[0]" }];
    sharedSlangWgslCache.set(wgslCacheKey(pass, graph.commonCode, graph.storage, [], passModules), { success: true, wgsl: "// scoped WGSL" });
    const replacement = { rebuild: vi.fn(async () => []) } as unknown as SlangPassPipeline;
    const create = vi.spyOn(factory, "createPassPipeline").mockReturnValue(replacement);
    if (kind === "compute") {
      session.computePipelines.set(pass.name, session.passPipelines.get(pass.name)! as unknown as SlangComputePipeline);
      session.passPipelines.clear();
    }

    expect(await reconcile(modules)).toEqual([]);

    const names = kind === "render"
      ? ["passData", "vertexData", "commonData", "moduleData"]
      : ["passData", "commonData", "moduleData"];
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toEqual(names.map((name, binding) => ({
      name, binding, elementType: "float", builtin: true, count: 1, stride: 4,
    })));
    expect(replacement.rebuild).toHaveBeenCalledWith("// scoped WGSL");
    const pipelines = kind === "render" ? session.passPipelines : session.computePipelines;
    expect(pipelines.get(pass.name)).toBe(replacement);
    expect((kind === "render" ? keys : computeKeys).get(pass.name)).toBe(
      pipelineCacheKey(pass, graph.commonCode, graph.storage, [], passModules),
    );
  });

  it("stops when a replacement no longer belongs to the live candidate generation", async () => {
    const { graph, factory, registerPipelineCandidate, session, pipeline, reconcile } = harness();
    sharedSlangWgslCache.set(wgslCacheKey(graph.passes[0], graph.commonCode, [], [], []), { success: true, wgsl: "// WGSL" });
    const rebuild = vi.fn(async () => []);
    vi.spyOn(factory, "createPassPipeline").mockReturnValue({ rebuild } as unknown as SlangPassPipeline);
    registerPipelineCandidate.mockReturnValue(false);
    expect(await reconcile()).toEqual([]);
    expect(rebuild).not.toHaveBeenCalled();
    expect(session.passPipelines.get("Image")).toBe(pipeline);
  });

  it.each([undefined, 64])('keeps cube faces square during resize (face size %s)', faceSize => {
    const { factory, graph } = harness();
    const pass = graph.passes[0];
    pass.name = "Sky";
    pass.output = "texture";
    pass.outputKind = "cubemap";
    factory.updatePassGraphResolutions(graph.passes, { version: "1", passes: {
      Image: {},
      Sky: { path: "sky.slang", outputKind: "cubemap", ...(faceSize === undefined ? {} : { faceSize }) },
    } });
    expect(pass).toMatchObject({ width: faceSize ?? 512, height: faceSize ?? 512 });
  });

  it("resolves configured texture scaling when the canvas is resized", () => {
    const { factory, graph } = harness();
    const pass = graph.passes[0];
    pass.name = "BufferA";
    pass.output = "texture";
    factory.updatePassGraphResolutions(graph.passes, { version: "1", passes: {
      Image: {}, BufferA: { path: "buffer.slang", resolution: { scale: 0.5 } },
    } });
    expect(pass).toMatchObject({ width: 10, height: 10 });
  });

  it("resizes compute graph dimensions even before the compute pipeline is installed", () => {
    const { factory, graph, session } = harness();
    graph.passes[0].kind = "compute";
    session.passPipelines.clear();
    factory.applyPassResolutions();
    expect(graph.passes[0]).toMatchObject({ width: 20, height: 20 });
  });
});
