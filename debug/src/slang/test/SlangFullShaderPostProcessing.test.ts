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

    expect(output).toContain("float4 _ssdbg_full_userMain(float4 p)");
    expect(output).toContain('[shader("fragment")]\nfloat4 image(float4 fragCoord : SV_Position) : SV_Target0');
    expect(output).toContain("_ssdbg_full_userMain(fragCoord)");
    expect(output).toContain("float4 _ssdbg_full_legacyMainImage");
    expect(output).toContain('[shader("fragment")] float4 unused()');
  });

  it("does not rewrite a structured native fragment", () => {
    const native = '[shader("fragment")] Output image(Input i) : SV_Target0 { return i.color; }';
    expect(applySlangFullShaderPostProcessing(native, { normalizeMode: "abs", stepEdge: null }, "image")).toBeNull();
  });
});
