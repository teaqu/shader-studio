import { describe, expect, it } from "vitest";
import { allowNonUniformDerivatives } from "../../webgpu/wgslDiagnostics";

describe("allowNonUniformDerivatives", () => {
  it("prefixes generated WGSL with the derivative-uniformity filter", () => {
    const wgsl = "@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }";

    expect(allowNonUniformDerivatives(wgsl)).toBe(
      `diagnostic(off, derivative_uniformity);\n${wgsl}`,
    );
  });

  it("keeps the filter ahead of every declaration", () => {
    const filtered = allowNonUniformDerivatives("enable f16;\nvar<private> x: f32;");

    expect(filtered.indexOf("diagnostic(off, derivative_uniformity);"))
      .toBeLessThan(filtered.indexOf("var<private> x"));
  });

  it("leaves a module that already sets the rule untouched", () => {
    for (const existing of [
      "diagnostic(off, derivative_uniformity);\nfn f() {}",
      "diagnostic(warning, derivative_uniformity);\nfn f() {}",
      "diagnostic( error , derivative_uniformity );\nfn f() {}",
    ]) {
      expect(allowNonUniformDerivatives(existing)).toBe(existing);
    }
  });

  it("still adds the rule when an unrelated filter is present", () => {
    const wgsl = "diagnostic(off, subgroup_uniformity);\nfn f() {}";

    expect(allowNonUniformDerivatives(wgsl)).toBe(
      `diagnostic(off, derivative_uniformity);\n${wgsl}`,
    );
  });
});
