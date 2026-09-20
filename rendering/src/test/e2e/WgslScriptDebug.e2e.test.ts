import { expect, it, vi } from "vitest";
import { WgslDebugEngine } from "@shader-studio/debug";
import type { DebugWorkspace } from "@shader-studio/types";
import type { CaptureResult, IVariableCapturer } from "../../capture/VariableCapturer";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

const image = `fn mainImage(coord: vec2f) -> vec4f {
  let uv = coord / iResolution.xy;
  let src = iChannel0Sample(uv);
  let scale = tint * gain;
  let col = src.rgb * scale;
  let depth = iChannel0Sample(uv).a;
  return vec4f(col * depth, 1.0);
}`;
// Script uniforms reach every pass, so a debug plan must still compile a
// buffer that reads one.
const buffer = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(coord / iResolution.xy, 0.5 + 0.0 * gain, 1.0); }";
const uniforms = [
  { name: "gain", type: "float", value: 0.75 },
  { name: "tint", type: "vec3", value: [1, 0.5, 0.25] },
  { name: "unused", type: "float", value: 0.125 },
] as const;
const uniformInfo = uniforms.map(({ name, type }) => ({ name, type }));
const config = { version: "1.0", script: "./chain.uniforms.ts", passes: {
  BufferA: { path: "chain.buffer.wgsl", inputs: {} },
  Image: { inputs: { iChannel0: { type: "buffer" as const, source: "BufferA" } } },
} };

async function captureResults(capturer: IVariableCapturer, expectedCount: number) {
  const deadline = performance.now() + 5_000;
  const results: CaptureResult[] = [];
  while (performance.now() < deadline) {
    results.push(...capturer.collectResults());
    if (results.length === expectedCount) {
      return results;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`WGSL capture timed out: ${capturer.getLastError() ?? "no result"}`);
}

it("previews and captures locals typed by script uniforms in a WGSL debug plan", { timeout: 30_000 }, async () => {
  const harness = createShaderCanvasHarness("wgsl");
  try {
    await harness.compile({
      path: "/shaders/chain.wgsl", image, buffers: { BufferA: buffer }, config,
      customUniformDeclarations: "uniform float gain;\nuniform vec3 tint;\nuniform float unused;",
      customUniformInfo: uniformInfo,
      customUniformValues: uniforms.map(uniform => ({ ...uniform, value: Array.isArray(uniform.value) ? [...uniform.value] : uniform.value })),
    });
    const workspace: DebugWorkspace = {
      rootUri: "file:///shaders/chain.wgsl", rootPath: "/shaders/chain.wgsl", passName: "Image", contentHash: "chain",
      channels: [{ name: "iChannel0", slot: 0, kind: "texture-2d" }], customUniforms: uniformInfo,
      files: [{ uri: "file:///shaders/chain.wgsl", path: "/shaders/chain.wgsl", source: image, version: 1, moduleName: "", ownerPass: "Image" }],
    };
    const request = { workspace, sourceUri: workspace.rootUri, position: { line: 6, character: 2 } };
    const debug = new WgslDebugEngine();
    const analysis = debug.analyze(request);
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics.map(item => item.message).join("\n"));
    }
    // Script uniforms are engine inputs, not locals: they stay out of the inspector.
    expect(analysis.analysis.visibleValues.map(value => value.name))
      .toEqual(["coord", "uv", "src", "scale", "col", "depth", "_dbgReturn"]);

    const scale = analysis.analysis.visibleValues.find(value => value.name === "scale")!;
    const preview = debug.planPreviewValue(request, scale.id, { normalizeMode: "off", stepEdge: null });
    expect(preview.ok).toBe(true);
    if (!preview.ok) {
      throw new Error(preview.diagnostics.map(item => item.message).join("\n"));
    }
    expect(await harness.engine.compileDebugPlan?.(preview.plan, config)).toMatchObject({ success: true });
    for (const pixel of await harness.renderAndReadPixels()) {
      expect(pixel[0]).toBeGreaterThanOrEqual(191);
      expect(pixel[0]).toBeLessThanOrEqual(192);
      expect(pixel[1]).toBeGreaterThanOrEqual(95);
      expect(pixel[1]).toBeLessThanOrEqual(96);
      expect(pixel[2]).toBeGreaterThanOrEqual(47);
      expect(pixel[2]).toBeLessThanOrEqual(48);
      expect(pixel[3]).toBe(255);
    }

    const plan = debug.planCapture(request, analysis.analysis.visibleValues.map(value => value.id));
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      throw new Error(plan.diagnostics.map(item => item.message).join("\n"));
    }
    const capturer = harness.engine.createVariableCapturer();
    try {
      capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(image, "Image", "/shaders/chain.wgsl"));
      capturer.setCustomUniforms("", harness.engine.getCurrentCustomUniforms());
      const root = plan.plan.files.find(file => file.uri === plan.plan.rootUri)!;
      const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: root.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
      expect(await capturer.issueCaptureGrid(captures, harness.engine.getCaptureUniforms(), 1, 1)).toBe(captures.length);
      const results = await captureResults(capturer, captures.length);
      expect(results.map(result => result.varName)).not.toContain("gain");
      expect([...results.find(result => result.varName === "scale")!.rgba]).toEqual([0.75, 0.375, 0.1875, 1]);
      expect(capturer.getLastError()).toBeNull();
    } finally {
      capturer.dispose();
    }
  } finally {
    harness.dispose();
  }
});

it("compiles and captures targeted inferred builtin and operator results", { timeout: 30_000 }, async () => {
  const source = [
    "fn mainImage(coord: vec2f) -> vec4f {",
    "  let bits = bitcast<vec2u>(vec2f(1.0, 2.0));",
    "  let leading = countLeadingZeros(bits);",
    "  let matrix = mat2x3f(1.0, 2.0, 3.0, 4.0, 5.0, 6.0);",
    "  let transposed = transpose(matrix);",
    "  let column = transposed[0];",
    "  let scaled = matrix * 0.5;",
    "  let scaledColumn = scaled[1];",
    "  let compared = vec2f(0.25, 0.75) < vec2f(0.5);",
    "  let comparisonX = compared.x;",
    "  return vec4f(column, scaledColumn.x, select(0.0, 1.0, comparisonX));",
    "}",
  ].join("\n");
  const config = { version: "1.0", passes: { Image: { inputs: {} } } };
  const harness = createShaderCanvasHarness("wgsl");
  try {
    await harness.compile({ path: "/shaders/inference.wgsl", image: source, config });
    const workspace: DebugWorkspace = {
      rootUri: "file:///shaders/inference.wgsl",
      rootPath: "/shaders/inference.wgsl",
      passName: "Image",
      contentHash: "inference",
      files: [{ uri: "file:///shaders/inference.wgsl", path: "/shaders/inference.wgsl", source, version: 1, moduleName: "", ownerPass: "Image" }],
    };
    const request = { workspace, sourceUri: workspace.rootUri, position: { line: 10, character: 2 } };
    const debug = new WgslDebugEngine();
    const analysis = debug.analyze(request);
    expect(analysis).toMatchObject({ ok: true });
    if (!analysis.ok) {
      return;
    }
    const names = analysis.analysis.visibleValues.map(value => value.name);
    expect(names).toEqual(expect.arrayContaining(["bits", "leading", "column", "scaledColumn", "comparisonX"]));
    expect(names).not.toEqual(expect.arrayContaining(["matrix", "transposed", "scaled", "compared"]));
    const selected = analysis.analysis.visibleValues.filter(value => ["bits", "leading", "column", "scaledColumn", "comparisonX"].includes(value.name));
    const plan = debug.planCapture(request, selected.map(value => value.id));
    if (!plan.ok) {
      throw new Error(plan.diagnostics.map(item => item.message).join("\n"));
    }
    const capturer = harness.engine.createVariableCapturer();
    try {
      capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(source, "Image", "/shaders/inference.wgsl"));
      const root = plan.plan.files.find(file => file.uri === plan.plan.rootUri)!;
      const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: root.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
      expect(await capturer.issueCaptureGrid(captures, harness.engine.getCaptureUniforms(), 1, 1)).toBe(captures.length);
      const results = await captureResults(capturer, captures.length);
      expect([...results.find(result => result.varName === "bits")!.rgba]).toEqual([1_065_353_216, 1_073_741_824, 0, 1]);
      expect([...results.find(result => result.varName === "leading")!.rgba]).toEqual([2, 1, 0, 1]);
      expect([...results.find(result => result.varName === "column")!.rgba]).toEqual([1, 4, 0, 1]);
      expect([...results.find(result => result.varName === "scaledColumn")!.rgba]).toEqual([2, 2.5, 3, 1]);
      expect([...results.find(result => result.varName === "comparisonX")!.rgba]).toEqual([1, 1, 1, 1]);
      expect(capturer.getLastError()).toBeNull();
    } finally {
      capturer.dispose();
    }
  } finally {
    harness.dispose();
  }
});

// No channel inputs, so capture can compile at once instead of waiting for the
// pending compile's pass textures; only the script's declarations are at stake.
const pendingImage = `fn mainImage(coord: vec2f) -> vec4f {
  let scale = tint * gain;
  return vec4f(scale, 1.0);
}`;
const pendingConfig = { version: "1.0", script: "./chain.uniforms.ts", passes: { Image: { inputs: {} } } };

// Regression: the engine only exposed script uniforms once a compile installed,
// while capture already used the pending compile's source. A capture issued
// before the first install (debug turned on during a slow first compile) built
// its shader without the script's declarations and failed with "unresolved
// value" / "[Invalid ShaderModule]", leaving the inspector empty.
it("declares script uniforms in a capture issued before the first compile installs", { timeout: 30_000 }, async () => {
  const harness = createShaderCanvasHarness("wgsl");
  try {
    const { engine } = harness;
    // Capture needs the GPU device, not an installed shader.
    const capturer = await vi.waitFor(() => engine.createVariableCapturer());
    try {
      // The host streams value updates, which the engine holds until a
      // compile declares them.
      engine.updateCustomUniformValues(uniforms.map(uniform => ({ ...uniform, value: Array.isArray(uniform.value) ? [...uniform.value] : uniform.value })));
      // Not awaited: debug can turn on while a script-driven shader's first
      // compile is still running, so capture starts before anything installs.
      const firstCompile = engine.compileShaderPipeline(
        pendingImage, pendingConfig, "/shaders/pending.wgsl", {},
        "uniform float gain;\nuniform vec3 tint;\nuniform float unused;", uniformInfo,
      );
      capturer.setCompileContext(engine.getVariableCaptureCompileContext(pendingImage, "Image", "/shaders/pending.wgsl"));
      capturer.setCustomUniforms(engine.getCustomUniformDeclarations(), engine.getCurrentCustomUniforms());
      const workspace: DebugWorkspace = {
        rootUri: "file:///shaders/pending.wgsl", rootPath: "/shaders/pending.wgsl", passName: "Image", contentHash: "pending",
        channels: [], customUniforms: uniformInfo,
        files: [{ uri: "file:///shaders/pending.wgsl", path: "/shaders/pending.wgsl", source: pendingImage, version: 1, moduleName: "", ownerPass: "Image" }],
      };
      const request = { workspace, sourceUri: workspace.rootUri, position: { line: 2, character: 2 } };
      const debug = new WgslDebugEngine();
      const analysis = debug.analyze(request);
      if (!analysis.ok) {
        throw new Error(analysis.diagnostics.map(item => item.message).join("\n"));
      }
      const scale = analysis.analysis.visibleValues.find(value => value.name === "scale")!;
      const plan = debug.planCapture(request, [scale.id]);
      if (!plan.ok) {
        throw new Error(plan.diagnostics.map(item => item.message).join("\n"));
      }
      const root = plan.plan.files.find(file => file.uri === plan.plan.rootUri)!;
      const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: root.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
      const issued = await capturer.issueCaptureGrid(captures, engine.getCaptureUniforms(), 1, 1);
      expect({ issued, error: capturer.getLastError() }).toEqual({ issued: captures.length, error: null });
      expect((await firstCompile)?.success).toBe(true);
      const results = await captureResults(capturer, captures.length);
      expect([...results.find(result => result.varName === "scale")!.rgba]).toEqual([0.75, 0.375, 0.1875, 1]);
      expect(capturer.getLastError()).toBeNull();
    } finally {
      capturer.dispose();
    }
  } finally {
    harness.dispose();
  }
});
