import { describe, expect, it } from "vitest";
import { createNativeComputeSource, createNativeRenderSource } from "./ShaderSourceTemplates";

describe("ShaderSourceTemplates", () => {
  it("creates direct-position WGSL render stages", () => {
    const template = createNativeRenderSource("wgsl", "", "Image");
    expect(template.entryPoints).toEqual({ vertex: "ImageVertex", fragment: "ImageFragment" });
    expect(template.text).toContain("@builtin(position) fragCoord: vec4f");
  });

  it("uses lexer tokens to avoid names mentioned only in comments and strings", () => {
    const template = createNativeRenderSource("slang", "// BufferAVertex\nstring label = \"BufferAFragment\";", "Buffer A");
    expect(template.entryPoints).toEqual({ vertex: "BufferAVertex", fragment: "BufferAFragment" });
  });

  it.each(["wgsl", "slang"] as const)("creates %s native render targets for a requested attachment count", (language) => {
    const template = createNativeRenderSource(language, "", "BufferA", 3);
    expect(template.text).toContain(language === "wgsl" ? "@location(2)" : "SV_Target2");
  });

  it("adds a suffix when a compute entry point already exists", () => {
    const template = createNativeComputeSource("wgsl", "fn SimulationCompute() {}", "Simulation");
    expect(template.entryPoints).toEqual({ compute: "SimulationCompute2" });
    expect(template.text).toContain("@compute");
  });
});
