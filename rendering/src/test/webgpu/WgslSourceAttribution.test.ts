import { describe, expect, it } from "vitest";
import { WgslCompiler } from "../../webgpu/WgslCompiler";
import { formatWgslDiagnostic } from "../../webgpu/SlangPassPipeline";

const image = "fn mainImage(p: vec2f) -> vec4f { return vec4f(1); }";
describe("WGSL authored source attribution", () => {
  for (const passKind of ["render", "compute"] as const) {
    it(`preserves Common blanks and hoisted directive positions in ${passKind}`, async () => {
      const common = "\n\nenable f16;\nfn helper() -> f32 {\n  return missingCommon;\n}";
      const result = await new WgslCompiler().compile(passKind === "render" ? image : "@compute @workgroup_size(1) fn update() {}", { passKind, commonCode: common });
      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error("wrapper failed");
      }
      const line = result.wgsl.split("\n").findIndex(line => line.includes("return missingCommon")) + 1;
      expect(result.commonRange).toBeDefined();
      expect(formatWgslDiagnostic("Image", line, 10, "unknown identifier", result.sourceLineOffset, result.sourceLineCount, undefined, result.commonRange)).toBe("Common: WGSL L5:10 unknown identifier");
      expect(formatWgslDiagnostic("Image", 2, 1, "generated error", result.sourceLineOffset, result.sourceLineCount, undefined, result.commonRange)).toContain("internal:");
    });
  }
  it("preserves leading vertex blanks and columns", async () => {
    const result = await new WgslCompiler().compile(image, { vertexCode: "\n\nfn mainVertex() {\n  missingVertex();\n}" });
    if (!result.success) {
      throw new Error("wrapper failed");
    }
    const line = result.wgsl.split("\n").findIndex(line => line.includes("missingVertex")) + 1;
    expect(formatWgslDiagnostic("Image", line, 3, "unknown identifier", result.sourceLineOffset, result.sourceLineCount, { range: result.vertexRange! })).toBe("Image (vertex): L4:3 unknown identifier");
  });
  for (const owner of ["Image", "Common", "vertex"] as const) {
    it(`attributes a multiline hoisted directive to ${owner} without changing columns`, async () => {
      const directive = "\n\n  requires\n    unknown_extension;\n";
      const result = await new WgslCompiler().compile(owner === "Image" ? directive + image : image, {
        ...(owner === "Common" ? { commonCode: directive } : {}),
        ...(owner === "vertex" ? { vertexCode: directive + "fn mainVertex() {}" } : {}),
      });
      if (!result.success) {
        throw new Error("wrapper failed");
      }
      const lines = result.wgsl.split("\n");
      const line = lines.findIndex(line => line.includes("unknown_extension")) + 1;
      expect(line).toBeLessThan(lines.findIndex(line => line.includes("struct _ss_ShaderToyUniforms")) + 1);
      expect(lines[line - 1]).toBe("    unknown_extension;");
      expect(formatWgslDiagnostic("Image", line, 5, "unsupported extension", result.sourceLineOffset, result.sourceLineCount,
        result.vertexRange && { range: result.vertexRange }, result.commonRange, result.directiveRanges))
        .toBe(owner === "vertex" ? "Image (vertex): L4:5 unsupported extension" : `${owner}: WGSL L4:5 unsupported extension`);
    });
  }

  for (const passKind of ["render", "compute"] as const) {
    it(`keeps error columns after linked duplicate handles in ${passKind} Common code`, async () => {
      const commonCode = "\nfn read() -> vec4f {\n  return sample2DLevel(longAliasTexture, longAliasSampler, vec2f(0), missingLevel);\n}";
      const result = await new WgslCompiler().compile(passKind === "render" ? image : "@compute @workgroup_size(1) fn update() {}", {
        passKind, commonCode,
        channels: ["a", "longAlias"].map((key, slot) => ({ key, slot, kind: "texture" as const, textureIdentity: "shared", samplerIdentity: "shared" })),
      });
      if (!result.success) {
        throw new Error("wrapper failed");
      }
      const authored = commonCode.split("\n")[2];
      const linked = result.wgsl.split("\n").find(line => line.includes("missingLevel"))!;
      expect(linked).not.toContain("longAliasTexture");
      expect(linked.indexOf("missingLevel")).toBe(authored.indexOf("missingLevel"));
      expect(linked.length).toBe(authored.length);
    });
  }

});
