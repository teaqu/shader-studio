import { describe, expect, it } from "vitest";
import { SlangDebugEngine, WgslDebugEngine } from "@shader-studio/debug";
import type { DebugWorkspace, ShaderConfig } from "@shader-studio/types";
import type { CaptureResult, IVariableCapturer } from "../../capture/VariableCapturer";
import { imageConfigForActiveRenderPass } from "../../../../ui/src/lib/nativeRenderConfig";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

async function collect(capturer: IVariableCapturer, count: number): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    results.push(...capturer.collectResults());
    if (results.length === count) {
      return results;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(capturer.getLastError() ?? "Native Buffer capture did not resolve");
}

function sources(language: "wgsl" | "slang"): { image: string; buffer: string } {
  if (language === "wgsl") {
    return {
      image: `fn mainImage(coord: vec2f) -> vec4f {
  return iChannel0Sample(coord / iResolution.xy);
}`,
      buffer: `struct Varyings { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn bufferVertex(@builtin(vertex_index) index: u32) -> Varyings {
  let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return Varyings(vec4f(p[index],0,1), p[index] * 0.5 + 0.5);
}
@fragment fn bufferFragment(input: Varyings) -> @location(0) vec4f {
  let debugValue = vec4f(input.uv, iResolution.x / 8.0, iResolution.y / 4.0);
  return debugValue;
}`,
    };
  }
  return {
    image: `float4 mainImage(float2 coord) {
  return iChannel0.Sample(coord / iResolution.xy);
}`,
    buffer: `struct Varyings { float4 position : SV_Position; float2 uv : TEXCOORD0; };
[shader("vertex")] Varyings bufferVertex(uint index : SV_VertexID) {
  float2 p[3] = {float2(-1,-1),float2(3,-1),float2(-1,3)};
  Varyings output; output.position = float4(p[index],0,1); output.uv = p[index] * 0.5 + 0.5; return output;
}
[shader("fragment")] float4 bufferFragment(Varyings input) : SV_Target0 {
  float4 debugValue = float4(input.uv, iResolution.x / 8.0, iResolution.y / 4.0);
  return debugValue;
}`,
  };
}

describe("native Buffer capture at a scaled display pixel", () => {
  it.each(["wgsl", "slang"] as const)("uses the %s Buffer resolution for authored varyings, preview, capture, and restore", { timeout: 30_000 }, async language => {
    const { image, buffer } = sources(language);
    const imagePath = `/native-buffer-resolution/image.${language}`;
    const bufferPath = `/native-buffer-resolution/buffer.${language}`;
    const config: ShaderConfig = {
      version: "1.0",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        BufferA: {
          path: bufferPath,
          resolution: { width: 8, height: 4 },
          entryPoints: { vertex: "bufferVertex", fragment: "bufferFragment" },
        },
      },
    };
    const harness = createShaderCanvasHarness(language);
    try {
      // The canvas is 4x2 while BufferA renders at its fixed 8x4 resolution.
      harness.resize(4, 2);
      await harness.compile({ path: imagePath, image, buffers: { BufferA: buffer }, config });
      const original = await harness.renderAndReadPixels();
      expect(original).not.toEqual(Array(4).fill(original[0]));

      const workspace: DebugWorkspace = {
        rootUri: bufferPath,
        rootPath: bufferPath,
        passName: "BufferA",
        render: { entryPoint: "bufferFragment" },
        contentHash: "native-buffer-resolution",
        files: [{ uri: bufferPath, path: bufferPath, source: buffer, version: 1, moduleName: "", ownerPass: "BufferA" }],
      };
      const request = { workspace, sourceUri: bufferPath, position: { line: 6, character: 2 } };
      const debug = language === "wgsl" ? new WgslDebugEngine() : new SlangDebugEngine();
      const analysis = debug.analyze(request);
      if (!analysis.ok) {
        throw new Error(analysis.diagnostics[0]?.message);
      }
      const value = analysis.analysis.visibleValues.find(candidate => candidate.name === "debugValue");
      expect(value).toBeDefined();
      const preview = debug.planPreview(request, { normalizeMode: "off", stepEdge: null });
      if (!preview.ok) {
        throw new Error(preview.diagnostics[0]?.message);
      }
      const previewConfig = imageConfigForActiveRenderPass(config, "BufferA");
      expect(await harness.engine.compileDebugPlan?.(preview.plan, previewConfig)).toMatchObject({ success: true });
      // Preview keeps the authored varying: x rises across and y falls down the canvas.
      const previewPixels = await harness.renderAndReadPixels();
      expect(previewPixels.map(pixel => pixel[0])).toEqual([32, 96, 32, 96]);
      expect(previewPixels.map(pixel => pixel[1])).toEqual([191, 191, 64, 64]);
      expect(previewPixels.every(pixel => pixel[2] === 128 && pixel[3] === 128)).toBe(true);

      const plan = debug.planCapture(request, [value!.id]);
      if (!plan.ok) {
        throw new Error(plan.diagnostics[0]?.message);
      }
      await harness.compile({ path: imagePath, image, buffers: { BufferA: buffer }, config });
      const capturer = harness.engine.createVariableCapturer();
      try {
        capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(buffer, "BufferA", bufferPath));
        const root = plan.plan.files.find(file => file.uri === plan.plan.rootUri)!;
        const captures = plan.plan.captureSlots.map(slot => ({
          varName: slot.name, varType: slot.typeName, captureShader: root.source,
          selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan,
        }));
        // Native capture maps the displayed pixel centre, so (3,1) maps to source texel (7,3).
        expect(await capturer.issueCaptureAtPixel(captures, 3, 1, 4, 2, harness.engine.getCaptureUniforms()))
          .toBe(captures.length);
        const captured = (await collect(capturer, captures.length)).find(result => result.varName === "debugValue")!;
        expect(captured.rgba[0]).toBeCloseTo(0.9375, 5);
        expect(captured.rgba[1]).toBeCloseTo(0.125, 5);
        expect(captured.rgba[2]).toBeCloseTo(1, 5);
        expect(captured.rgba[3]).toBeCloseTo(1, 5);

        // Grid capture uses the same evenly spaced centre samples: source x=2,6 and y=1,3.
        expect(await capturer.issueCaptureGrid(captures, harness.engine.getCaptureUniforms(), 2, 2))
          .toBe(captures.length);
        const grid = (await collect(capturer, captures.length)).find(result => result.varName === "debugValue")!;
        expect([...grid.rgba]).toEqual([
          0.3125, 0.625, 1, 1, 0.8125, 0.625, 1, 1,
          0.3125, 0.125, 1, 1, 0.8125, 0.125, 1, 1,
        ]);
      } finally {
        capturer.dispose();
      }

      // Reinstalling the normal pipeline restores the Buffer's scaled image output.
      await harness.compile({ path: imagePath, image, buffers: { BufferA: buffer }, config });
      expect(await harness.renderAndReadPixels()).toEqual(original);
    } finally {
      harness.dispose();
    }
  });
});
