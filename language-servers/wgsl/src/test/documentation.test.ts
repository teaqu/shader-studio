import { describe, expect, it } from "vitest";
import { WgslLanguageService } from "../WgslLanguageService";
import { parseWgslDocument } from "@shader-studio/wgsl-analysis";
import { declarationDocumentation } from "../documentation";

describe("WGSL documentation line endings", () => {
  it.each([
    ["// detached comment\n\n", "Declared here."],
    ["let previous = 1;\n", "Declared here."],
    ["@must_use\n", "Declared here."],
    ["//\n", "Declared here."],
  ])("keeps provenance when there is no attached comment: %j", (prefix, expected) => {
    const analysis = parseWgslDocument("image.wgsl", `${prefix}fn shade() -> f32 { return 1; }`);
    const symbol = analysis.symbols.find(symbol => symbol.name === "shade")!;
    expect(declarationDocumentation(analysis, symbol, "Declared here.")).toBe(expected);
  });

  it.each(["\n", "\r\n"])("preserves included Common documentation with %j", async (eol) => {
    const uri = "file:///workspace/image.wgsl";
    const line = "  return vec4f(commonTone(1.0));";
    const text = `fn mainImage(coord: vec2f) -> vec4f {\n${line}\n}`;
    const service = new WgslLanguageService();
    await service.syncEnvironment({
      documentUri: uri, languageId: "wgsl", generation: 1, passName: "Image", stage: "fragment",
      customUniforms: [], resources: [], virtualFiles: [],
      commonFile: {
        uri: "file:///workspace/common.wgsl", version: 1,
        text: ["// Maps a colour into display range.", "@must_use", "fn commonTone(value: f32) -> f32 { return value; }"].join(eol),
      },
    });
    await service.openDocument({ uri, languageId: "wgsl", version: 1, text });
    const document = { uri, languageId: "wgsl" as const, version: 1, environmentGeneration: 1 };
    const result = await service.signatureHelp({ document, position: { line: 1, character: line.indexOf("1.0") } });
    expect(JSON.stringify(result)).toContain("Maps a colour into display range.");
    expect(JSON.stringify(result)).toContain("Shader Studio Common");
  });

  it.each(["\n", "\r\n"])("preserves hover and signature comments with %j", async (eol) => {
    const uri = "file:///workspace/image.wgsl";
    const text = [
      "// Scales a colour by gain.",
      "// Preserves the input hue.",
      "@must_use",
      "fn shade(value: f32) -> f32 { return value; }",
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  return vec4f(shade(1.0));",
      "}",
    ].join(eol);
    const service = new WgslLanguageService();
    await service.syncEnvironment({
      documentUri: uri, languageId: "wgsl", generation: 1, passName: "Image", stage: "fragment",
      customUniforms: [], resources: [], virtualFiles: [],
    });
    await service.openDocument({ uri, languageId: "wgsl", version: 1, text });
    const document = { uri, languageId: "wgsl" as const, version: 1, environmentGeneration: 1 };
    const hover = await service.hover({ document, position: { line: 3, character: 4 } });
    const signature = await service.signatureHelp({ document, position: { line: 5, character: 22 } });
    for (const result of [hover, signature]) {
      expect(JSON.stringify(result)).toContain("Scales a colour by gain.");
      expect(JSON.stringify(result)).toContain("Preserves the input hue.");
      expect(JSON.stringify(result)).toContain("Declared in this shader.");
    }
  });
});
