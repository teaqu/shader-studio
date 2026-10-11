import { describe, expect, it } from "vitest";
import { SlangDebugEngine, WgslDebugEngine } from "@shader-studio/debug";
import type { DebugWorkspace, ShaderConfig } from "@shader-studio/types";
import type { CaptureResult, IVariableCapturer } from "../../capture/VariableCapturer";
import { createShaderCanvasHarness, type Pixel } from "./ShaderCanvasHarness";

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
  throw new Error(capturer.getLastError() ?? "Native five-output capture did not resolve");
}

function orbit(canvas: HTMLCanvasElement): void {
  const capture = canvas.setPointerCapture;
  const release = canvas.releasePointerCapture;
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 12, clientX: 24, clientY: 24 }));
  canvas.dispatchEvent(new PointerEvent("pointermove", { button: 0, pointerId: 12, clientX: 88, clientY: 38 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 12, clientX: 88, clientY: 38 }));
  canvas.setPointerCapture = capture;
  canvas.releasePointerCapture = release;
}

function sourceFor(language: "wgsl" | "slang"): { image: string; scene: string } {
  if (language === "wgsl") {
    return {
      image: "fn mainImage(coord: vec2f) -> vec4f { return iChannel0Sample(coord / iResolution.xy); }",
      scene: `struct CameraVaryings { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) normal: vec3f, }
struct Outputs { @location(0) colour: vec4f, @location(1) normalDepth: vec4f, @location(2) unusedTwo: vec4f, @location(3) unusedThree: vec4f, @location(4) selected: vec4f, @builtin(frag_depth) depth: f32, }
@vertex fn cameraVertex(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f) -> CameraVaryings {
  let world = iModelMatrix * vec4f(position, 1.0);
  return CameraVaryings(iViewProjectionMatrix * world, uv, (iNormalMatrix * vec4f(normal, 0.0)).xyz);
}
@fragment fn cameraMrt(input: CameraVaryings) -> Outputs {
  let brightness = 0.30 + 0.70 * max(0.0, dot(normalize(input.normal), normalize(vec3f(0.4, 0.6, 0.7))));
  let captureColor = vec4f((0.25 + 0.75 * input.uv.x) * abs(input.normal) * brightness, 1.0);
  return Outputs(vec4f(0.0), vec4f(normalize(input.normal) * 0.5 + 0.5, input.position.z), vec4f(0.0), vec4f(0.0), captureColor, input.position.z);
}`,
    };
  }
  return {
    image: "float4 mainImage(float2 coord) { return iChannel0.Sample(coord / iResolution.xy); }",
    scene: `struct CameraVaryings { float4 position : SV_Position; float2 uv : TEXCOORD0; float3 normal : TEXCOORD1; };
struct Outputs { float4 colour : SV_Target0; float4 normalDepth : SV_Target1; float4 unusedTwo : SV_Target2; float4 unusedThree : SV_Target3; float4 selected : SV_Target4; float depth : SV_Depth; };
[shader("vertex")] CameraVaryings cameraVertex([[vk::location(0)]] float3 position : POSITION, [[vk::location(1)]] float3 normal : NORMAL, [[vk::location(2)]] float2 uv : TEXCOORD0) {
  CameraVaryings output; float4 world = mul(iModelMatrix, float4(position, 1));
  output.position = mul(iViewProjectionMatrix, world); output.uv = uv; output.normal = mul(iNormalMatrix, float4(normal, 0)).xyz; return output;
}
[shader("fragment")] Outputs cameraMrt(CameraVaryings input) {
  float brightness = 0.30 + 0.70 * max(0.0, dot(normalize(input.normal), normalize(float3(0.4, 0.6, 0.7))));
  float4 captureColor = float4((0.25 + 0.75 * input.uv.x) * abs(input.normal) * brightness, 1);
  Outputs output; output.colour = float4(0, 0, 0, 0); output.normalDepth = float4(normalize(input.normal) * 0.5 + 0.5, input.position.z); output.unusedTwo = float4(0, 0, 0, 0); output.unusedThree = float4(0, 0, 0, 0); output.selected = captureColor; output.depth = input.position.z; return output;
}`,
  };
}

function hasRenderedCapture(pixels: Pixel[], rgba: Float32Array): boolean {
  return pixels.some(pixel => pixel.slice(0, 3).every((channel, index) => Math.abs(channel - Math.round(rgba[index]! * 255)) <= 2));
}

describe("native five-output capture", () => {
  it.each(["wgsl", "slang"] as const)("captures a rasterized local through MRT output 4 in %s without changing live outputs", { timeout: 30_000 }, async language => {
    const { image, scene } = sourceFor(language);
    const imagePath = `/native-five-output/image.${language}`;
    const scenePath = `/native-five-output/scene.${language}`;
    const config: ShaderConfig = { version: "1.0", passes: {
      Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA", output: 4 } } },
      BufferA: { path: scenePath, geometry: { type: "cube" }, entryPoints: { vertex: "cameraVertex", fragment: "cameraMrt" }, outputFormat: "rgba16float", outputs: [{ name: "colour" }, { name: "normal-depth" }, { name: "unused-two" }, { name: "unused-three" }, { name: "capture" }] },
    } };
    const harness = createShaderCanvasHarness(language);
    try {
      harness.resize(4, 4);
      await harness.compile({ path: imagePath, image, buffers: { BufferA: scene }, config });
      const beforeOrbit = await harness.renderAndReadPixels();
      orbit(harness.canvas);
      const afterOrbit = await harness.renderAndReadPixels();
      expect(afterOrbit).not.toEqual(beforeOrbit);

      const workspace: DebugWorkspace = { rootUri: scenePath, rootPath: scenePath, passName: "BufferA", render: { entryPoint: "cameraMrt", output: 4 }, contentHash: `native-five-output-${language}`, files: [{ uri: scenePath, path: scenePath, source: scene, version: 1, moduleName: "", ownerPass: "BufferA" }] };
      const request = { workspace, sourceUri: scenePath, position: { line: scene.split("\n").findIndex(line => line.includes("captureColor")), character: 8 } };
      const debug = language === "wgsl" ? new WgslDebugEngine() : new SlangDebugEngine();
      const analysis = debug.analyze(request);
      if (!analysis.ok) {
        throw new Error(analysis.diagnostics[0]?.message);
      }
      const value = analysis.analysis.visibleValues.find(candidate => candidate.name === "captureColor");
      expect(value).toBeDefined();
      const plan = debug.planCapture(request, [value!.id], { normalizeMode: "off", stepEdge: null, output: 4 });
      if (!plan.ok) {
        throw new Error(plan.diagnostics[0]?.message);
      }

      const capturer = harness.engine.createVariableCapturer();
      try {
        capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(scene, "BufferA", scenePath));
        const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: plan.plan.files[0]!.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
        expect(plan.plan.nativeRender).toMatchObject({ fragmentEntryPoint: "cameraMrt", output: 4 });
        expect(await capturer.issueCaptureAtPixel(captures, 1, 1, 4, 4, harness.engine.getCaptureUniforms())).toBe(captures.length);
        const captured = (await collect(capturer, captures.length)).find(result => result.varName === "captureColor")!;
        expect(captured.rgba[3]).toBeCloseTo(1, 5);
        // Attachment 4 is the only visible output. The local must agree with
        // that live attachment, proving capture used its sparse scratch target.
        expect(hasRenderedCapture(afterOrbit, captured.rgba)).toBe(true);
        expect(capturer.getLastError()).toBeNull();
      } finally {
        capturer.dispose();
      }
      expect(await harness.renderAndReadPixels()).toEqual(afterOrbit);
    } finally {
      harness.dispose();
    }
  });
});
