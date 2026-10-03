import { describe, expect, it } from "vitest";
import type { DebugInstrumentationPlan, DebugSourceUnit, ShaderConfig } from "@shader-studio/types";
import { debugPlanDisplaySource } from "../../webgpu/DebugPlanDisplaySource";

const root: DebugSourceUnit = {
  uri: "/buffer.wgsl", path: "/buffer.wgsl", ownerPass: "BufferA", moduleName: "", version: 1,
  source: "struct Outputs { @location(0) color: vec4f, @location(1) normal: vec4f, @builtin(frag_depth) depth: f32, }\n@fragment fn shade() -> Outputs { return Outputs(vec4f(1), vec4f(0), 0.5); }",
};
const plan: DebugInstrumentationPlan = {
  rootUri: root.uri, selectedSourceUri: root.uri, files: [root], captureSlots: [], executionMarkerSlot: 0,
  workspaceHash: "mrt", nativeRender: { fragmentEntryPoint: "shade", output: 1 },
};

describe("native MRT debug canvas projection", () => {
  it("projects the selected buffer attachment and retains authored depth without mutating capture plans", () => {
    const config = { version: "1", passes: {
      Image: { entryPoints: { fragment: "shade" }, outputs: [{}, {}], geometry: { type: "cube" } },
      BufferA: { path: root.path, entryPoints: { fragment: "shade" }, outputs: [{}, {}] },
    } } as ShaderConfig;
    const result = debugPlanDisplaySource(root, plan, config, "wgsl");
    if (typeof result === "string") {
      throw new Error(result);
    }
    expect(result.source).toContain("result.normal, result.depth");
    expect(result.config?.passes.Image).not.toHaveProperty("outputs");
    expect(result.config?.passes.BufferA).toBe(config.passes.BufferA);
    expect(config.passes.Image).toHaveProperty("outputs");
    expect(plan.files[0]!.source).toBe(root.source);
    expect(result.config?.passes.Image.geometry).toEqual({ type: "cube" });
  });

  it("keeps single-output and hook plans unchanged", () => {
    expect(debugPlanDisplaySource(root, plan, null, "wgsl")).toEqual({ source: root.source, config: null });
    expect(debugPlanDisplaySource(root, { ...plan, nativeRender: undefined }, null, "wgsl")).toEqual({ source: root.source, config: null });
  });

  it("reports an invalid selected attachment before installing a display shader", () => {
    const config: ShaderConfig = { version: "1", passes: { Image: {}, BufferA: { path: root.path, outputs: [{}, {}] } } };
    expect(debugPlanDisplaySource(root, { ...plan, nativeRender: { fragmentEntryPoint: "shade", output: 2 } }, config, "wgsl"))
      .toContain("could not be projected");
  });
});
