import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGPUPassFactory } from "../../webgpu/WebGPUPassFactory";
import { buildSlangPassGraph } from "../../webgpu/SlangPassGraph";
import { sharedSlangWgslCache } from "../../webgpu/SlangWgslCache";
import { wgslCacheKey } from "../../webgpu/WebGPUCompileKeys";
import type { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";
import type { SlangComputePipeline } from "../../webgpu/SlangComputePipeline";
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
  const reconcile = () => factory.reconcileCandidateResolutions(graph, config, session.passPipelines, keys, session.computePipelines, new Map(), candidates, 1, [], []);
  return { graph, session, candidate, pipeline, keys, candidates, factory, reconcile, registerPipelineCandidate };
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

  it("resizes compute graph dimensions even before the compute pipeline is installed", () => {
    const { factory, graph, session } = harness();
    graph.passes[0].kind = "compute";
    session.passPipelines.clear();
    factory.applyPassResolutions();
    expect(graph.passes[0]).toMatchObject({ width: 20, height: 20 });
  });
});
