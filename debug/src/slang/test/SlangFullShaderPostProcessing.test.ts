import { describe, expect, it } from "vitest";
import { applySlangFullShaderPostProcessing } from "../SlangFullShaderPostProcessing";

describe("applySlangFullShaderPostProcessing", () => {
  it("post-processes the selected native fragment while preserving its public entry point", () => {
    const native = [
      "float4 mainImage(float2 fragCoord) { return float4(fragCoord, 0, 1); }",
      '[shader("fragment")] float4 unused() : SV_Target0 { return float4(0); }',
      '[shader("fragment")] float4 image(float4 p : SV_Position) : SV_Target0 { return float4(p.x); }',
    ].join("\n");
    const output = applySlangFullShaderPostProcessing(native, { normalizeMode: "soft", stepEdge: 0.5 }, "image");

    expect(output).toMatch(/float4 _ssdbg_full_userMain\(float4 p\s*\)/);
    expect(output).toContain('[shader("fragment")] float4 image(float4 p : SV_Position) : SV_Target0');
    expect(output).toContain("_ssdbg_full_userMain(p)");
    expect(output).toContain("float4 mainImage(float2 fragCoord)");
    expect(output).toContain('[shader("fragment")] float4 unused()');
  });

  it("post-processes a structured native color/depth output", () => {
    const native = `struct Input { float4 position : SV_Position; float2 uv : TEXCOORD0; };
struct Output { float4 color : SV_Target0; float depth : SV_Depth; };
[shader("fragment")] Output image(Input i) { Output output; output.color = float4(i.uv, 0, 1); output.depth = 0.5; return output; }`;
    const output = applySlangFullShaderPostProcessing(native, { normalizeMode: "abs", stepEdge: null }, "image");
    expect(output).toContain('[shader("fragment")] Output image(Input i)');
    expect(output).toContain("Output result = _ssdbg_full_userMain(i);");
    expect(output).toContain("result.color = float4(abs((result.color).rgb)");
    expect(output).toContain("return result;");
  });
});
